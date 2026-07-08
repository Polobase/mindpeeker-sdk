/**
 * Streaming transfer entropy: a lock-step pair zipper with backpressure and
 * a rolling-window TE generator whose emissions are EXACTLY the batch
 * estimator on the corresponding slices (the ring-buffer design of
 * negentropy's `windowedNegentropy`, specialized to symbol pairs).
 */

import { FlowError } from './errors.js'
import { type TransferEntropyOptions, transferEntropy } from './transfer.js'
import type { ByteSource, SymbolStreamInput } from './types.js'

function throwIfAborted(signal: AbortSignal | undefined, what: string): void {
  if (signal?.aborted) throw new FlowError('aborted', `${what} aborted`)
}

function isByteSource(input: SymbolStreamInput): input is ByteSource {
  return typeof (input as ByteSource).stream === 'function'
}

async function* iterateInput(
  input: SymbolStreamInput,
  signal: AbortSignal | undefined,
): AsyncGenerator<number | Uint8Array> {
  if (isByteSource(input)) {
    yield* input.stream(signal !== undefined ? { signal } : undefined)
  } else {
    yield* input as AsyncIterable<number | Uint8Array>
  }
}

interface ChunkBuffer {
  chunk: Uint8Array | null
  pos: number
}

async function nextSymbol(
  it: AsyncIterator<number | Uint8Array>,
  buf: ChunkBuffer,
  name: string,
): Promise<number | null> {
  for (;;) {
    if (buf.chunk !== null && buf.pos < buf.chunk.length) return buf.chunk[buf.pos++] as number
    const r = await it.next()
    if (r.done === true) return null
    const value = r.value
    if (typeof value === 'number') return value
    if (value instanceof Uint8Array) {
      if (value.length > 0) {
        buf.chunk = value
        buf.pos = 0
      }
      continue
    }
    throw new FlowError('invalid_input', `${name} yielded neither a number nor a Uint8Array`)
  }
}

export interface PairStreamsOptions {
  /** Abort zipping; the generator throws a FlowError with code `'aborted'`. */
  signal?: AbortSignal
}

/**
 * Zip two symbol/byte streams into lock-step pairs with backpressure: one
 * symbol is pulled from each side per emitted pair, byte chunks are
 * flattened to per-byte symbols, and neither side is pulled ahead of the
 * other beyond a single buffered chunk. Ends (returns) as soon as either
 * side ends; the other side's iterator is closed via `return()`, so lazy
 * sources stop being pulled. Accepts async iterables, sync iterables, and
 * live {@link ByteSource}s (any `@mindpeeker/entropy` provider,
 * structurally).
 */
export async function* pairStreams(
  a: SymbolStreamInput,
  b: SymbolStreamInput,
  opts: PairStreamsOptions = {},
): AsyncGenerator<readonly [number, number]> {
  throwIfAborted(opts.signal, 'pairStreams')
  const itA = iterateInput(a, opts.signal)[Symbol.asyncIterator]()
  const itB = iterateInput(b, opts.signal)[Symbol.asyncIterator]()
  const bufA: ChunkBuffer = { chunk: null, pos: 0 }
  const bufB: ChunkBuffer = { chunk: null, pos: 0 }
  try {
    for (;;) {
      throwIfAborted(opts.signal, 'pairStreams')
      const sa = await nextSymbol(itA, bufA, 'first stream')
      if (sa === null) return
      const sb = await nextSymbol(itB, bufB, 'second stream')
      if (sb === null) return
      yield [sa, sb] as const
    }
  } finally {
    await Promise.allSettled([itA.return?.(undefined), itB.return?.(undefined)])
  }
}

export interface WindowedTransferEntropyOptions extends TransferEntropyOptions {
  /**
   * Pairs per window. Must be at least $\max(k - 1, u + l - 2) + 3$ so every
   * window holds ≥ 2 embedded tuples.
   */
  windowSize: number
  /** Pairs between emissions. Default `windowSize` (non-overlapping). */
  hopSize?: number
  /** Abort mid-stream; the generator throws a FlowError with code `'aborted'`. */
  signal?: AbortSignal
}

export interface WindowedTransferEntropyPoint {
  /** Emission counter, from 0. */
  index: number
  /** Input-pair index at which this window starts. */
  startSample: number
  /** The window's $TE_{X \to Y}$ in bits — exactly the batch value on that slice. */
  te: number
}

/**
 * Rolling transfer entropy over a lock-step pair stream — the "when did
 * information start flowing?" view. Lazy and pull-based; every emission
 * recomputes the batch {@link transferEntropy} on the current window, so
 * streamed values are EXACTLY the batch values on the corresponding slices.
 * Pair up two live streams with {@link pairStreams}. Aborting the signal
 * ends the generator with a FlowError (code `'aborted'`) on its next pull
 * and closes the upstream iterator.
 */
export async function* windowedTransferEntropy(
  pairs: AsyncIterable<readonly [number, number]> | Iterable<readonly [number, number]>,
  opts: WindowedTransferEntropyOptions,
): AsyncGenerator<WindowedTransferEntropyPoint> {
  const { windowSize } = opts
  const k = opts.k ?? 1
  const l = opts.l ?? 1
  const u = opts.lag ?? 1
  const minWindow = Math.max(k - 1, u + l - 2) + 3
  if (!Number.isInteger(windowSize) || windowSize < minWindow) {
    throw new FlowError(
      'invalid_input',
      `windowSize must be an integer ≥ ${minWindow} for k=${k}, l=${l}, lag=${u}, got ${windowSize}`,
    )
  }
  const hop = opts.hopSize ?? windowSize
  if (!Number.isInteger(hop) || hop < 1) {
    throw new FlowError('invalid_input', `hopSize must be a positive integer, got ${hop}`)
  }
  const teOpts: TransferEntropyOptions = {
    k,
    l,
    lag: u,
    ...(opts.alphabet !== undefined ? { alphabet: opts.alphabet } : {}),
    ...(opts.millerMadow !== undefined ? { millerMadow: opts.millerMadow } : {}),
  }
  throwIfAborted(opts.signal, 'windowed transfer entropy')
  const srcRing = new Float64Array(windowSize)
  const dstRing = new Float64Array(windowSize)
  let pushed = 0
  let nextEmitAt = windowSize
  let index = 0
  for await (const pair of pairs) {
    throwIfAborted(opts.signal, 'windowed transfer entropy')
    const src = pair[0]
    const dst = pair[1]
    if (typeof src !== 'number' || typeof dst !== 'number') {
      throw new FlowError('invalid_input', 'pair stream must yield [number, number] tuples')
    }
    const slot = pushed % windowSize
    srcRing[slot] = src
    dstRing[slot] = dst
    pushed++
    if (pushed >= nextEmitAt) {
      // unroll the rings into window order (oldest first)
      const srcWin = new Float64Array(windowSize)
      const dstWin = new Float64Array(windowSize)
      const head = pushed % windowSize
      for (let i = 0; i < windowSize; i++) {
        const j = (head + i) % windowSize
        srcWin[i] = srcRing[j] as number
        dstWin[i] = dstRing[j] as number
      }
      yield {
        index: index++,
        startSample: pushed - windowSize,
        te: transferEntropy(srcWin, dstWin, teOpts),
      }
      nextEmitAt += hop
    }
  }
}
