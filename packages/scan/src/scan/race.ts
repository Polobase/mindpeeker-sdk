import { type ByteReader, drawWithoutReplacement, uniformInt } from '@mindpeeker/oracle'
import { ScanError } from '../errors.js'
import { finiteAtLeast, inHalfOpen, integerIn, optionsObject } from '../internal/validate.js'
import type { CatalogItem } from '../types.js'

/** One raced item, before it is merged into a `ScanResult`. */
export interface RacedItem {
  readonly item: CatalogItem
  /** Final Energetic Value (EV). */
  readonly ev: number
  /** EV increments this item received. */
  readonly increments: number
  /** Whether this item first reached `maxValue`. */
  readonly winner: boolean
}

/** Result of an EV race. */
export interface RaceResult {
  /** Raced items, in the order they were drawn (not yet ranked). */
  readonly items: readonly RacedItem[]
  /**
   * Passes over the subset until a winner reached `maxValue`. AetherOnePi's
   * `numberOfTrials` counts increments instead: the sum of `increments`.
   */
  readonly numberOfTrials: number
}

/** Options for {@link race}. */
export interface RaceOptions {
  /** EV threshold to win; finite, ≥ 1. Default 100. */
  maxValue?: number
  /** Share of the catalog raced, in $(0, 1]$. Default 0.1. */
  subsetFraction?: number
  /** Lower clamp of the subset size; integer ≥ 1. Default 120 (AetherOnePi). */
  subsetMin?: number
  /** Upper clamp of the subset size; integer ≥ `subsetMin`, or `Infinity`. Default 5000 (AetherOnePi). */
  subsetMax?: number
}

/** Validated, default-resolved race options. */
export interface ResolvedRaceOptions {
  readonly maxValue: number
  readonly subsetFraction: number
  readonly subsetMin: number
  readonly subsetMax: number
}

/**
 * Validate and resolve {@link RaceOptions}.
 *
 * @throws {ScanError} `invalid_options`
 */
export function resolveRaceOptions(opts: RaceOptions | undefined): ResolvedRaceOptions {
  const o = optionsObject(opts, 'race options')
  const maxValue = finiteAtLeast(o.maxValue ?? 100, 'maxValue', 1)
  const subsetFraction = inHalfOpen(o.subsetFraction ?? 0.1, 'subsetFraction', 0, 1)
  const subsetMin = integerIn(o.subsetMin ?? 120, 'subsetMin', 1)
  const rawMax = o.subsetMax ?? 5000
  const subsetMax =
    rawMax === Number.POSITIVE_INFINITY ? rawMax : integerIn(rawMax, 'subsetMax', subsetMin)
  return Object.freeze({ maxValue, subsetFraction, subsetMin, subsetMax })
}

/**
 * The raced subset size for a catalog of `size` items:
 * $$s = \min\!\big(M,\ \operatorname{clamp}(\lfloor M f \rfloor,\ s_{\min},\ s_{\max})\big),$$
 * AetherOnePi's `AnalysisService.analyseRateList` rule (`max = size / 10`,
 * clamped to $[120, 5000]$, drawn until the list is exhausted) at the
 * defaults $f = 0.1$, $s_{\min} = 120$, $s_{\max} = 5000$. The 0.1.x rule
 * $\max(12, \operatorname{round}(Mf))$ is `subsetMin: 12, subsetMax: Infinity`
 * up to rounding (floor now, as AetherOnePi's integer division).
 */
export function raceSubsetSize(size: number, opts: ResolvedRaceOptions): number {
  const target = Math.floor(size * opts.subsetFraction)
  return Math.min(size, Math.max(opts.subsetMin, Math.min(opts.subsetMax, target)))
}

/**
 * The AetherOne EV race, onto **unbiased** primitives.
 *
 * Procedure, for a catalog of $M$ items:
 * 1. Draw the subset size $s$ of {@link raceSubsetSize} items with
 *    `drawWithoutReplacement` — a Fisher–Yates prefix, so the subset is a
 *    uniform **ordered** $s$-prefix of a random permutation.
 * 2. Race: each pass adds `uniformInt(reader, 11)` (an EV increment in
 *    $\{0,\dots,10\}$, AetherOnePy's `randint(0, 10)`) to every subset item's
 *    EV **in draw order**; the first item whose EV reaches `maxValue` wins and
 *    the race stops mid-pass. `numberOfTrials` is the pass count.
 *
 * **Why draw order matters.** Within a pass, an earlier position reaches the
 * threshold first, so position 0 wins about twice as often as position 11
 * (200 000 seeded simulated races of 12 items at `maxValue` 100: 0.118 vs
 * 0.059). The
 * winner is nevertheless uniform over the *catalog* because the positions are
 * a uniformly random ordering of the items — which is why the subset must be
 * an ordered Fisher–Yates prefix and not a sorted combination. AetherOnePi
 * iterates a Java `HashMap` instead, whose order follows the items' name
 * hashes, so there the position advantage attaches to particular names.
 *
 * Every random choice bottoms out in `@mindpeeker/oracle`'s rejection-sampled
 * `uniformInt` — never modulo. The caller owns `reader` (it is not closed).
 * Deterministic: identical bytes give an identical race.
 *
 * @throws {ScanError} `invalid_catalog` for no items; `invalid_options` for bad
 *   options. Reader errors (`OracleError`) propagate unchanged.
 */
export async function race(
  reader: ByteReader,
  items: readonly CatalogItem[],
  opts: RaceOptions = {},
): Promise<RaceResult> {
  const resolved = resolveRaceOptions(opts)
  if (!Array.isArray(items) || items.length === 0) {
    throw new ScanError('invalid_catalog', 'race needs at least one item')
  }
  return raceResolved(reader, items, resolved)
}

/** {@link race} with already-validated options. */
export async function raceResolved(
  reader: ByteReader,
  items: readonly CatalogItem[],
  opts: ResolvedRaceOptions,
): Promise<RaceResult> {
  const size = items.length
  const subsetCount = raceSubsetSize(size, opts)
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
      if ((ev[i] as number) >= opts.maxValue) {
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
