/// <reference lib="esnext.disposable" preserve="true" />
import { OracleError } from '../errors.js'
import type { ByteSource, ByteStreamOptions, OracleInput } from '../types.js'
import { SignalReader } from './delegating-reader.js'
import {
  ASYNC_DISPOSE,
  abortedError,
  anyAborted,
  checkByte,
  closedError,
  type InternalReader,
  isAbortSignal,
  isUint8View,
  NO_SIGNALS,
  READ,
  ROOT,
  sourceError,
} from './internal.js'
import { StreamReader } from './stream-reader.js'

/**
 * Sequential byte consumer over any {@link OracleInput}. All draws in this
 * package bottom out here, so `bytesConsumed` is the single source of truth
 * for how much entropy a cast pulled.
 *
 * **Lifecycle.** A reader over a live stream holds that stream open until
 * {@link ByteReader.close} is called (or the reader is disposed with
 * `await using`). Every cast closes the reader it creates; a reader you pass
 * in stays open and is yours to close.
 *
 * **Sequential use only.** A reader is not reentrant: a `next()` while
 * another `next()` is still pending throws `OracleError('invalid_input')`,
 * and so does starting a cast on a reader another cast is using.
 */
export interface ByteReader {
  /** Bytes handed out by `next()` so far (monotone non-decreasing). */
  readonly bytesConsumed: number
  /**
   * Bytes pulled out of the underlying input so far, including bytes still
   * buffered in the current chunk — for a live source, what it actually
   * delivered. Equals `bytesConsumed` for batch inputs; `undefined` for
   * readers that do not track it.
   */
  readonly bytesFetched?: number
  /**
   * Consume the next byte (an integer in $[0, 255]$).
   *
   * @throws OracleError `'insufficient_entropy'` when a finite input ends early
   * @throws OracleError `'aborted'` when an AbortSignal governing the read fires
   * @throws OracleError `'invalid_input'` when the input yields non-byte values,
   *   or when another `next()` on this reader is still pending
   * @throws OracleError `'source_error'` when the underlying input fails (`cause` holds its error)
   * @throws OracleError `'closed'` after {@link ByteReader.close}
   */
  next(): Promise<number>
  /**
   * Release the underlying input. For a stream this calls its iterator's
   * `return()` exactly once (so a provider's `finally` — socket, device —
   * runs), waiting at most 250 ms for it and ignoring its errors; a pending
   * `next()` rejects with `'closed'`. Idempotent; never rejects. A reader
   * that wraps a caller-owned reader closes only itself.
   */
  close(): Promise<void>
  /** Same as {@link ByteReader.close}, for `await using reader = byteReader(src)`. */
  [Symbol.asyncDispose](): Promise<void>
}

export interface ByteReaderOptions {
  /**
   * Aborts pending and future reads with an OracleError `'aborted'`. Also
   * forwarded to a {@link ByteSource}'s `stream()`. On an existing reader,
   * the returned view is governed by both this signal and the reader's own.
   */
  signal?: AbortSignal
  /**
   * Chunk size requested from a {@link ByteSource} (forwarded to
   * `stream({ chunkBytes })`; a hint the source may ignore). Positive
   * integer. Ignored for every other input. Default: the source's own chunk
   * size — casts pass `32` unless told otherwise.
   */
  chunkBytes?: number
}

function isByteSource(input: object): input is ByteSource {
  return (
    typeof (input as ByteSource).stream === 'function' &&
    typeof (input as ByteSource).name === 'string'
  )
}

/**
 * Structural check for a {@link ByteReader}: a `next()` method and a numeric
 * `bytesConsumed`. `close()` is not required, so readers written against
 * 0.1.x still pass through (casts never close a reader they were given).
 */
export function isByteReader(input: unknown): input is ByteReader {
  return (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as ByteReader).next === 'function' &&
    typeof (input as ByteReader).bytesConsumed === 'number'
  )
}

/** Finite recorded batch. Every `next()` runs to completion without awaiting, so it is atomic. */
class BatchReader implements InternalReader {
  readonly #bytes: ArrayLike<number>
  readonly #signal: readonly AbortSignal[]
  #index = 0
  #closed = false

  constructor(bytes: ArrayLike<number>, signal?: AbortSignal) {
    this.#bytes = bytes
    this.#signal = signal ? [signal] : NO_SIGNALS
  }

  get bytesConsumed(): number {
    return this.#index
  }

  get bytesFetched(): number {
    return this.#index
  }

  get [ROOT](): ByteReader {
    return this
  }

  next(): Promise<number> {
    return this[READ](NO_SIGNALS)
  }

  async [READ](signals: readonly AbortSignal[]): Promise<number> {
    if (this.#closed) throw closedError()
    if (anyAborted(this.#signal) || anyAborted(signals)) throw abortedError()
    if (this.#index >= this.#bytes.length) {
      throw new OracleError(
        'insufficient_entropy',
        `batch input exhausted after ${this.#index} bytes`,
      )
    }
    // Validate before advancing: a rejected byte is not consumed.
    const value = checkByte(this.#bytes[this.#index])
    this.#index++
    return value
  }

  /** Marks the reader closed; a batch holds no resources. */
  close(): Promise<void> {
    this.#closed = true
    return Promise.resolve()
  }

  [ASYNC_DISPOSE](): Promise<void> {
    return this.close()
  }
}

function checkOptions(opts: ByteReaderOptions): void {
  if (typeof opts !== 'object' || opts === null) {
    throw new OracleError('invalid_input', 'byteReader options must be an object')
  }
  if (opts.signal !== undefined && !isAbortSignal(opts.signal)) {
    throw new OracleError('invalid_input', 'signal must be an AbortSignal')
  }
  const chunk = opts.chunkBytes
  if (chunk !== undefined && (!Number.isSafeInteger(chunk) || chunk < 1)) {
    throw new OracleError(
      'invalid_input',
      `chunkBytes must be a positive integer, got ${String(chunk)}`,
    )
  }
}

/**
 * Adapt any {@link OracleInput} into a {@link ByteReader}.
 *
 * - An existing `ByteReader` is returned unchanged — **unless** `signal` is
 *   given: then a view is returned whose reads race the inner reader against
 *   that signal (and fail fast when it is already aborted), with accounting
 *   delegated to the inner reader. Closing that view does **not** close the
 *   inner reader. Either way, several casts can share one reader
 *   (sequentially) and each reports *per-cast* accounting deltas.
 * - A {@link ByteSource}'s `stream({ signal, chunkBytes })` is only invoked
 *   when the first byte is pulled, never eagerly.
 * - An `AsyncIterable<Uint8Array>` is consumed like `for await`: closing the
 *   reader calls its iterator's `return()`.
 * - `Uint8Array` (from any realm) and `ArrayLike<number>` are finite batches.
 *
 * Rule of thumb for code that creates readers: close the reader iff
 * `reader !== input` — that closes streams you opened and views you created,
 * never a reader you were handed.
 *
 * @throws OracleError `'invalid_input'` for an unrecognized input shape, a
 *   non-AbortSignal `signal`, or a `chunkBytes` that is not a positive integer
 * @throws OracleError `'source_error'` when an AsyncIterable's
 *   `[Symbol.asyncIterator]()` throws
 */
export function byteReader(
  input: OracleInput | ByteReader,
  opts: ByteReaderOptions = {},
): ByteReader {
  checkOptions(opts)
  const { signal, chunkBytes } = opts
  if (isUint8View(input)) return new BatchReader(input, signal)
  if (typeof input !== 'object' || input === null) {
    throw new OracleError('invalid_input', 'unrecognized oracle input')
  }
  if (isByteReader(input)) return signal ? new SignalReader(input, signal) : input
  if (isByteSource(input)) {
    const streamOpts: ByteStreamOptions | undefined =
      signal !== undefined || chunkBytes !== undefined
        ? {
            ...(signal !== undefined ? { signal } : {}),
            ...(chunkBytes !== undefined ? { chunkBytes } : {}),
          }
        : undefined
    return new StreamReader(lazyStream(input, streamOpts), signal, input.name)
  }
  if (Symbol.asyncIterator in input) {
    let iterator: AsyncIterator<Uint8Array>
    try {
      iterator = (input as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
    } catch (err) {
      throw sourceError(err)
    }
    return new StreamReader(iterator, signal)
  }
  if (typeof (input as ArrayLike<number>).length === 'number') {
    return new BatchReader(input as ArrayLike<number>, signal)
  }
  throw new OracleError('invalid_input', 'unrecognized oracle input shape')
}

async function* lazyStream(
  source: ByteSource,
  opts: ByteStreamOptions | undefined,
): AsyncGenerator<Uint8Array, void, undefined> {
  yield* source.stream(opts)
}
