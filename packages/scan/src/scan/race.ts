import { type ByteReader, drawWithoutReplacement, uniformInt } from '@mindpeeker/oracle'
import type { CatalogItem } from '../types.js'

/** One raced item, before it is merged into a `ScanResult`. */
export interface RacedItem {
  readonly item: CatalogItem
  /** Final Energetic Value (EV). */
  readonly ev: number
  /** EV increments this item received. */
  readonly increments: number
  /** Whether this item first crossed `maxValue`. */
  readonly winner: boolean
}

/** Result of an EV race. */
export interface RaceResult {
  /** Raced items, in the order they were drawn (not yet ranked). */
  readonly items: readonly RacedItem[]
  /** Passes over the subset until a winner crossed `maxValue`. */
  readonly numberOfTrials: number
}

export interface RaceOptions {
  /** EV threshold to win. Default 100. */
  maxValue?: number
  /** Fraction of the catalog raced, clamped to `[min(12, size), size]`. Default 0.1. */
  subsetFraction?: number
}

/** Clamp `x` into `[lo, hi]`. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

/**
 * The AetherOne EV race, ported faithfully (`AnalysisService.analyseRateList`)
 * onto **unbiased** primitives.
 *
 * Procedure, for a catalog of $M$ items:
 * 1. Draw a random subset of size
 *    $$s = \operatorname{clamp}\!\big(\lfloor Mf \rceil,\; \min(12, M),\; M\big)$$
 *    ($f$ = `subsetFraction`) with {@link drawWithoutReplacement} — a
 *    Fisher–Yates prefix, so the subset is an exactly uniform $s$-combination.
 *    AetherOne shuffles "so no order forms a bell curve"; the unbiased draw is
 *    that shuffle's prefix.
 * 2. Race: each pass adds `uniformInt(reader, 11)` (an EV increment in
 *    $[0,10]$) to every subset item's EV in turn; the **first** item whose EV
 *    reaches `maxValue` wins and the race stops mid-pass. `numberOfTrials` is
 *    the pass count.
 *
 * Every random choice bottoms out in `@mindpeeker/oracle`'s rejection-sampled
 * `uniformInt` — never modulo — which is the entire reason this SDK port
 * exists: the frontend `scanCatalog` selects with a biased `x mod n` reduction.
 *
 * Deterministic: identical bytes give an identical race. Reads only as much
 * entropy as the race needs.
 */
export async function race(
  reader: ByteReader,
  items: readonly CatalogItem[],
  opts: RaceOptions = {},
): Promise<RaceResult> {
  const maxValue = opts.maxValue ?? 100
  const fraction = opts.subsetFraction ?? 0.1
  const size = items.length
  const subsetCount = clamp(Math.round(size * fraction), Math.min(12, size), size)

  const indices = await drawWithoutReplacement(reader, size, subsetCount)
  const subset = indices.map((i) => items[i] as CatalogItem)
  const ev = new Array<number>(subsetCount).fill(0)
  const increments = new Array<number>(subsetCount).fill(0)

  let winner = -1
  let numberOfTrials = 0
  while (winner === -1) {
    numberOfTrials++
    for (let i = 0; i < subsetCount; i++) {
      ev[i] = (ev[i] as number) + (await uniformInt(reader, 11))
      increments[i] = (increments[i] as number) + 1
      if ((ev[i] as number) >= maxValue) {
        winner = i
        break
      }
    }
  }

  const raced: RacedItem[] = subset.map((item, i) => ({
    item,
    ev: ev[i] as number,
    increments: increments[i] as number,
    winner: i === winner,
  }))
  return { items: raced, numberOfTrials }
}
