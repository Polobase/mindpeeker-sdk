import { uniformStream } from '../internal/prng.js'
import { normPpf } from '../internal/special.js'
import { zScores } from '../stats/zscores.js'
import type { Calibration, TrialSeries } from '../types.js'

/**
 * Bridges from lattice-valued randomness (bytes, trial sums) to the
 * continuous-sample negentropy estimators. Dither noise comes from a seeded
 * internal PRNG: deterministic per seed, and never drawn from the randomness
 * under test.
 */
export interface DitherOptions {
  seed?: number
}

/**
 * Trial sums → z-scores + uniform dither over one lattice cell. The dithered
 * variable is continuous, and its differential entropy equals the discrete
 * entropy of the lattice variable (in lattice-spacing log units) — which is
 * what makes Vasicek meaningful on trial data. Under H0 the result is
 * approximately N(0, 1 + 1/(12·k/4)) with excess kurtosis −2/k + O(1/k²).
 */
export function ditheredTrialZ(
  series: TrialSeries,
  cal: Calibration,
  opts: DitherOptions = {},
): Float64Array {
  const zs = zScores(series, cal)
  const next = uniformStream(opts.seed)
  for (let i = 0; i < zs.length; i++) zs[i] = (zs[i] as number) + (next() - 0.5) / cal.sd
  return zs
}

/**
 * Bytes → exactly standard normal samples under H0: u = (b + U(0,1))/256 is
 * uniform when bytes are, and Φ⁻¹(u) is then exactly N(0,1). The exact-null
 * mode — ideal for calibrating estimators and byte-level (non-trial) analysis.
 */
export function probitBytes(bytes: Uint8Array, opts: DitherOptions = {}): Float64Array {
  const next = uniformStream(opts.seed)
  const out = new Float64Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = normPpf(((bytes[i] as number) + next()) / 256)
  return out
}
