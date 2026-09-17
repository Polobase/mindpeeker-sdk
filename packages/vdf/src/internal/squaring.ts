import { PROGRESS_INTERVAL, Work } from './work.js'

/**
 * The sequential core shared by `evaluate`, the provers, and `calibrate`:
 * `count` squarings $y \leftarrow y^2 \bmod n$ starting from `base`. This chain
 * is the delay — it is conjectured *inherently sequential* in a group of unknown
 * order, so parallel hardware buys nothing (Rivest–Shamir–Wagner 1996; Pietrzak,
 * ITCS 2019).
 *
 * Squarings run in blocks of {@link PROGRESS_INTERVAL}; after each block the
 * shared {@link Work} meter checks the abort signal, reports progress, and yields
 * to the event loop every 16 blocks' worth of units. A pre-aborted signal throws
 * before any squaring. Without a meter a private one is used, so long chains
 * still yield.
 */
export async function sequentialSquare(
  base: bigint,
  count: number,
  n: bigint,
  work: Work = new Work(count),
): Promise<bigint> {
  work.throwIfAborted()
  let y = base % n
  let done = 0
  while (done < count) {
    const block = Math.min(PROGRESS_INTERVAL, count - done)
    for (let i = 0; i < block; i++) y = (y * y) % n
    done += block
    await work.advance(block)
  }
  return y
}
