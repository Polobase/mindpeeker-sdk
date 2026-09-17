import { chi2Cdf, chi2Sf } from '@mindpeeker/negentropy/numerics'
import { FieldError } from '../errors.js'
import { circleRectArea } from '../internal/geometry.js'
import { checkInteger, checkOptions } from '../internal/validate.js'
import {
  type FieldRegion,
  type Point,
  regionArea,
  regionBounds,
  validatePoints,
  validateRegion,
} from '../types.js'

export interface QuadratTestOptions {
  /** `'pearson'` (default) $X^2 = \sum (O-E)^2/E$, or `'g2'` $G^2 = 2\sum_{O>0} O\ln(O/E)$. */
  statistic?: 'pearson' | 'g2'
  /**
   * `'two.sided'` (default, spatstat) $p = 2\min(P_{lo}, P_{up})$;
   * `'clustered'` the upper tail; `'regular'` the lower tail.
   */
  alternative?: 'two.sided' | 'clustered' | 'regular'
}

export interface QuadratTest {
  readonly nx: number
  readonly ny: number
  /**
   * Observed counts per cell, row-major from the lower-left corner:
   * index `ix + iy·nx` with `ix` along x and `iy` along y (cells with zero
   * area inside a disk region hold 0 and are excluded from the test).
   */
  readonly counts: Int32Array
  /** Expected counts $E_c = n\,|c \cap W|/A$ (0 for cells outside the region). */
  readonly expected: Float64Array
  readonly statistic: number
  readonly statisticName: 'pearson' | 'g2'
  /** Degrees of freedom: cells with positive area − 1 (the intensity is estimated). */
  readonly df: number
  readonly alternative: 'two.sided' | 'clustered' | 'regular'
  /** χ² reference p (asymptotic; spatstat warns when any E < 5, see `minExpected`). */
  readonly pValue: number
  /** Smallest expected count among the tested cells. */
  readonly minExpected: number
  /**
   * Index of dispersion $X^2/(m-1)$ — for equal-area cells exactly the
   * variance-to-mean ratio $s^2/\bar x$ of the counts (≈ 1 under CSR, > 1
   * clustered, < 1 regular). Always from the Pearson statistic.
   */
  readonly dispersionIndex: number
  /** Two-sided χ²(m−1) p of the dispersion index (Fisher, Thornton & Mackenzie 1922). */
  readonly dispersionP: number
}

/**
 * Quadrat-count test of complete spatial randomness (spatstat `quadrat.test`
 * with `method = "Chisq"`): partition the region's bounding box into
 * `nx × ny` equal cells, count points per cell and compare to the CSR
 * expectation $E_c = n\,|c \cap W|/A$ (exact clipped areas for a disk region)
 * with Pearson's $X^2$ or the likelihood-ratio $G^2$ on $m - 1$ degrees of
 * freedom, m = cells with positive area. A point on an interior cell edge
 * belongs to the cell above/right of it; points on the outer edge to the
 * last cell. O(n + nx·ny).
 *
 * @throws FieldError `insufficient_data` (< 2 points or < 2 usable cells),
 *   `invalid_config` (bad region, grid, options, or points outside the region)
 */
export function quadratTest(
  points: readonly Point[],
  region: FieldRegion,
  nx: number,
  ny: number,
  opts: QuadratTestOptions = {},
): QuadratTest {
  validateRegion(region)
  validatePoints(points, region, 2)
  checkInteger(nx, 'nx', 1, 10_000)
  checkInteger(ny, 'ny', 1, 10_000)
  checkOptions(opts, 'quadratTest')
  const statisticName = opts.statistic ?? 'pearson'
  const alternative = opts.alternative ?? 'two.sided'
  if (statisticName !== 'pearson' && statisticName !== 'g2') {
    throw new FieldError('invalid_config', `statistic must be 'pearson' or 'g2'`)
  }
  if (!['two.sided', 'clustered', 'regular'].includes(alternative)) {
    throw new FieldError(
      'invalid_config',
      `alternative must be 'two.sided', 'clustered' or 'regular'`,
    )
  }
  const n = points.length
  const [x0, y0, x1, y1] = regionBounds(region)
  const cw = (x1 - x0) / nx
  const ch = (y1 - y0) / ny
  const counts = new Int32Array(nx * ny)
  for (const p of points) {
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((p.x - x0) / cw)))
    const iy = Math.min(ny - 1, Math.max(0, Math.floor((p.y - y0) / ch)))
    counts[ix + iy * nx] = (counts[ix + iy * nx] as number) + 1
  }
  const area = regionArea(region)
  const expected = new Float64Array(nx * ny)
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const cellArea =
        region.kind === 'rect'
          ? cw * ch
          : // disk ∩ cell, via the circle-rectangle area in the cell's own frame
            circleRectArea(-(x0 + ix * cw), -(y0 + iy * ch), region.radius, cw, ch)
      expected[ix + iy * nx] = (n * cellArea) / area
    }
  }
  let m = 0
  let pearson = 0
  let g2 = 0
  let minExpected = Number.POSITIVE_INFINITY
  for (let c = 0; c < counts.length; c++) {
    const e = expected[c] as number
    if (!(e > 0)) continue
    const o = counts[c] as number
    m++
    minExpected = Math.min(minExpected, e)
    pearson += ((o - e) * (o - e)) / e
    if (o > 0) g2 += o * Math.log(o / e)
  }
  if (m < 2) {
    throw new FieldError(
      'insufficient_data',
      `quadratTest needs ≥ 2 cells inside the region, got ${m}`,
    )
  }
  g2 *= 2
  const df = m - 1
  const statistic = statisticName === 'pearson' ? pearson : Math.max(0, g2)
  const pValue = tailP(statistic, df, alternative)
  return Object.freeze({
    nx,
    ny,
    counts,
    expected,
    statistic,
    statisticName,
    df,
    alternative,
    pValue,
    minExpected,
    dispersionIndex: pearson / df,
    dispersionP: tailP(pearson, df, 'two.sided'),
  })
}

function tailP(x: number, df: number, alternative: 'two.sided' | 'clustered' | 'regular'): number {
  const upper = chi2Sf(x, df)
  const lower = chi2Cdf(x, df)
  if (alternative === 'clustered') return upper
  if (alternative === 'regular') return lower
  return Math.min(1, 2 * Math.min(upper, lower))
}
