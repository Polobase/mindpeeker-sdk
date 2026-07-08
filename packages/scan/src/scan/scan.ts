import { byteReader } from '@mindpeeker/oracle'
import { ScanError } from '../errors.js'
import type {
  ByteSource,
  Catalog,
  CatalogItem,
  ScanOptions,
  ScanReport,
  ScanResult,
} from '../types.js'
import { accumulateDeviation, byBayesFactor, deviationStat } from './deviation.js'
import { race } from './race.js'
import { generalVitalityReader } from './vitality.js'

/**
 * Run a complete AetherOne-style scan over a catalog, composed from the
 * unbiased SDK primitives into one reproducible {@link ScanReport}.
 *
 * The pipeline consumes a single byte stream in a fixed order — **race →
 * vitality → deviation** — so the report is a deterministic function of the
 * bytes:
 *
 * - **race** (`mode` `'race'`/`'both'`): the AetherOne EV race over a randomly
 *   drawn subset; ranks by normalised `energy` and reports `numberOfTrials`.
 * - **vitality** (`withVitality`): each scored item's General Vitality (GV).
 * - **deviation** (`mode` `'deviation'`/`'both'`): the honest fair-coin null
 *   model — per-item $\{z, p, BF_{10}\}$ against $p_0 = \tfrac12$.
 *
 * In `'race'`/`'both'` the scored set is the raced subset, ranked by energy; in
 * `'deviation'` it is the whole catalog, ranked by Bayes factor. Every random
 * choice uses `@mindpeeker/oracle`'s rejection-sampled `uniformInt` — never
 * modulo — so item selection is exactly uniform.
 *
 * `accounting.bitsUsed` $= 8 \cdot$ `bytesConsumed`: every draw is byte-level,
 * so each consumed byte's 8 bits entered a decision.
 *
 * **What the numbers mean.** `energy`, `vitality`, and AetherOne's "hit"
 * thresholds have *no* chance baseline; `deviation` is the only field with a
 * real null. A high deviation score flags a departure from chance — it is
 * **not** evidence of mind–matter interaction, and with many items some will
 * look significant by luck (correct for multiplicity).
 *
 * @throws {ScanError} `invalid_catalog` for an empty catalog; `aborted` /
 *   `insufficient_entropy` propagated from the source.
 */
export async function scan(
  catalog: Catalog,
  source: ByteSource,
  opts: ScanOptions = {},
): Promise<ScanReport> {
  if (!catalog.items || catalog.items.length === 0) {
    throw new ScanError('invalid_catalog', `catalog "${catalog?.id}" has no items`)
  }
  const mode = opts.mode ?? 'both'
  const withVitality = opts.withVitality ?? true
  const deviationRounds = opts.deviationRounds ?? 256
  const runRace = mode === 'race' || mode === 'both'
  const runDeviation = mode === 'deviation' || mode === 'both'

  const reader = byteReader(source, opts.signal ? { signal: opts.signal } : {})
  const start = reader.bytesConsumed

  try {
    // 1. race
    let numberOfTrials = 0
    let scored: CatalogItem[]
    let energy: (number | undefined)[]
    let trials: (number | undefined)[]
    if (runRace) {
      const result = await race(reader, catalog.items, {
        ...(opts.maxValue !== undefined && { maxValue: opts.maxValue }),
        ...(opts.subsetFraction !== undefined && { subsetFraction: opts.subsetFraction }),
      })
      numberOfTrials = result.numberOfTrials
      const maxEv = Math.max(1, ...result.items.map((r) => r.ev))
      scored = result.items.map((r) => r.item)
      energy = result.items.map((r) => r.ev / maxEv)
      trials = result.items.map((r) => r.increments)
    } else {
      scored = [...catalog.items]
      energy = scored.map(() => undefined)
      trials = scored.map(() => deviationRounds)
    }

    // 2. vitality
    const vitality: (number | undefined)[] = scored.map(() => undefined)
    if (withVitality) {
      for (let i = 0; i < scored.length; i++) vitality[i] = await generalVitalityReader(reader)
    }

    // 3. deviation
    let deviations: (ScanResult['deviation'] | undefined)[] = scored.map(() => undefined)
    if (runDeviation) {
      const counts = await accumulateDeviation(reader, scored.length, deviationRounds)
      deviations = counts.map((k) => deviationStat(k, deviationRounds, opts.prior))
    }

    const results: ScanResult[] = scored.map((item, i) => ({
      name: item.name,
      ...(item.category !== undefined && { category: item.category }),
      ...(energy[i] !== undefined && { energy: energy[i] }),
      ...(trials[i] !== undefined && { trials: trials[i] }),
      ...(vitality[i] !== undefined && { vitality: vitality[i] }),
      ...(deviations[i] !== undefined && { deviation: deviations[i] }),
      rank: 0,
    }))

    // rank: energy for race/both, Bayes factor for deviation-only. The
    // deviation branch breaks equal-evidence ties by a stable name hash rather
    // than catalog order (see byBayesFactor).
    if (runRace) {
      results.sort((a, b) => (b.energy ?? 0) - (a.energy ?? 0))
    } else {
      results.sort(byBayesFactor)
    }
    const ranked = results.map((r, i) => Object.freeze({ ...r, rank: i + 1 }))

    const bytesConsumed = reader.bytesConsumed - start
    return Object.freeze({
      catalog: catalog.id,
      mode,
      results: Object.freeze(ranked),
      numberOfTrials,
      source: source.name,
      accounting: Object.freeze({ bytesConsumed, bitsUsed: bytesConsumed * 8 }),
    })
  } catch (error) {
    throw rethrow(error, source.name)
  }
}

/** Re-map oracle aborts/starvation onto this package's error codes. */
function rethrow(error: unknown, source: string): unknown {
  const code = (error as { code?: string } | null)?.code
  if (code === 'aborted') {
    return new ScanError('aborted', 'scan aborted by caller signal', { source, cause: error })
  }
  if (code === 'insufficient_entropy') {
    return new ScanError('insufficient_entropy', `${source} ran out of entropy during the scan`, {
      source,
      cause: error,
    })
  }
  return error
}
