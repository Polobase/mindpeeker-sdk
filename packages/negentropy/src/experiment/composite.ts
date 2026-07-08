import { NegentropyError } from '../errors.js'
import { normSf } from '../internal/special.js'
import { P_FLOOR } from '../stats/pvalues.js'
import { stoufferZ } from '../stats/zscores.js'
import type { EventResult, ExperimentComposite } from './types.js'

/**
 * Stouffer composite across pre-registered events: Z = Σzₑ/√E, one-sided.
 * Valid when events are independent (disjoint windows). This — not
 * per-event significance hunting — is the recommended primary statistic for
 * a multi-event experiment; for individual-event claims at level α over E
 * events, Bonferroni α/E applies.
 */
export function compositeZ(events: readonly EventResult[]): ExperimentComposite {
  if (events.length === 0) {
    throw new NegentropyError('insufficient_data', 'composite needs at least one event')
  }
  const z = stoufferZ(events.map((event) => event.z))
  return { z, pValue: Math.max(normSf(z), P_FLOOR), events: events.length }
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
