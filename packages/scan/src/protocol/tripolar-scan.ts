import { byteReader } from '@mindpeeker/oracle'
import {
  analyzeTripolar,
  INTENTIONS,
  type Intention,
  runTripolar,
  type TripolarAnalysis,
  type TripolarPlan,
  type TripolarRun,
} from '@mindpeeker/psi'
import { ScanError } from '../errors.js'
import { accumulateDeviation, byBayesFactor, deviationStat } from '../scan/deviation.js'
import type {
  ByteSource,
  Catalog,
  DeviationResult,
  EntropyAccounting,
  ScanResult,
} from '../types.js'

/** Per-intention catalog scores plus the PEAR high-minus-low statistic. */
export interface TripolarScanReport {
  readonly source: string
  /**
   * The full PEAR tripolar analysis from `@mindpeeker/psi` — the rigorous,
   * pre-registered MMI statistic. `analysis.deltaZ` is standard normal under
   * H0; the per-intention bit budgets live in `analysis.high.bits` etc.
   */
  readonly analysis: TripolarAnalysis
  /** `analysis.deltaZ`, surfaced: the high-minus-low primary statistic. */
  readonly deltaZ: number
  /** `analysis.deltaEffect`: the per-bit effect separation $\varepsilon_H - \varepsilon_L$. */
  readonly deltaEffect: number
  /** `analysis.deltaCi95`: 95% CI on `deltaEffect`. */
  readonly deltaCi95: readonly [number, number]
  /** Catalog deviation scores under each intention, ranked by Bayes factor. */
  readonly perIntention: Readonly<Record<Intention, readonly ScanResult[]>>
  /** Accounting for the per-intention catalog-scoring phase only (see docs). */
  readonly accounting: EntropyAccounting
}

/** Options for {@link scanTripolar}. */
export interface TripolarScanOptions {
  /** Rounds per intention for the catalog deviation scoring. Default 128. */
  rounds?: number
  signal?: AbortSignal
  /** Clock override passed through to `runTripolar`. */
  now?: () => number
}

/**
 * The statistically rigorous MMI scan: a **pre-registered** PEAR tripolar
 * protocol (`runTripolar` + `analyzeTripolar`) for the headline high-minus-low
 * statistic, plus a fair-coin catalog deviation score under each intention.
 *
 * Two phases consume the source's stream:
 * 1. **Tripolar** — `runTripolar(source, plan)` collects intention-tagged runs
 *    over a fresh stream; `analyzeTripolar` returns `deltaZ` (the pre-stated
 *    primary statistic, $\sim N(0,1)$ under H0), per-bit effect sizes, and CIs.
 *    This is the number that settles "did intention shift the source?" — under
 *    a fair source `deltaZ` $\approx 0$; a source biased up on high runs and
 *    down on low runs drives it away from 0.
 * 2. **Catalog scoring** — for each intention in the fixed schedule
 *    (`high → low → baseline`) a fresh deviation scan (`rounds` rounds) ranks
 *    the catalog by chance deviation *under that intention*.
 *
 * Because the whole design is pre-registered — intentions, schedule, bit
 * budget, and $p_0 = \tfrac12$ fixed *before* the data — the result is honest:
 * a non-zero `deltaZ` is a fact about the bytes, **not** proof of any
 * mechanism, and this package makes no such claim.
 *
 * @throws {ScanError} `invalid_catalog` for an empty catalog; `aborted` /
 *   `insufficient_entropy` propagated from the source.
 */
export async function scanTripolar(
  catalog: Catalog,
  source: ByteSource,
  plan: TripolarPlan,
  opts: TripolarScanOptions = {},
): Promise<TripolarScanReport> {
  if (!catalog.items || catalog.items.length === 0) {
    throw new ScanError('invalid_catalog', `catalog "${catalog?.id}" has no items`)
  }
  const rounds = opts.rounds ?? 128

  try {
    // Phase 1: the pre-registered tripolar protocol.
    const runs: TripolarRun[] = []
    for await (const run of runTripolar(source, plan, {
      ...(opts.signal && { signal: opts.signal }),
      ...(opts.now && { now: opts.now }),
    })) {
      runs.push(run)
    }
    const analysis = analyzeTripolar(runs)

    // Phase 2: per-intention catalog deviation scoring over a fresh stream.
    const reader = byteReader(source, opts.signal ? { signal: opts.signal } : {})
    const start = reader.bytesConsumed
    const perIntention = { high: [], low: [], baseline: [] } as Record<Intention, ScanResult[]>
    for (const intention of INTENTIONS) {
      const counts = await accumulateDeviation(reader, catalog.items.length, rounds)
      const scored = catalog.items.map((item, i) => {
        const deviation: DeviationResult = deviationStat(counts[i] as number, rounds)
        return {
          name: item.name,
          ...(item.category !== undefined && { category: item.category }),
          trials: rounds,
          deviation,
          rank: 0,
        }
      })
      scored.sort(byBayesFactor)
      perIntention[intention] = scored.map((r, i) => Object.freeze({ ...r, rank: i + 1 }))
    }
    const bytesConsumed = reader.bytesConsumed - start

    return Object.freeze({
      source: source.name,
      analysis,
      deltaZ: analysis.deltaZ,
      deltaEffect: analysis.deltaEffect,
      deltaCi95: analysis.deltaCi95,
      perIntention: Object.freeze({
        high: Object.freeze(perIntention.high),
        low: Object.freeze(perIntention.low),
        baseline: Object.freeze(perIntention.baseline),
      }),
      accounting: Object.freeze({ bytesConsumed, bitsUsed: bytesConsumed * 8 }),
    })
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === 'aborted') {
      throw new ScanError('aborted', 'tripolar scan aborted by caller signal', {
        source: source.name,
        cause: error,
      })
    }
    if (code === 'insufficient_data' || code === 'insufficient_entropy') {
      throw new ScanError(
        'insufficient_entropy',
        `${source.name} ran out of entropy during the tripolar scan`,
        { source: source.name, cause: error },
      )
    }
    throw error
  }
}
