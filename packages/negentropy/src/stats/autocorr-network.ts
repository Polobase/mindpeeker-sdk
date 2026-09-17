import { NegentropyError } from '../errors.js'
import { autocorrelation } from '../estimators/autocorrelation.js'
import { assertFiniteArray } from '../internal/assert.js'
import { normPpf } from '../internal/special.js'

/** Lag profile of a per-step network statistic; every array has index l − 1 for lag l. */
export interface NetworkAutocorrelation {
  /** Samples in the series. */
  n: number
  /** Sample autocorrelation ρ̂(l) (biased 1/n normalization, centered). */
  acf: Float64Array
  /** Lag z-scores ρ̂(l)·√n — N(0, 1) per lag for white noise (Bartlett). */
  z: Float64Array
  /** Integrated autocorrelation I(L) = Σ_{l≤L} z_l. */
  integrated: Float64Array
  /** Pointwise two-sided envelope z_{1−p/2}·√L for `integrated`. */
  envelope: Float64Array
  /** Pointwise two-sided band z_{1−p/2}/√n for `acf`. */
  band: number
}

/**
 * Autocorrelation profile of a per-step network statistic — the persistence
 * test of Bancel's reanalysis of the GCP ("test 3": does an event's network
 * deviation carry over from one second to the next?). Pass the per-step
 * series of the statistic, e.g. `networkCoherence(...).perStep` (the pair
 * product C1(t)) or Zₛ(t)² − 1 (netvar increments).
 *
 * For each lag l = 1 … maxLag the lag z-score is ρ̂(l)·√n (Bartlett's
 * white-noise approximation Var ρ̂(l) ≈ 1/n), and the integrated
 * autocorrelation I(L) = Σ_{l≤L} ρ̂(l)√n accumulates small same-sign
 * correlations over many lags; under H0 the lag z's are approximately
 * independent N(0, 1), so I(L) ≈ N(0, L) and `envelope[L−1]` = z_{1−p/2}·√L.
 * Both the band and the envelope are POINTWISE (one lag, or one L, chosen in
 * advance): scanning all lags for the first exit is a multiple comparison.
 * The approximation needs n ≫ maxLag (the biased estimator also shrinks
 * lag l by (n − l)/n). The series must be finite and non-constant.
 */
export function networkAutocorrelation(
  series: ArrayLike<number>,
  maxLag: number,
  opts: { p?: number } = {},
): NetworkAutocorrelation {
  const n = series.length
  const p = opts.p ?? 0.05
  if (typeof p !== 'number' || !(p > 0 && p < 1)) {
    throw new NegentropyError(
      'invalid_config',
      `networkAutocorrelation: p must be in (0, 1), got ${p}`,
    )
  }
  assertFiniteArray(series, 'networkAutocorrelation: series')
  const full = autocorrelation(series, maxLag)
  const critical = -normPpf(p / 2)
  const root = Math.sqrt(n)
  const acf = full.slice(1)
  const z = new Float64Array(maxLag)
  const integrated = new Float64Array(maxLag)
  const envelope = new Float64Array(maxLag)
  let running = 0
  for (let lag = 1; lag <= maxLag; lag++) {
    const zl = (full[lag] as number) * root
    running += zl
    z[lag - 1] = zl
    integrated[lag - 1] = running
    envelope[lag - 1] = critical * Math.sqrt(lag)
  }
  return { n, acf, z, integrated, envelope, band: critical / root }
}
