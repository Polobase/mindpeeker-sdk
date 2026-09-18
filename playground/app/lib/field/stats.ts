// Reference numbers the page shows next to the SDK's empirical ones, and the
// small reshaping the shared charts need.
//
// CLIENT ONLY: `@mindpeeker/negentropy/numerics` is the SDK's own
// fixture-validated numerical core, so the exact binomial and Poisson curves
// here are the same ones the field package's tails are built on.

import type { FieldRegion, Point } from '@mindpeeker/field'
import { binomialPmf, lnGamma } from '@mindpeeker/negentropy/numerics'
import { areaOf } from './types'

/** How many other points lie within `radius` of each point. O(n²). */
export function neighbourCounts(points: readonly Point[], radius: number): Int32Array {
  const n = points.length
  const counts = new Int32Array(n)
  const r2 = radius * radius
  for (let i = 0; i < n; i++) {
    const a = points[i] as Point
    for (let j = i + 1; j < n; j++) {
      const b = points[j] as Point
      const dx = a.x - b.x
      const dy = a.y - b.y
      if (dx * dx + dy * dy <= r2) {
        counts[i] = (counts[i] as number) + 1
        counts[j] = (counts[j] as number) + 1
      }
    }
  }
  return counts
}

/** The interior CSR probability that a given other point falls in B(p, r): πr²/A. */
export function interiorProbability(radius: number, region: FieldRegion): number {
  return (Math.PI * radius * radius) / areaOf(region)
}

export interface CountShape {
  categories: string[]
  observed: number[]
  /** Exact interior Binomial(n−1, πr²/A) frequencies, n × pmf(k). */
  expected: number[]
  max: number
}

/**
 * The neighbour-count distribution of the field against its exact interior
 * binomial reference. The reference ignores edge clipping (points near the
 * boundary have a smaller disk inside W), so it sits slightly above the
 * observed counts in the upper tail even under CSR — the per-point statistics
 * in `attractors` use the clipped area instead.
 */
export function countShape(counts: Int32Array, n: number, p: number): CountShape {
  let max = 0
  for (const c of counts) max = Math.max(max, c)
  const top = Math.max(max, 1)
  const categories: string[] = []
  const observed: number[] = []
  const expected: number[] = []
  for (let k = 0; k <= top; k++) {
    categories.push(String(k))
    observed.push(0)
    expected.push(n * binomialPmf(k, n - 1, p))
  }
  for (const c of counts) observed[c] = (observed[c] as number) + 1
  return { categories, observed, expected, max }
}

/** Poisson pmf via the SDK's log-gamma — the quadrat-count reference. */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  return Math.exp(-lambda + k * Math.log(lambda) - lnGamma(k + 1))
}

export interface QuadratShape {
  categories: string[]
  observed: number[]
  expected: number[]
}

/**
 * Cells holding 0, 1, 2 … points, against the Poisson reference of the SAME
 * cells: Σ_c Poisson(k; E_c) over the cells with positive area. For equal-area
 * cells that is m·Poisson(k; n/m); for a disk window, where the rim cells are
 * clipped, the mixture is the right curve and the flat one is not.
 */
export function quadratShape(counts: Int32Array, expectedPerCell: Float64Array): QuadratShape {
  let max = 0
  for (let i = 0; i < counts.length; i++) {
    if ((expectedPerCell[i] as number) > 0) max = Math.max(max, counts[i] as number)
  }
  const top = Math.max(max, 1)
  const categories: string[] = []
  const observed = new Array<number>(top + 1).fill(0)
  const expected = new Array<number>(top + 1).fill(0)
  for (let k = 0; k <= top; k++) categories.push(String(k))
  for (let i = 0; i < counts.length; i++) {
    const e = expectedPerCell[i] as number
    if (!(e > 0)) continue
    const c = counts[i] as number
    observed[c] = (observed[c] as number) + 1
    for (let k = 0; k <= top; k++) expected[k] = (expected[k] as number) + poissonPmf(k, e)
  }
  return { categories, observed, expected }
}

/**
 * Re-index a grid stored as `values[ix + iy·gx]` (y increasing upwards) into
 * the row-major, top-row-first matrix HeatmapCanvas paints.
 */
export function flipRows(values: ArrayLike<number>, gx: number, gy: number): Float64Array {
  const out = new Float64Array(gx * gy)
  for (let iy = 0; iy < gy; iy++) {
    const src = iy * gx
    const dst = (gy - 1 - iy) * gx
    for (let ix = 0; ix < gx; ix++) out[dst + ix] = values[src + ix] as number
  }
  return out
}

/** Row-major counts from a quadrat test (lower-left origin) for the heatmap. */
export function flipCounts(counts: ArrayLike<number>, nx: number, ny: number): Float64Array {
  return flipRows(counts, nx, ny)
}

/** A finite value, or undefined — so a NaN never reaches a chart domain. */
export function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
