import { NegentropyError } from '../errors.js'
import type { Calibration, TrialSeries } from '../types.js'

/** z_i = (sum_i − cal.mean) / cal.sd for every trial in the series. */
export function zScores(series: TrialSeries, cal: Calibration): Float64Array {
  if (cal.source !== series.source || cal.bitsPerTrial !== series.bitsPerTrial) {
    throw new NegentropyError(
      'calibration_required',
      `calibration is for ${cal.source}@${cal.bitsPerTrial} bits, series is ${series.source}@${series.bitsPerTrial} bits`,
      { source: series.source },
    )
  }
  const zs = new Float64Array(series.sums.length)
  for (let i = 0; i < zs.length; i++) zs[i] = ((series.sums[i] as number) - cal.mean) / cal.sd
  return zs
}

/**
 * Stouffer's combined z: Σz / √n. Assumes the inputs are independent —
 * correlated sources inflate its variance, which is exactly what
 * `interSourceCorrelation` measures; do not "fix" it here.
 */
export function stoufferZ(zs: ArrayLike<number>): number {
  if (zs.length === 0) {
    throw new NegentropyError('insufficient_data', 'stoufferZ needs at least one z-score')
  }
  let sum = 0
  for (let i = 0; i < zs.length; i++) sum += zs[i] as number
  return sum / Math.sqrt(zs.length)
}
