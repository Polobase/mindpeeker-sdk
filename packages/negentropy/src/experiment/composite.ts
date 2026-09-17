import { NegentropyError } from '../errors.js'
import { normSf } from '../internal/special.js'
import { P_FLOOR } from '../stats/pvalues.js'
import { stoufferZ } from '../stats/zscores.js'
import type { EventResult, ExperimentComposite } from './types.js'

function eventZs(events: readonly EventResult[], name: string): number[] {
  if (events.length === 0) {
    throw new NegentropyError('insufficient_data', `${name} needs at least one event`)
  }
  return events.map((event) => {
    if (event.status === 'incomplete') {
      throw new NegentropyError(
        'invalid_config',
        `${name}: event ${event.id} is incomplete and cannot enter a composite`,
      )
    }
    return event.z
  })
}

/**
 * Stouffer composite across pre-registered events: Z = Σzₑ/√E, one-sided.
 * Valid when events are independent (disjoint windows) — `independent: true`,
 * `method: 'stouffer'`. This — not per-event significance hunting — is the
 * recommended primary statistic for a multi-event experiment; for
 * individual-event claims at level α over E events, Bonferroni α/E applies.
 * Incomplete events or non-finite z's throw `invalid_config`; an empty list
 * throws `insufficient_data`. `analyzeTrials` switches to `brownCompositeZ`
 * by itself when windows overlap.
 */
export function compositeZ(events: readonly EventResult[]): ExperimentComposite {
  const zs = eventZs(events, 'compositeZ')
  const z = stoufferZ(zs)
  return {
    z,
    pValue: Math.max(normSf(z), P_FLOOR),
    events: events.length,
    independent: true,
    method: 'stouffer',
    variance: events.length,
  }
}

/**
 * Composite for DEPENDENT events: Brown's (1975) covariance correction in its
 * Stouffer form (Strube 1985). With R the H0 correlation matrix of the event
 * z's, Var(Σzₑ) = Σᵢⱼ Rᵢⱼ, so
 * $$Z = \frac{\sum_e z_e}{\sqrt{\sum_{i,j} R_{ij}}}$$
 * is standard normal under H0 when the z's are jointly normal. Overlapping or
 * repeated windows make plain Stouffer anti-conservative (same-window
 * netvar + devvar + correlation over 3 sources: Var ≈ 1.93, not 1). `correlation`
 * must be a symmetric E×E matrix with unit diagonal and entries in [−1, 1],
 * and Σᵢⱼ Rᵢⱼ > 0 (`invalid_config`).
 */
export function brownCompositeZ(
  events: readonly EventResult[],
  correlation: readonly (readonly number[])[],
): ExperimentComposite {
  const zs = eventZs(events, 'brownCompositeZ')
  const e = zs.length
  if (correlation.length !== e || correlation.some((row) => row.length !== e)) {
    throw new NegentropyError(
      'invalid_config',
      `brownCompositeZ: correlation must be ${e}×${e} for ${e} events`,
    )
  }
  let varianceSum = 0
  for (let i = 0; i < e; i++) {
    for (let j = 0; j < e; j++) {
      const r = (correlation[i] as readonly number[])[j] as number
      const mirror = (correlation[j] as readonly number[])[i] as number
      const valid =
        Number.isFinite(r) &&
        r >= -1 &&
        r <= 1 &&
        Math.abs(r - mirror) <= 1e-12 &&
        (i !== j || r === 1)
      if (!valid) {
        throw new NegentropyError(
          'invalid_config',
          `brownCompositeZ: correlation[${i}][${j}] = ${r} breaks symmetry, the unit diagonal or [−1, 1]`,
        )
      }
      varianceSum += r
    }
  }
  if (!(varianceSum > 0)) {
    throw new NegentropyError(
      'invalid_config',
      `brownCompositeZ: Σᵢⱼ Rᵢⱼ must be > 0, got ${varianceSum}`,
    )
  }
  let sum = 0
  for (const z of zs) {
    if (!Number.isFinite(z)) {
      throw new NegentropyError('invalid_config', `brownCompositeZ: z must be finite, got ${z}`)
    }
    sum += z
  }
  const z = sum / Math.sqrt(varianceSum)
  return {
    z,
    pValue: Math.max(normSf(z), P_FLOOR),
    events: e,
    independent: false,
    method: 'brown',
    variance: varianceSum,
  }
}

/** Bonferroni-corrected significance threshold for individual-event claims. */
export function bonferroni(alpha: number, events: number): number {
  if (!(alpha > 0 && alpha < 1) || !Number.isInteger(events) || events < 1) {
    throw new NegentropyError(
      'invalid_config',
      `bad bonferroni inputs: alpha=${alpha}, events=${events}`,
    )
  }
  return alpha / events
}
