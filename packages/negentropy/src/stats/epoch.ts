import { NegentropyError } from '../errors.js'
import { assertFinite } from '../internal/assert.js'

/** Alignment of the events whose curves are averaged. */
export interface EpochOptions {
  /** Onset index of each event within its curve (one per curve). Default: all 0. */
  align?: readonly number[]
  /** Epoch length in steps. Default: the longest epoch every curve covers. */
  length?: number
  /** First epoch index relative to the onset (negative = pre-onset baseline). Default 0. */
  offset?: number
}

/**
 * Epoch average of per-event z curves (the GCP "epoch" recipe, e.g. New
 * Year's midnights across time zones; an event-related average): event e's
 * epoch covers indices align[e] + offset … align[e] + offset + length − 1 of
 * its curve, and output index j is the Stouffer combination across events
 * $$Z(j) = \frac{1}{\sqrt E}\sum_{e=1}^{E} z_e\big(\text{align}_e + \text{offset} + j\big).$$
 * With independent N(0, 1) inputs each Z(j) is N(0, 1); index j corresponds
 * to time offset + j from the onset. Feed the result to `cumulativeDeviation`
 * or `netvarMartingale` for an evoked-response curve. Every epoch must lie
 * inside its curve (`invalid_window` otherwise) and the values inside every
 * epoch must be finite (values outside the epochs are never read).
 * Overlapping epochs of the same underlying recording are not independent —
 * the N(0, 1) claim then fails.
 */
export function epochAverage(
  curves: readonly ArrayLike<number>[],
  opts: EpochOptions = {},
): Float64Array {
  const events = curves.length
  if (events === 0) {
    throw new NegentropyError('insufficient_data', 'epochAverage needs at least one curve')
  }
  const offset = opts.offset ?? 0
  if (!Number.isInteger(offset)) {
    throw new NegentropyError(
      'invalid_config',
      `epochAverage: offset must be an integer, got ${offset}`,
    )
  }
  const align = opts.align ?? new Array<number>(events).fill(0)
  if (align.length !== events) {
    throw new NegentropyError(
      'invalid_config',
      `epochAverage: need one align index per curve, got ${align.length} for ${events} curves`,
    )
  }
  let longest = Number.POSITIVE_INFINITY
  for (let e = 0; e < events; e++) {
    const curve = curves[e]
    if (curve === null || typeof curve !== 'object' || !Number.isInteger(curve.length)) {
      throw new NegentropyError('invalid_config', `epochAverage: curve ${e} is not array-like`)
    }
    const onset = align[e] as number
    if (!Number.isInteger(onset)) {
      throw new NegentropyError(
        'invalid_config',
        `epochAverage: align[${e}] must be an integer, got ${onset}`,
      )
    }
    const start = onset + offset
    if (start < 0) {
      throw new NegentropyError(
        'invalid_window',
        `epochAverage: event ${e} epoch starts at index ${start}, before its curve`,
      )
    }
    longest = Math.min(longest, (curves[e] as ArrayLike<number>).length - start)
  }
  const length = opts.length ?? longest
  if (!Number.isInteger(length) || length < 1) {
    throw new NegentropyError(
      'invalid_window',
      `epochAverage: epoch length must be a positive integer inside every curve, got ${length}`,
    )
  }
  if (length > longest) {
    throw new NegentropyError(
      'invalid_window',
      `epochAverage: an epoch of ${length} steps runs past a curve (longest common epoch ${Math.max(longest, 0)})`,
    )
  }
  const out = new Float64Array(length)
  for (let e = 0; e < events; e++) {
    const curve = curves[e] as ArrayLike<number>
    const start = (align[e] as number) + offset
    for (let j = 0; j < length; j++) {
      const value = curve[start + j] as number
      assertFinite(value, `epochAverage: curve ${e} at index ${start + j}`)
      out[j] = (out[j] as number) + value
    }
  }
  const scale = Math.sqrt(events)
  for (let j = 0; j < length; j++) out[j] = (out[j] as number) / scale
  return out
}
