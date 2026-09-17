import { drawNullFields, type FieldInput } from '../internal/draw.js'
import { neighbourCounts } from '../internal/neighbours.js'
import { checkOptions, checkRuns, checkSignal } from '../internal/validate.js'
import {
  type EntropyAccounting,
  type FieldRegion,
  type Point,
  regionArea,
  validatePoints,
  validateRegion,
} from '../types.js'
import { type AttractorOptions, resolveRadius } from './attractors.js'

/** Monte-Carlo rank of one extreme among the observed field and `runs` CSR fields. */
export interface ExtremeSignificance {
  /** The observed statistic (max count for the attractor, min count for the void). */
  readonly neighbours: number
  /**
   * $1 + \#\{\text{simulated fields at least as extreme}\}$ — ties count
   * against the observed field, so the test is conservative for counts.
   */
  readonly rank: number
  /** `rank / (runs + 1)`: $P(p \le \alpha) \le \alpha$ under CSR for every α. */
  readonly p: number
}

export interface FieldSignificance {
  /** Whole-field test of the maximum neighbour count (the attractor). */
  readonly attractor: ExtremeSignificance
  /** Whole-field test of the minimum neighbour count (the void). */
  readonly void: ExtremeSignificance
  readonly radius: number
  /** Interior CSR expectation of a point's neighbour count, $(n-1)\pi r^2/A$. */
  readonly expectedNeighbours: number
  readonly runs: number
  /** Entropy the simulated fields spent. */
  readonly accounting: EntropyAccounting
}

export interface FieldSignificanceOptions extends AttractorOptions {
  /** Simulated CSR fields. Default 99 (smallest attainable p = 0.01). */
  runs?: number
  signal?: AbortSignal
}

function maxMin(counts: Int32Array): [number, number] {
  let max = 0
  let min = Number.POSITIVE_INFINITY
  for (const c of counts) {
    if (c > max) max = c
    if (c < min) min = c
  }
  return [max, min]
}

/**
 * The calibrated whole-field p-value for the attractor and the void — the
 * honest version of Randonautica's "significance". The statistics are
 * exactly the ones {@link attractors} reports, $T_{max} = \max_i k_i(r)$ and
 * $T_{min} = \min_i k_i(r)$; their null distribution is simulated by drawing
 * `runs` CSR fields of the same size from `source` with the same sampler as
 * `sampleField` (one advancing reader, disjoint bytes), and
 * $p = (1 + \#\{T^{sim} \text{ at least as extreme}\})/(1 + \text{runs})$ —
 * an exact Monte-Carlo test (Besag & Diggle 1977) that accounts for the n
 * dependent counts, the edge effects and the discreteness at once. Under CSR
 * the void is almost always a zero count, so its p is usually near 1: a
 * sparse corner in a random field is not evidence of anything.
 *
 * A simulated field identical to the observed one (a replayed batch or a
 * restarting source) throws `invalid_config`.
 *
 * @throws FieldError `invalid_config` (region, points, radius options, runs,
 *   input shape, replayed field), `insufficient_data` (< 3 points),
 *   `insufficient_entropy`, `aborted`, `source_error`
 */
export async function fieldSignificance(
  source: FieldInput,
  points: readonly Point[],
  region: FieldRegion,
  opts: FieldSignificanceOptions = {},
): Promise<FieldSignificance> {
  validateRegion(region)
  validatePoints(points, region, 3)
  checkOptions(opts, 'fieldSignificance')
  const n = points.length
  const radius = resolveRadius(
    n,
    region,
    {
      ...(opts.radius !== undefined ? { radius: opts.radius } : {}),
      ...(opts.expectedNeighbours !== undefined
        ? { expectedNeighbours: opts.expectedNeighbours }
        : {}),
    },
    'fieldSignificance',
  )
  const runs = checkRuns(opts.runs ?? 99)
  const signal = checkSignal(opts.signal)
  const [obsMax, obsMin] = maxMin(neighbourCounts(points, radius, region))
  let maxRank = 1
  let minRank = 1
  const accounting = await drawNullFields(source, n, region, runs, {
    signal,
    observed: points,
    onField: (field) => {
      const [max, min] = maxMin(neighbourCounts(field, radius, region))
      if (max >= obsMax) maxRank++
      if (min <= obsMin) minRank++
    },
  })
  return Object.freeze({
    attractor: Object.freeze({ neighbours: obsMax, rank: maxRank, p: maxRank / (runs + 1) }),
    void: Object.freeze({ neighbours: obsMin, rank: minRank, p: minRank / (runs + 1) }),
    radius,
    expectedNeighbours: ((n - 1) * Math.PI * radius * radius) / regionArea(region),
    runs,
    accounting,
  })
}
