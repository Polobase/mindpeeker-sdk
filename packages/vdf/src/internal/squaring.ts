import { VdfError } from '../errors.js'

export interface SquaringHooks {
  /** Cooperative cancellation, checked at every block boundary. */
  signal?: AbortSignal
  /** Invoked with the number of squarings completed so far, once per block. */
  onStep?: (done: number) => void
  /** Squarings per block (abort-check/progress granularity). Default 1024. */
  interval?: number
}

/** Blocks between macrotask yields — see {@link sequentialSquare}. */
const YIELD_EVERY_BLOCKS = 16

/**
 * The sequential core shared by `evaluate` and `pietrzakProve`: `count`
 * squarings $y \leftarrow y^2 \bmod n$ starting from `base`. This chain is
 * the delay — it is conjectured *inherently sequential* in a group of
 * unknown order, so parallel hardware buys nothing (Rivest–Shamir–Wagner
 * 1996; Pietrzak, ITCS 2019).
 *
 * Every `interval` (default 1024) squarings the abort signal is checked and
 * `onStep` fires; every {@link YIELD_EVERY_BLOCKS} blocks the loop yields to
 * the macrotask queue (`setTimeout 0`) so timers and event handlers — the
 * places `AbortController.abort()` is typically called from — actually get
 * to run. Abort latency is therefore ~`interval × 16` squarings.
 */
export async function sequentialSquare(
  base: bigint,
  count: number,
  n: bigint,
  hooks: SquaringHooks = {},
): Promise<bigint> {
  const interval = hooks.interval ?? 1024
  const { signal, onStep } = hooks
  if (signal?.aborted) throw new VdfError('aborted', 'aborted before squaring started')
  let y = base % n
  let done = 0
  let blocksSinceYield = 0
  while (done < count) {
    const block = Math.min(interval, count - done)
    for (let i = 0; i < block; i++) y = (y * y) % n
    done += block
    if (signal?.aborted) {
      throw new VdfError('aborted', `aborted after ${done} of ${count} squarings`)
    }
    onStep?.(done)
    blocksSinceYield++
    if (blocksSinceYield >= YIELD_EVERY_BLOCKS && done < count) {
      blocksSinceYield = 0
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (signal?.aborted) {
        throw new VdfError('aborted', `aborted after ${done} of ${count} squarings`)
      }
    }
  }
  return y
}
