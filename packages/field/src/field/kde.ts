import { FieldError } from '../errors.js'
import { drawNullFields, type FieldInput } from '../internal/draw.js'
import { checkInteger, checkOptions, checkRuns, checkSignal } from '../internal/validate.js'
import {
  type EntropyAccounting,
  type FieldRegion,
  insideRegion,
  type Point,
  regionBounds,
  validatePoints,
  validateRegion,
} from '../types.js'

/** A fixed isotropic Gaussian σ (region units) or a covariance rule. */
export type Bandwidth = number | 'scott' | 'silverman'

export interface KernelDensityOptions {
  /**
   * `'silverman'` (default, pyrandonaut) or `'scott'`: scipy's
   * `gaussian_kde` rules — the kernel covariance is the sample covariance
   * (n − 1 denominator) times $f^2$, with $f = n^{-1/6}$ for Scott and
   * $(n(d+2)/4)^{-1/(d+4)} = n^{-1/6}$ for Silverman, identical in two
   * dimensions. A number is an isotropic σ in region units (spatstat's
   * `sigma`), not scipy's scalar factor.
   */
  bandwidth?: Bandwidth
  /** Grid nodes per axis, `g` or `[gx, gy]` (each 2–2048). Default 100. */
  grid?: number | readonly [number, number]
  /**
   * `'region'` (default): nodes span the region's bounding box;
   * `'data'`: they span the points' bounding box, as pyrandonaut does.
   * Nodes include both ends (numpy `mgrid[lo:hi:g j]`).
   */
  extent?: 'region' | 'data'
}

export interface KernelDensity {
  readonly gx: number
  readonly gy: number
  /** Node x coordinates (length gx). */
  readonly xs: Float64Array
  /** Node y coordinates (length gy). */
  readonly ys: Float64Array
  /** Density at node `(xs[ix], ys[iy])`, index `ix + iy·gx`; integrates to ≈ 1 over the plane. */
  readonly values: Float64Array
  /** 1 where the node lies in the region (attractor/void candidates). */
  readonly inside: Uint8Array
  /** Kernel covariance `[σxx, σxy, σyy]`. */
  readonly covariance: readonly [number, number, number]
}

/** A KDE extreme: the node of maximum (attractor) or minimum (void) density inside the region. */
export interface KdeExtreme {
  readonly point: Point
  readonly density: number
  /** Node index `ix + iy·gx`. */
  readonly index: number
}

function gridSize(grid: KernelDensityOptions['grid']): [number, number] {
  if (grid === undefined) return [100, 100]
  if (typeof grid === 'number') {
    const g = checkInteger(grid, 'grid', 2, 2048)
    return [g, g]
  }
  if (!Array.isArray(grid) || grid.length !== 2) {
    throw new FieldError('invalid_config', 'grid must be a number or [gx, gy]')
  }
  return [checkInteger(grid[0], 'grid[0]', 2, 2048), checkInteger(grid[1], 'grid[1]', 2, 2048)]
}

function kernelCovariance(
  points: readonly Point[],
  bandwidth: Bandwidth,
): [number, number, number] {
  if (typeof bandwidth === 'number') {
    if (!Number.isFinite(bandwidth) || bandwidth <= 0) {
      throw new FieldError('invalid_config', `bandwidth must be finite and > 0, got ${bandwidth}`)
    }
    return [bandwidth * bandwidth, 0, bandwidth * bandwidth]
  }
  if (bandwidth !== 'scott' && bandwidth !== 'silverman') {
    throw new FieldError('invalid_config', `bandwidth must be a number, 'scott' or 'silverman'`)
  }
  const n = points.length
  let mx = 0
  let my = 0
  for (const p of points) {
    mx += p.x
    my += p.y
  }
  mx /= n
  my /= n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of points) {
    sxx += (p.x - mx) * (p.x - mx)
    sxy += (p.x - mx) * (p.y - my)
    syy += (p.y - my) * (p.y - my)
  }
  const f2 = n ** (-1 / 3) // f = n^(-1/6) for both rules when d = 2
  return [(sxx / (n - 1)) * f2, (sxy / (n - 1)) * f2, (syy / (n - 1)) * f2]
}

function resolve(points: readonly Point[], opts: KernelDensityOptions) {
  checkOptions(opts, 'kernelDensity')
  const [gx, gy] = gridSize(opts.grid)
  const extent = opts.extent ?? 'region'
  if (extent !== 'region' && extent !== 'data') {
    throw new FieldError('invalid_config', `extent must be 'region' or 'data'`)
  }
  kernelCovariance(points, opts.bandwidth ?? 'silverman') // validate before any sampling
  return { gx, gy, extent, bandwidth: opts.bandwidth ?? 'silverman' }
}

function densityGrid(
  points: readonly Point[],
  region: FieldRegion,
  gx: number,
  gy: number,
  extent: 'region' | 'data',
  bandwidth: Bandwidth,
): KernelDensity {
  const n = points.length
  const [sxx, sxy, syy] = kernelCovariance(points, bandwidth)
  const det = sxx * syy - sxy * sxy
  if (!(det > 0) || !Number.isFinite(det)) {
    throw new FieldError('insufficient_data', 'kernel covariance is singular (collinear points?)')
  }
  const a = syy / det
  const b = -sxy / det
  const c = sxx / det
  const norm = 1 / (2 * Math.PI * Math.sqrt(det) * n)
  let [x0, y0, x1, y1] = regionBounds(region)
  if (extent === 'data') {
    x0 = y0 = Number.POSITIVE_INFINITY
    x1 = y1 = Number.NEGATIVE_INFINITY
    for (const p of points) {
      x0 = Math.min(x0, p.x)
      x1 = Math.max(x1, p.x)
      y0 = Math.min(y0, p.y)
      y1 = Math.max(y1, p.y)
    }
  }
  const sx = (x1 - x0) / (gx - 1)
  const sy = (y1 - y0) / (gy - 1)
  const xs = Float64Array.from({ length: gx }, (_, i) => i * sx + x0)
  const ys = Float64Array.from({ length: gy }, (_, i) => i * sy + y0)
  const values = new Float64Array(gx * gy)
  const inside = new Uint8Array(gx * gy)
  for (let iy = 0; iy < gy; iy++) {
    const y = ys[iy] as number
    for (let ix = 0; ix < gx; ix++) {
      const x = xs[ix] as number
      let sum = 0
      for (const p of points) {
        const dx = x - p.x
        const dy = y - p.y
        sum += Math.exp(-0.5 * (a * dx * dx + 2 * b * dx * dy + c * dy * dy))
      }
      values[ix + iy * gx] = sum * norm
      inside[ix + iy * gx] = insideRegion({ x, y }, region) ? 1 : 0
    }
  }
  return Object.freeze({ gx, gy, xs, ys, values, inside, covariance: [sxx, sxy, syy] as const })
}

/**
 * Gaussian kernel density estimate of a point pattern on a regular grid —
 * the density surface the open Randonaut ports (pyrandonaut, OpenRando) take
 * their "attractor" from. Plain (not edge-corrected) sum
 * $\hat f(x) = \frac1n\sum_i \mathcal N(x;\,p_i,\,\Sigma)$ over the nodes;
 * with `{ bandwidth: 'silverman', grid: 100, extent: 'data' }` it matches
 * scipy's `gaussian_kde(..., bw_method="silverman")` on pyrandonaut's
 * `mgrid` exactly. Cost O(gx·gy·n).
 *
 * @throws FieldError `insufficient_data` (< 3 points, singular covariance),
 *   `invalid_config` (bad options or points outside the region)
 */
export function kernelDensity(
  points: readonly Point[],
  region: FieldRegion,
  opts: KernelDensityOptions = {},
): KernelDensity {
  validateRegion(region)
  validatePoints(points, region, 3)
  const r = resolve(points, opts)
  return densityGrid(points, region, r.gx, r.gy, r.extent, r.bandwidth)
}

function extreme(kde: KernelDensity, which: 'max' | 'min'): KdeExtreme {
  let best = -1
  // numpy's argmax order over pyrandonaut's mgrid: x outer, y inner, first wins
  for (let ix = 0; ix < kde.gx; ix++) {
    for (let iy = 0; iy < kde.gy; iy++) {
      const idx = ix + iy * kde.gx
      if (kde.inside[idx] !== 1) continue
      const v = kde.values[idx] as number
      if (
        best < 0 ||
        (which === 'max' ? v > (kde.values[best] as number) : v < (kde.values[best] as number))
      ) {
        best = idx
      }
    }
  }
  if (best < 0) throw new FieldError('insufficient_data', 'no grid node lies inside the region')
  const ix = best % kde.gx
  const iy = (best - ix) / kde.gx
  return Object.freeze({
    point: Object.freeze({ x: kde.xs[ix] as number, y: kde.ys[iy] as number }),
    density: kde.values[best] as number,
    index: best,
  })
}

/** The grid node of highest density inside the region (pyrandonaut's KDE attractor). */
export function kdeAttractor(
  points: readonly Point[],
  region: FieldRegion,
  opts: KernelDensityOptions = {},
): KdeExtreme {
  return extreme(kernelDensity(points, region, opts), 'max')
}

/** The grid node of lowest density inside the region (the KDE void). */
export function kdeVoid(
  points: readonly Point[],
  region: FieldRegion,
  opts: KernelDensityOptions = {},
): KdeExtreme {
  return extreme(kernelDensity(points, region, opts), 'min')
}

export interface KdeSignificanceOptions extends KernelDensityOptions {
  /** Simulated CSR fields. Default 99. */
  runs?: number
  signal?: AbortSignal
}

/** A KDE extreme with its Monte-Carlo rank among `runs` CSR fields. */
export interface KdeExtremeSignificance extends KdeExtreme {
  /** $1 + \#\{\text{simulated extremes at least as extreme}\}$. */
  readonly rank: number
  readonly p: number
}

export interface KdeSignificance {
  readonly attractor: KdeExtremeSignificance
  readonly void: KdeExtremeSignificance
  readonly runs: number
  readonly accounting: EntropyAccounting
}

/**
 * Calibrated p-values for the KDE attractor (maximum grid density) and void
 * (minimum): the whole procedure — bandwidth rule, grid, argmax/argmin — is
 * rerun on `runs` CSR fields of the same size drawn from `source`, and
 * $p = (1 + \#\{\text{simulated} \ge \text{observed}\})/(1 + \text{runs})$
 * (≤ for the void). This is the chance baseline the open Randonaut KDE ports
 * never report. A replayed observed field throws `invalid_config`.
 *
 * @throws FieldError as {@link kernelDensity}, plus `insufficient_entropy`,
 *   `aborted`, `source_error` and `invalid_config` for runs or input shape
 */
export async function kdeSignificance(
  source: FieldInput,
  points: readonly Point[],
  region: FieldRegion,
  opts: KdeSignificanceOptions = {},
): Promise<KdeSignificance> {
  validateRegion(region)
  validatePoints(points, region, 3)
  const r = resolve(points, opts)
  const runs = checkRuns(opts.runs ?? 99)
  const signal = checkSignal(opts.signal)
  const observed = densityGrid(points, region, r.gx, r.gy, r.extent, r.bandwidth)
  const max = extreme(observed, 'max')
  const min = extreme(observed, 'min')
  let maxRank = 1
  let minRank = 1
  const accounting = await drawNullFields(source, points.length, region, runs, {
    signal,
    observed: points,
    onField: (field) => {
      const kde = densityGrid(field, region, r.gx, r.gy, r.extent, r.bandwidth)
      if (extreme(kde, 'max').density >= max.density) maxRank++
      if (extreme(kde, 'min').density <= min.density) minRank++
    },
  })
  return Object.freeze({
    attractor: Object.freeze({ ...max, rank: maxRank, p: maxRank / (runs + 1) }),
    void: Object.freeze({ ...min, rank: minRank, p: minRank / (runs + 1) }),
    runs,
    accounting,
  })
}
