import { PsiError } from '../errors.js'
import type { TrialSeries } from '../types.js'

/** Throw `invalid_plan` unless `value` is an integer ≥ `min`. */
export function assertInteger(value: unknown, min: number, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new PsiError('invalid_plan', `${what} must be an integer ≥ ${min}, got ${String(value)}`)
  }
  return value
}

/** Throw `invalid_plan` unless `value` is a finite number in the open interval (lo, hi). */
export function assertOpenInterval(value: unknown, lo: number, hi: number, what: string): number {
  if (typeof value !== 'number' || !(value > lo && value < hi)) {
    throw new PsiError('invalid_plan', `${what} must be in (${lo}, ${hi}), got ${String(value)}`)
  }
  return value
}

/** Integer ≥ 8 — the SDK-wide trial size floor (negentropy's `validateBitsPerTrial`). */
export function assertBitsPerTrial(value: unknown, what = 'bitsPerTrial', source?: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 8) {
    throw new PsiError('invalid_plan', `${what} must be an integer ≥ 8, got ${String(value)}`, {
      ...(source !== undefined && { source }),
    })
  }
  return value
}

/**
 * Shared boundary check for caller-built trial series: a non-empty `source`
 * name, integer `bitsPerTrial ≥ 8`, and every sum finite in $[0, k]$. Turns
 * what would otherwise surface as NaN z-scores or a foreign `RangeError` deep
 * inside the numerics into `PsiError('invalid_plan')` naming the series.
 */
export function assertSeries(series: TrialSeries, what = 'series'): void {
  if (series === null || typeof series !== 'object') {
    throw new PsiError('invalid_plan', `${what} must be a TrialSeries object`)
  }
  if (typeof series.source !== 'string' || series.source.length === 0) {
    throw new PsiError('invalid_plan', `${what} needs a non-empty source name`)
  }
  const k = assertBitsPerTrial(series.bitsPerTrial, `${what} (${series.source}) bitsPerTrial`)
  const sums = series.sums
  if (sums === null || typeof sums !== 'object' || typeof sums.length !== 'number') {
    throw new PsiError('invalid_plan', `${what} (${series.source}) has no sums array`, {
      source: series.source,
    })
  }
  for (let i = 0; i < sums.length; i++) {
    const x = sums[i] as number
    if (!(x >= 0 && x <= k)) {
      throw new PsiError(
        'invalid_plan',
        `${what} (${series.source}) trial ${i} sum ${x} is outside [0, ${k}]`,
        { source: series.source },
      )
    }
  }
}
