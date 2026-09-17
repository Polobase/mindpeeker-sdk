import { bitReader } from '@mindpeeker/oracle'
import { openReader } from '../internal/reader.js'
import { toScanError } from '../internal/rethrow.js'
import {
  abortSignal,
  alphaLevel,
  betaPrior,
  bool,
  byteSource,
  integerIn,
  oneOf,
  optionsObject,
  scannableCatalog,
} from '../internal/validate.js'
import type {
  AdjustedDeviationResult,
  ByteSource,
  Catalog,
  CatalogItem,
  MultiplicitySummary,
  ScanMode,
  ScanOptions,
  ScanReport,
  ScanResult,
} from '../types.js'
import { accumulateDeviation, byBayesFactor, deviationStat } from './deviation.js'
import { adjustFamily } from './multiplicity.js'
import { raceResolved, resolveRaceOptions } from './race.js'
import { generalVitalityReader, generalVitalitySf } from './vitality.js'

const MODES: readonly ScanMode[] = ['race', 'deviation', 'both']

/**
 * Run a complete AetherOne-style scan over a catalog, composed from the
 * unbiased SDK primitives into one reproducible {@link ScanReport}.
 *
 * The pipeline consumes a single byte stream in a fixed order — **race →
 * vitality → deviation** — so the report is a deterministic function of the
 * bytes:
 *
 * - **race** (`mode` `'race'`/`'both'`): the AetherOne EV race over a randomly
 *   drawn subset (AetherOnePi's size rule: a tenth of the catalog clamped to
 *   $[120, 5000]$, see `race`); ranks by normalised `energy`.
 * - **vitality** (`withVitality`): each scored item's General Vitality, with
 *   `vitalityP` — the exact chance of a GV at least that high.
 * - **deviation** (`mode` `'deviation'`/`'both'`): the honest fair-coin null
 *   model — per-item $\{z, p, \ln BF_{10}\}$ against $p_0 = \tfrac12$, with
 *   Bonferroni/Holm/BH adjusted p-values and a report-level
 *   `multiplicity` summary (omnibus $\sum z^2$).
 *
 * In `'race'`/`'both'` the scored set is the raced subset, ranked by energy; in
 * `'deviation'` it is the whole catalog, ranked by $\ln BF_{10}$ (ties by id
 * hash). Every random choice uses `@mindpeeker/oracle`'s rejection-sampled
 * `uniformInt` or its bit reader — never a reduction without rejection.
 *
 * `accounting.bitsUsed` counts 8 bits per byte for the race and vitality draws
 * and one bit per deviation coin (see `EntropyAccounting`).
 *
 * **What the numbers mean.** `energy` has *no* chance baseline and `vitality`
 * only the one `vitalityP` states; `deviation` is the field with a real null.
 * A high deviation score flags a departure from chance — it is **not**
 * evidence of mind–matter interaction, and with many items some will look
 * significant by luck (read `pHolm`/`qBH` and `multiplicity`).
 *
 * The source stream is opened once and closed when the scan ends, fails, or is
 * aborted.
 *
 * @throws {ScanError} `invalid_catalog`; `invalid_options` (any malformed
 *   option or source); `insufficient_entropy`; `source_error`; `aborted`.
 */
export async function scan(
  catalog: Catalog,
  source: ByteSource,
  opts: ScanOptions = {},
): Promise<ScanReport> {
  const o = optionsObject(opts, 'scan options')
  const cat = scannableCatalog(catalog)
  const src = byteSource(source)
  const mode = oneOf(o.mode ?? 'both', 'mode', MODES)
  const withVitality = bool(o.withVitality ?? true, 'withVitality')
  const deviationRounds = integerIn(o.deviationRounds ?? 256, 'deviationRounds', 1)
  const prior = betaPrior(o.prior)
  const alpha = alphaLevel(o.alpha ?? 0.05)
  const raceOptions = resolveRaceOptions({
    ...(o.maxValue !== undefined && { maxValue: o.maxValue }),
    ...(o.subsetFraction !== undefined && { subsetFraction: o.subsetFraction }),
    ...(o.subsetMin !== undefined && { subsetMin: o.subsetMin }),
    ...(o.subsetMax !== undefined && { subsetMax: o.subsetMax }),
  })
  const runRace = mode === 'race' || mode === 'both'
  const runDeviation = mode === 'deviation' || mode === 'both'

  const reader = openReader(src, abortSignal(o.signal))
  try {
    // 1. race
    let numberOfTrials = 0
    let scored: readonly CatalogItem[]
    let energy: (number | undefined)[]
    let trials: (number | undefined)[]
    if (runRace) {
      const result = await raceResolved(reader, cat.items, raceOptions)
      numberOfTrials = result.numberOfTrials
      const maxEv = Math.max(1, ...result.items.map((r) => r.ev))
      scored = result.items.map((r) => r.item)
      energy = result.items.map((r) => r.ev / maxEv)
      trials = result.items.map((r) => r.increments)
    } else {
      scored = cat.items
      energy = scored.map(() => undefined)
      trials = scored.map(() => deviationRounds)
    }

    // 2. vitality
    const vitality: (number | undefined)[] = scored.map(() => undefined)
    if (withVitality) {
      for (let i = 0; i < scored.length; i++) vitality[i] = await generalVitalityReader(reader)
    }

    // 3. deviation — fair coins, eight per byte
    const byteBits = 8 * reader.bytesConsumed
    let coinBits = 0
    let deviations: (AdjustedDeviationResult | undefined)[] = scored.map(() => undefined)
    let multiplicity: MultiplicitySummary | undefined
    if (runDeviation) {
      const bits = bitReader(reader)
      const counts = await accumulateDeviation(bits, scored.length, deviationRounds)
      coinBits = bits.bitsUsed
      const family = adjustFamily(
        counts.map((k) => deviationStat(k, deviationRounds, prior)),
        alpha,
      )
      deviations = [...family.adjusted]
      multiplicity = family.summary
    }

    const results: ScanResult[] = scored.map((item, i) => {
      const v = vitality[i]
      return {
        id: item.id ?? item.name,
        name: item.name,
        ...(item.category !== undefined && { category: item.category }),
        ...(energy[i] !== undefined && { energy: energy[i] }),
        ...(trials[i] !== undefined && { trials: trials[i] }),
        ...(v !== undefined && { vitality: v, vitalityP: generalVitalitySf(v - 1) }),
        ...(deviations[i] !== undefined && { deviation: deviations[i] }),
        rank: 0,
      }
    })

    // rank: energy for race/both (equal energies keep the uniformly random draw
    // order), log Bayes factor for deviation-only (ties by id hash).
    if (runRace) {
      results.sort((a, b) => (b.energy ?? 0) - (a.energy ?? 0))
    } else {
      results.sort(byBayesFactor)
    }
    const ranked = results.map((r, i) => Object.freeze({ ...r, rank: i + 1 }))

    return Object.freeze({
      catalog: cat.id,
      mode,
      results: Object.freeze(ranked),
      numberOfTrials,
      ...(multiplicity !== undefined && { multiplicity }),
      source: src.name,
      accounting: Object.freeze({
        bytesConsumed: reader.bytesConsumed,
        bitsUsed: byteBits + coinBits,
      }),
    })
  } catch (error) {
    throw toScanError(error, src.name, 'scan')
  } finally {
    await reader.close()
  }
}
