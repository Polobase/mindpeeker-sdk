/**
 * Streaming transfer entropy: a lock-step pair zipper with backpressure and
 * a rolling-window TE generator whose emissions are EXACTLY the batch
 * estimator on the corresponding slices (the ring-buffer design of
 * negentropy's `windowedNegentropy`, specialized to symbol pairs).
 */

import { FlowError } from './errors.js'
import { closeIterator, nextOrAbort, throwIfAborted, toFlowError } from './internal/abort.js'
import { cmiEvaluate, finalize } from './internal/cmi.js'
import {
  firstTuple,
  resolveEmbedding,
  setupTransferEntropy,
  sourceBlock,
} from './internal/embedding.js'
import { MAX_ALPHABET, validateAlphabetOption } from './internal/symbols.js'
import type { LocalTransferEntropyResult, TransferEntropyOptions } from './transfer.js'
import type { ByteSource, SymbolStreamInput } from './types.js'

/** Largest accepted `windowSize` ($2^{28}$ pairs). */
export const MAX_WINDOW_SIZE = 268_435_456

function isByteSource(input: unknown): input is ByteSource {
  return (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as ByteSource).stream === 'function'
  )
}

/** Adapt a sync iterator to the async iterator protocol. */
function fromSync<T>(iterator: Iterator<T>): AsyncIterator<T> {
  return {
    next: () => Promise.resolve(iterator.next()),
    return: (value?: unknown) =>
      Promise.resolve(
        iterator.return !== undefined
          ? iterator.return(value)
          : ({ done: true, value } as IteratorResult<T>),
      ),
  }
}

type AnyIterable<T> = AsyncIterable<T> | Iterable<T>

function isIterable<T>(input: unknown): input is AnyIterable<T> {
  if (input === null || (typeof input !== 'object' && typeof input !== 'function')) return false
  const obj = input as Partial<AsyncIterable<T> & Iterable<T>>
  return (
    typeof obj[Symbol.asyncIterator] === 'function' || typeof obj[Symbol.iterator] === 'function'
  )
}

/** Open an iterator over an (a)sync iterable; failures become `source_error`. */
function openIterable<T>(input: AnyIterable<T>, what: string, name: string): AsyncIterator<T> {
  try {
    const asyncFn = (input as AsyncIterable<T>)[Symbol.asyncIterator]
    if (typeof asyncFn === 'function') return asyncFn.call(input)
    return fromSync((input as Iterable<T>)[Symbol.iterator]())
  } catch (error) {
    throw toFlowError(error, undefined, what, name)
  }
}

interface Side {
  readonly name: string
  readonly iterator: AsyncIterator<number | Uint8Array>
  chunk: Uint8Array | null
  pos: number
}

function openSide(
  input: SymbolStreamInput,
  label: string,
  signal: AbortSignal | undefined,
  what: string,
): Side {
  if (isByteSource(input)) {
    const name = typeof input.name === 'string' ? input.name : label
    let stream: AsyncIterable<Uint8Array>
    try {
      stream = input.stream(signal !== undefined ? { signal } : undefined)
    } catch (error) {
      throw toFlowError(error, signal, what, name)
    }
    if (!isIterable(stream)) {
      throw new FlowError('invalid_input', `${what}: ${name}.stream() did not return an iterable`)
    }
    return { name, iterator: openIterable(stream, what, name), chunk: null, pos: 0 }
  }
  return {
    name: label,
    iterator: openIterable(input as AnyIterable<number | Uint8Array>, what, label),
    chunk: null,
    pos: 0,
  }
}

function assertSymbol(value: number, what: string, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value >= MAX_ALPHABET) {
    throw new FlowError(
      'invalid_input',
      `${what}: ${name} yielded ${value}, not a symbol (integer in [0, 2^31 − 1))`,
    )
  }
  return value
}

async function nextSymbol(
  side: Side,
  signal: AbortSignal | undefined,
  what: string,
): Promise<number | null> {
  for (;;) {
    if (side.chunk !== null && side.pos < side.chunk.length) return side.chunk[side.pos++] as number
    let r: IteratorResult<number | Uint8Array>
    try {
      r = await nextOrAbort(side.iterator, signal, what)
    } catch (error) {
      throw toFlowError(error, signal, what, side.name)
    }
    if (r.done === true) {
      if (signal?.aborted) throw toFlowError(signal.reason, signal, what, side.name)
      return null
    }
    const value = r.value
    if (typeof value === 'number') return assertSymbol(value, what, side.name)
    if (value instanceof Uint8Array) {
      if (value.length > 0) {
        side.chunk = value
        side.pos = 0
      }
      continue
    }
    throw new FlowError(
      'invalid_input',
      `${what}: ${side.name} yielded neither a number nor a Uint8Array`,
    )
  }
}

/** Options for {@link pairStreams}. */
export interface PairStreamsOptions {
  /**
   * Abort zipping. A pending upstream pull is raced against the signal, so
   * the generator rejects promptly with `FlowError('aborted')` even when a
   * source stalls, rejects with its own abort error, or simply ends.
   */
  signal?: AbortSignal
}

/**
 * Zip two symbol/byte streams into lock-step pairs with backpressure: one
 * symbol is pulled from each side per emitted pair, byte chunks are
 * flattened to per-byte symbols, and neither side is pulled ahead of the
 * other beyond a single buffered chunk. Ends (returns) as soon as either
 * side ends; both iterators are closed via `return()` (after an abort the
 * wait is capped at 100 ms), so lazy sources stop being pulled. Accepts async
 * iterables, sync iterables, and live {@link ByteSource}s (any
 * `@mindpeeker/entropy` provider, structurally).
 *
 * Errors: `invalid_input` for a non-iterable input or an item that is not a
 * symbol or `Uint8Array`; `aborted` for any abort (cause: the upstream error
 * or `signal.reason`); `source_error` when a stream throws (cause: the
 * original error, `source`: the provider name or `'first stream'`/`'second
 * stream'`).
 */
export async function* pairStreams(
  a: SymbolStreamInput,
  b: SymbolStreamInput,
  opts: PairStreamsOptions = {},
): AsyncGenerator<readonly [number, number]> {
  const what = 'pairStreams'
  const { signal } = opts
  for (const [input, label] of [
    [a, 'first stream'],
    [b, 'second stream'],
  ] as const) {
    if (!isByteSource(input) && !isIterable(input)) {
      throw new FlowError('invalid_input', `${what}: ${label} is neither iterable nor a ByteSource`)
    }
  }
  throwIfAborted(signal, what)
  const sideA = openSide(a, 'first stream', signal, what)
  let sideB: Side
  try {
    sideB = openSide(b, 'second stream', signal, what)
  } catch (error) {
    await closeIterator(sideA.iterator, false)
    throw error
  }
  try {
    for (;;) {
      throwIfAborted(signal, what)
      const sa = await nextSymbol(sideA, signal, what)
      if (sa === null) return
      const sb = await nextSymbol(sideB, signal, what)
      if (sb === null) return
      yield [sa, sb] as const
    }
  } finally {
    const aborted = signal?.aborted === true
    await Promise.all([
      closeIterator(sideA.iterator, aborted),
      closeIterator(sideB.iterator, aborted),
    ])
  }
}

/** Options for {@link windowedTransferEntropy}: TE options plus window geometry. */
export interface WindowedTransferEntropyOptions extends TransferEntropyOptions {
  /**
   * Pairs per window: an integer in $[\max(k - 1, u + l - 2) + 3,\; 2^{28}]$
   * so every window holds ≥ 2 embedded tuples.
   */
  windowSize: number
  /** Pairs between emissions. Default `windowSize` (non-overlapping). */
  hopSize?: number
  /**
   * Also emit the window's pointwise local TE (`locals`, aligned to window
   * positions like `localTransferEntropy`). Default `false`.
   */
  locals?: boolean
  /**
   * Abort mid-stream; the generator rejects promptly with
   * `FlowError('aborted')`, even while the upstream pull is pending.
   */
  signal?: AbortSignal
}

/** One emission of {@link windowedTransferEntropy}. */
export interface WindowedTransferEntropyPoint {
  /** Emission counter, from 0. */
  index: number
  /** Input-pair index at which this window starts. */
  startSample: number
  /** The window's $TE_{X \to Y}$ in bits — exactly the batch value on that slice. */
  te: number
  /** The window's local TE (only with `locals: true`); `mean` is the plug-in TE. */
  locals?: LocalTransferEntropyResult
}

/**
 * Rolling transfer entropy over a lock-step pair stream — the "when did
 * information start flowing?" view. Lazy and pull-based; every emission
 * recomputes the batch {@link transferEntropy} on the current window, so
 * streamed values are EXACTLY the batch values on the corresponding slices.
 * Pair up two live streams with {@link pairStreams}.
 *
 * All options (embedding, alphabet, window geometry) are validated before the
 * first pair is pulled, and every pair is validated on arrival
 * (`invalid_input`). Aborting the signal rejects the pending pull with
 * `FlowError('aborted')` and closes the upstream iterator (cleanup capped at
 * 100 ms); an upstream that ends after the abort is also reported as
 * `aborted`. Upstream failures that are not a `FlowError` become
 * `source_error`.
 */
export async function* windowedTransferEntropy(
  pairs: AsyncIterable<readonly [number, number]> | Iterable<readonly [number, number]>,
  opts: WindowedTransferEntropyOptions,
): AsyncGenerator<WindowedTransferEntropyPoint> {
  const what = 'windowed transfer entropy'
  if (opts === null || typeof opts !== 'object') {
    throw new FlowError('invalid_input', `${what} needs options with windowSize`)
  }
  const embedding = resolveEmbedding(opts)
  const alphabet = validateAlphabetOption(opts.alphabet)
  const { windowSize } = opts
  const minWindow = firstTuple(embedding) + 3
  if (!Number.isInteger(windowSize) || windowSize < minWindow || windowSize > MAX_WINDOW_SIZE) {
    const { k, l, lag } = embedding
    throw new FlowError(
      'invalid_input',
      `windowSize must be an integer in [${minWindow}, 2^28] for k=${k}, l=${l}, lag=${lag}, got ${windowSize}`,
    )
  }
  const hop = opts.hopSize ?? windowSize
  if (!Number.isInteger(hop) || hop < 1) {
    throw new FlowError('invalid_input', `hopSize must be a positive integer, got ${hop}`)
  }
  if (!isIterable<readonly [number, number]>(pairs)) {
    throw new FlowError('invalid_input', `${what}: pairs must be an (async) iterable`)
  }
  const { signal } = opts
  const mm = opts.millerMadow === true
  const wantLocals = opts.locals === true
  const teOpts = { ...embedding, ...(alphabet !== undefined ? { alphabet } : {}) }
  throwIfAborted(signal, what)
  let srcRing: Int32Array
  let dstRing: Int32Array
  try {
    srcRing = new Int32Array(windowSize)
    dstRing = new Int32Array(windowSize)
  } catch (cause) {
    throw new FlowError('invalid_input', `windowSize ${windowSize} could not be allocated`, {
      cause,
    })
  }
  const iterator = openIterable(pairs, what, 'pair stream')
  let pushed = 0
  let nextEmitAt = windowSize
  let index = 0
  try {
    for (;;) {
      throwIfAborted(signal, what)
      let r: IteratorResult<readonly [number, number]>
      try {
        r = await nextOrAbort(iterator, signal, what)
      } catch (error) {
        throw toFlowError(error, signal, what, 'pair stream')
      }
      if (r.done === true) {
        if (signal?.aborted) throw toFlowError(signal.reason, signal, what, 'pair stream')
        return
      }
      const pair = r.value as unknown
      if (pair === null || typeof pair !== 'object') {
        throw new FlowError(
          'invalid_input',
          `${what}: pair stream must yield [number, number] tuples`,
        )
      }
      const src = (pair as readonly unknown[])[0]
      const dst = (pair as readonly unknown[])[1]
      if (typeof src !== 'number' || typeof dst !== 'number') {
        throw new FlowError(
          'invalid_input',
          `${what}: pair stream must yield [number, number] tuples`,
        )
      }
      for (const v of [src, dst]) {
        if (!Number.isInteger(v) || v < 0 || v >= (alphabet ?? MAX_ALPHABET)) {
          throw new FlowError(
            'invalid_input',
            `${what}: pair value ${v} is not a symbol in [0, ${alphabet ?? '2^31 − 1'})`,
          )
        }
      }
      const slot = pushed % windowSize
      srcRing[slot] = src
      dstRing[slot] = dst
      pushed++
      if (pushed < nextEmitAt) continue
      // unroll the rings into window order (oldest first)
      const head = pushed % windowSize
      const srcWin = new Int32Array(windowSize)
      const dstWin = new Int32Array(windowSize)
      srcWin.set(srcRing.subarray(head), 0)
      srcWin.set(srcRing.subarray(0, head), windowSize - head)
      dstWin.set(dstRing.subarray(head), 0)
      dstWin.set(dstRing.subarray(0, head), windowSize - head)
      const setup = setupTransferEntropy(what, srcWin, dstWin, teOpts, embedding)
      const point: WindowedTransferEntropyPoint = {
        index: index++,
        startSample: pushed - windowSize,
        te: 0,
      }
      if (wantLocals) {
        const values = new Float64Array(windowSize).fill(Number.NaN)
        const start = setup.first + 1
        const value = cmiEvaluate(setup.base, sourceBlock(setup), values, start)
        point.te = finalize(value, mm)
        point.locals = { values, start, mean: value.plugin, count: setup.count }
      } else {
        point.te = finalize(cmiEvaluate(setup.base, sourceBlock(setup)), mm)
      }
      nextEmitAt += hop
      yield point
    }
  } finally {
    await closeIterator(iterator, signal?.aborted === true)
  }
}
