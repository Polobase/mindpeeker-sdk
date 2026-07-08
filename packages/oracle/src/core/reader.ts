import { OracleError } from '../errors.js'
import type { ByteSource, OracleInput } from '../types.js'

/**
 * Sequential byte consumer over any {@link OracleInput}. All draws in this
 * package bottom out here, so `bytesConsumed` is the single source of truth
 * for how much entropy a cast pulled.
 */
export interface ByteReader {
  /** Raw bytes pulled from the input so far (monotone non-decreasing). */
  readonly bytesConsumed: number
  /**
   * Consume the next byte (an integer in $[0, 255]$).
   *
   * @throws OracleError `'insufficient_entropy'` when a finite input ends early
   * @throws OracleError `'aborted'` when the reader's AbortSignal fires
   * @throws OracleError `'invalid_input'` when the input yields non-byte values
   */
  next(): Promise<number>
}

export interface ByteReaderOptions {
  /** Aborts pending and future reads with an OracleError `'aborted'`. */
  signal?: AbortSignal
}

const aborted = (source?: string) =>
  new OracleError('aborted', 'byte reader aborted by caller signal', { source })

/** Await `promise` but reject as soon as `signal` aborts (listener is always removed). */
async function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  source?: string,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) throw aborted(source)
  let onAbort: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(aborted(source))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, abortPromise])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function checkByte(value: unknown, source?: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new OracleError('invalid_input', `input yielded a non-byte value: ${String(value)}`, {
      source,
    })
  }
  return value
}

function isByteSource(input: object): input is ByteSource {
  return (
    typeof (input as ByteSource).stream === 'function' &&
    typeof (input as ByteSource).name === 'string'
  )
}

function isByteReader(input: object): input is ByteReader {
  return (
    typeof (input as ByteReader).next === 'function' &&
    typeof (input as ByteReader).bytesConsumed === 'number'
  )
}

class BatchReader implements ByteReader {
  #bytes: ArrayLike<number>
  #index = 0
  #signal?: AbortSignal

  constructor(bytes: ArrayLike<number>, signal?: AbortSignal) {
    this.#bytes = bytes
    this.#signal = signal
  }

  get bytesConsumed(): number {
    return this.#index
  }

  async next(): Promise<number> {
    if (this.#signal?.aborted) throw aborted()
    if (this.#index >= this.#bytes.length) {
      throw new OracleError(
        'insufficient_entropy',
        `batch input exhausted after ${this.#index} bytes`,
      )
    }
    return checkByte(this.#bytes[this.#index++])
  }
}

class StreamReader implements ByteReader {
  #iterator: AsyncIterator<Uint8Array>
  #chunk: Uint8Array = new Uint8Array(0)
  #offset = 0
  #consumed = 0
  #signal?: AbortSignal
  #source?: string

  constructor(iterable: AsyncIterable<Uint8Array>, signal?: AbortSignal, source?: string) {
    this.#iterator = iterable[Symbol.asyncIterator]()
    this.#signal = signal
    this.#source = source
  }

  get bytesConsumed(): number {
    return this.#consumed
  }

  async next(): Promise<number> {
    if (this.#signal?.aborted) throw aborted(this.#source)
    while (this.#offset >= this.#chunk.length) {
      const step = await raceAbort(this.#iterator.next(), this.#signal, this.#source)
      if (step.done) {
        throw new OracleError(
          'insufficient_entropy',
          `stream ended after ${this.#consumed} bytes`,
          { source: this.#source },
        )
      }
      if (!(step.value instanceof Uint8Array)) {
        throw new OracleError('invalid_input', 'stream yielded a non-Uint8Array chunk', {
          source: this.#source,
        })
      }
      this.#chunk = step.value
      this.#offset = 0
    }
    this.#consumed++
    return this.#chunk[this.#offset++] as number
  }
}

/**
 * Adapt any {@link OracleInput} into a {@link ByteReader}. Passing an existing
 * `ByteReader` returns it unchanged (its own construction-time signal keeps
 * governing aborts), so several casts can share one reader — each cast then
 * reports *per-cast* accounting deltas.
 *
 * A {@link ByteSource}'s `stream({ signal })` is only invoked when the first
 * byte is pulled, never eagerly.
 */
export function byteReader(
  input: OracleInput | ByteReader,
  opts: ByteReaderOptions = {},
): ByteReader {
  if (input instanceof Uint8Array) return new BatchReader(input, opts.signal)
  if (typeof input !== 'object' || input === null) {
    throw new OracleError('invalid_input', 'unrecognized oracle input')
  }
  if (isByteReader(input)) return input
  if (Symbol.asyncIterator in input) {
    return new StreamReader(input as AsyncIterable<Uint8Array>, opts.signal)
  }
  if (isByteSource(input)) {
    return new StreamReader(lazyStream(input, opts.signal), opts.signal, input.name)
  }
  if (typeof (input as ArrayLike<number>).length === 'number') {
    return new BatchReader(input as ArrayLike<number>, opts.signal)
  }
  throw new OracleError('invalid_input', 'unrecognized oracle input shape')
}

async function* lazyStream(source: ByteSource, signal?: AbortSignal): AsyncIterable<Uint8Array> {
  yield* source.stream(signal ? { signal } : undefined)
}
