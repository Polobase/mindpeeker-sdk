import { NegentropyError } from '../errors.js'
import { DEFAULT_DITHER_SEED, labelSeed, uniformStream } from '../internal/prng.js'
import { normPpf } from '../internal/special.js'
import { zScores } from '../stats/zscores.js'
import type { Calibration, TrialSeries } from '../types.js'

/**
 * Bridges from lattice-valued randomness (bytes, trial sums) to the
 * continuous-sample negentropy estimators. Dither noise comes from a seeded
 * internal PRNG: deterministic per (seed, source label), and never drawn from
 * the randomness under test.
 *
 * Dither must be independent across sources that later meet in a
 * cross-source statistic (netvar, interSourceCorrelation, networkCoherence):
 * a shared dither sequence adds a common term to every source (+1/(12·k/4)
 * per pair for k-bit trials — ≈1.5σ of fake coherence after a day at 1 Hz
 * with 5 sources). The label mixed into the seed provides that independence.
 */
export interface DitherOptions {
  /** Caller seed, an integer (default 0x9e3779b9). Part of the replay record. */
  seed?: number
  /**
   * Label hashed into the seed so different streams get independent dither.
   * `ditheredTrialZ` defaults it to `series.source`; `probitBytes` has no
   * default — without a label it keeps the unlabeled stream for `seed`, so
   * pass distinct labels when probit-mapping several byte streams.
   */
  source?: string
}

function resolveSeed(opts: DitherOptions): number {
  const seed = opts.seed ?? DEFAULT_DITHER_SEED
  if (!Number.isInteger(seed)) {
    throw new NegentropyError('invalid_config', `dither seed must be an integer, got ${seed}`)
  }
  return seed
}

/**
 * Trial sums → z-scores + uniform dither over one lattice cell. The dithered
 * variable is continuous, and its differential entropy equals the discrete
 * entropy of the lattice variable (in lattice-spacing log units) — which is
 * what makes Vasicek meaningful on trial data. Under H0 the result is
 * approximately N(0, 1 + 1/(12·k/4)) with excess kurtosis −2/k + O(1/k²).
 *
 * The dither stream is seeded from `labelSeed(seed, source ?? series.source)`,
 * so two sources dithered with the default seed receive independent noise.
 * (Before 0.2.0 the default seed was shared by every call — identical dither
 * on every source.)
 */
export function ditheredTrialZ(
  series: TrialSeries,
  cal: Calibration,
  opts: DitherOptions = {},
): Float64Array {
  const zs = zScores(series, cal)
  const next = uniformStream(labelSeed(resolveSeed(opts), opts.source ?? series.source))
  for (let i = 0; i < zs.length; i++) zs[i] = (zs[i] as number) + (next() - 0.5) / cal.sd
  return zs
}

/**
 * Bytes → exactly standard normal samples under H0: u = (b + U(0,1))/256 is
 * uniform when bytes are, and Φ⁻¹(u) is then exactly N(0,1). The exact-null
 * mode — ideal for calibrating estimators and byte-level (non-trial) analysis.
 * Pass `source` to label the dither stream (independent noise per label);
 * without it the stream is seeded by `seed` alone.
 */
export function probitBytes(bytes: Uint8Array, opts: DitherOptions = {}): Float64Array {
  const seed = resolveSeed(opts)
  const next = uniformStream(opts.source === undefined ? seed : labelSeed(seed, opts.source))
  const out = new Float64Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = normPpf(((bytes[i] as number) + next()) / 256)
  return out
}
