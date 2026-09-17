import { FieldError } from '../errors.js'
import { drawNullFields, type FieldInput } from '../internal/draw.js'
import { circleRegionArea } from '../internal/geometry.js'
import { compareXY } from '../internal/neighbours.js'
import { checkSeed, seededSource } from '../internal/prng.js'
import { checkOptions, checkRuns, checkSignal } from '../internal/validate.js'
import {
  type EntropyAccounting,
  type FieldRegion,
  type Point,
  regionArea,
  validatePoints,
  validateRegion,
} from '../types.js'

export interface ScanStatisticOptions {
  /** Simulated CSR fields for the Monte-Carlo p. Default 999 (SaTScan's default). */
  runs?: number
  /**
   * Largest window as a fraction of the region's area (SaTScan: at most 50 %
   * of the population at risk). In (0, 0.5]; default 0.5.
   */
  maxFraction?: number
  /**
   * Entropy input for the null fields. When omitted, a seeded deterministic
   * PRNG (xoshiro128** from `seed`) supplies them.
   */
  source?: FieldInput
  /** Seed of the internal PRNG when `source` is omitted. Default 0. */
  seed?: number | bigint
  signal?: AbortSignal
}

/** The most likely cluster: the circular window with the largest likelihood ratio. */
export interface ScanCluster {
  /** Window centre (a data point). */
  readonly center: Point
  readonly radius: number
  /** Points inside the closed window, centre included. */
  readonly count: number
  /** CSR expectation $E = n\,|B \cap W|/A$. */
  readonly expected: number
  /** $\text{LLR} = c\ln(c/E) + (n-c)\ln\frac{n-c}{n-E}$ when $c > E$, else 0. */
  readonly llr: number
  /** Relative risk $\frac{c/E}{(n-c)/(n-E)}$. */
  readonly relativeRisk: number
}

export interface ScanStatistic {
  /** `undefined` when no window has more points than expected. */
  readonly cluster: ScanCluster | undefined
  /** The observed maximum LLR (0 without a cluster). */
  readonly llr: number
  /** $1 + \#\{\text{simulated max LLR} \ge \text{observed}\}$. */
  readonly rank: number
  /** `rank / (runs + 1)`. */
  readonly pValue: number
  readonly runs: number
  /** Entropy the null fields spent (PRNG bytes when no `source` was given). */
  readonly accounting: EntropyAccounting
  /** The PRNG seed used, when the null came from the internal PRNG. */
  readonly seed: bigint | undefined
}

function llrOf(c: number, e: number, n: number): number {
  if (!(c > e)) return 0
  const inside = c * Math.log(c / e)
  const outside = n - c > 0 ? (n - c) * Math.log((n - c) / (n - e)) : 0
  return inside + outside
}

/** Most likely cluster over circles centred on each point (radius stepping through its neighbours). */
function bestCluster(
  points: readonly Point[],
  region: FieldRegion,
  maxFraction: number,
  withCluster: boolean,
): { llr: number; cluster: ScanCluster | undefined } {
  const n = points.length
  const area = regionArea(region)
  const limit = maxFraction * area
  const d2 = new Float64Array(n)
  let best = 0
  let cluster: ScanCluster | undefined
  for (let i = 0; i < n; i++) {
    const p = points[i] as Point
    for (let j = 0; j < n; j++) {
      const q = points[j] as Point
      const dx = q.x - p.x
      const dy = q.y - p.y
      d2[j] = dx * dx + dy * dy
    }
    const sorted = Float64Array.from(d2).sort()
    let k = 0
    while (k < n) {
      let end = k
      while (end + 1 < n && sorted[end + 1] === sorted[k]) end++
      const r2 = sorted[k] as number
      k = end + 1
      if (r2 === 0) continue
      const radius = Math.sqrt(r2)
      const clipped = circleRegionArea(p, radius, region)
      if (clipped > limit) break
      const count = end + 1
      const expected = (n * clipped) / area
      const llr = llrOf(count, expected, n)
      const better =
        llr > best ||
        (withCluster &&
          llr === best &&
          llr > 0 &&
          cluster !== undefined &&
          (compareXY(p, cluster.center) < 0 ||
            (compareXY(p, cluster.center) === 0 && radius < cluster.radius)))
      if (better) {
        best = llr
        if (withCluster) {
          cluster = {
            center: p,
            radius,
            count,
            expected,
            llr,
            relativeRisk:
              count === n
                ? Number.POSITIVE_INFINITY
                : count / expected / ((n - count) / (n - expected)),
          }
        }
      }
    }
  }
  return { llr: best, cluster }
}

/**
 * Kulldorff's (1997) spatial scan statistic for a point pattern under the
 * Poisson/Bernoulli model with area as the population at risk: over every
 * circle centred on a data point whose radius steps through the distances to
 * the other points (clipped window area ≤ `maxFraction`·A), maximise
 * $$\text{LLR} = c\ln\frac{c}{E} + (n-c)\ln\frac{n-c}{n-E}\quad (c > E),
 * \qquad E = n\,\frac{|B\cap W|}{A},$$
 * which answers "is there an anomalous cluster *anywhere*" without choosing a
 * radius in advance. The p-value is the exact Monte-Carlo rank of the
 * observed maximum among `runs` CSR fields of the same size (SaTScan's
 * method), drawn from `source` or, by default, from a seeded PRNG so the
 * result is reproducible. Cost O(runs·n² log n).
 *
 * @throws FieldError `insufficient_data` (< 3 points), `invalid_config`
 *   (region, points, options, seed, input shape, replayed field),
 *   `insufficient_entropy`, `aborted`, `source_error`
 */
export async function scanStatistic(
  points: readonly Point[],
  region: FieldRegion,
  opts: ScanStatisticOptions = {},
): Promise<ScanStatistic> {
  validateRegion(region)
  validatePoints(points, region, 3)
  checkOptions(opts, 'scanStatistic')
  const runs = checkRuns(opts.runs ?? 999)
  const maxFraction = opts.maxFraction ?? 0.5
  if (typeof maxFraction !== 'number' || !(maxFraction > 0 && maxFraction <= 0.5)) {
    throw new FieldError(
      'invalid_config',
      `maxFraction must be in (0, 0.5], got ${String(maxFraction)}`,
    )
  }
  const signal = checkSignal(opts.signal)
  const seed = opts.source === undefined ? checkSeed(opts.seed ?? 0) : undefined
  if (opts.source !== undefined && opts.seed !== undefined) {
    throw new FieldError('invalid_config', 'pass source or seed, not both')
  }
  const observed = bestCluster(points, region, maxFraction, true)
  let rank = 1
  const input = opts.source ?? seededSource(seed as bigint)
  const accounting = await drawNullFields(input, points.length, region, runs, {
    signal,
    observed: points,
    onField: (field) => {
      if (bestCluster(field, region, maxFraction, false).llr >= observed.llr) rank++
    },
  })
  return Object.freeze({
    cluster: observed.cluster ? Object.freeze(observed.cluster) : undefined,
    llr: observed.llr,
    rank,
    pValue: rank / (runs + 1),
    runs,
    accounting,
    seed,
  })
}
