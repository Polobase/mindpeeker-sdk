/**
 * Pure client-side math: scales, tick placement, autoscaling, the heatmap
 * color LUT, series/band vertex generation, and dial tessellation. No DOM,
 * no WebGL — everything here is deterministic and unit-tested headlessly
 * (the GL panels are thin shells around these functions, because GL itself
 * cannot run in CI).
 */
import type { RateCardGeometry } from '../src/types.js'

/**
 * Affine map $x \mapsto r_0 + (x - d_0)\frac{r_1 - r_0}{d_1 - d_0}$. A
 * degenerate domain ($d_0 = d_1$) maps everything to the range midpoint
 * instead of dividing by zero.
 */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (x: number) => number {
  if (d0 === d1) {
    const mid = (r0 + r1) / 2
    return () => mid
  }
  const k = (r1 - r0) / (d1 - d0)
  return (x: number) => r0 + (x - d0) * k
}

/**
 * "Nice numbers" axis ticks (Heckbert, *Graphics Gems* 1990): step is
 * $\{1, 2, 5\} \times 10^k$ chosen so roughly `count` ticks span the range.
 * Returns ascending tick positions covering `[min, max]`.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 1) return []
  if (min === max) return [min]
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  const rawStep = (hi - lo) / count
  const mag = 10 ** Math.floor(Math.log10(rawStep))
  const norm = rawStep / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const first = Math.ceil(lo / step) * step
  const ticks: number[] = []
  // index-based (not accumulated) and re-rounded, so 3 × 0.2 prints as 0.6;
  // the epsilon only absorbs float drift, never extends past the range
  for (let i = 0; first + i * step <= hi + step * 1e-9; i++) {
    const v = Number((first + i * step).toPrecision(12))
    ticks.push(Math.abs(v) < step / 2 ? 0 : v)
  }
  return ticks
}

/**
 * Autoscaling range for a set of values: `[min, max]` padded by `pad` of the
 * span on each side. Non-finite values are ignored; an empty or constant
 * input still yields a usable non-degenerate range.
 */
export function autoRange(values: Iterable<number>, pad = 0.08): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (min > max) return [0, 1]
  if (min === max) {
    const bump = Math.max(1, Math.abs(min) * 0.1)
    return [min - bump, max + bump]
  }
  const span = max - min
  return [min - pad * span, max + pad * span]
}

/**
 * 10-stop subsample of the viridis colormap (Smith & van der Walt, matplotlib
 * — perceptually uniform, colorblind-safe), interpolated linearly in sRGB.
 * Frozen data table per SDK style.
 */
export const VIRIDIS_STOPS: readonly (readonly [number, number, number])[] = Object.freeze([
  Object.freeze([0x44, 0x01, 0x54] as const),
  Object.freeze([0x48, 0x28, 0x78] as const),
  Object.freeze([0x3e, 0x49, 0x89] as const),
  Object.freeze([0x31, 0x68, 0x8e] as const),
  Object.freeze([0x26, 0x82, 0x8e] as const),
  Object.freeze([0x1f, 0x9e, 0x89] as const),
  Object.freeze([0x35, 0xb7, 0x79] as const),
  Object.freeze([0x6e, 0xce, 0x58] as const),
  Object.freeze([0xb5, 0xde, 0x2b] as const),
  Object.freeze([0xfd, 0xe7, 0x25] as const),
])

/**
 * Build an RGBA8 lookup table of `n` entries interpolating
 * {@link VIRIDIS_STOPS} — uploaded once as an $n \times 1$ texture, so the
 * heatmap fragment shader maps value → color with a single texture fetch.
 */
export function viridisLut(n = 256): Uint8Array {
  if (!Number.isInteger(n) || n < 2) throw new RangeError(`lut size must be ≥ 2, got ${n}`)
  const out = new Uint8Array(n * 4)
  const segments = VIRIDIS_STOPS.length - 1
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * segments
    const seg = Math.min(Math.floor(pos), segments - 1)
    const frac = pos - seg
    const a = VIRIDIS_STOPS[seg] as readonly [number, number, number]
    const b = VIRIDIS_STOPS[seg + 1] as readonly [number, number, number]
    for (let c = 0; c < 3; c++) {
      out[i * 4 + c] = Math.round((a[c] as number) + ((b[c] as number) - (a[c] as number)) * frac)
    }
    out[i * 4 + 3] = 255
  }
  return out
}

/**
 * Build a `LINE_STRIP` vertex array (x, y pairs) from series points through
 * the given pixel/clip scales. Points with a non-finite value are dropped —
 * a NaN would poison the whole strip.
 */
export function seriesPath(
  points: readonly { t: number; value: number }[],
  xScale: (x: number) => number,
  yScale: (y: number) => number,
): Float32Array {
  const verts: number[] = []
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue
    verts.push(xScale(p.t), yScale(p.value))
  }
  return new Float32Array(verts)
}

/**
 * Build a `TRIANGLE_STRIP` vertex array for the envelope band: for each
 * banded point, the pair (x, lo), (x, hi). Points without a band (or with
 * non-finite bounds) are skipped, so the strip covers exactly the banded run.
 */
export function bandStrip(
  points: readonly { t: number; band?: readonly [number, number] }[],
  xScale: (x: number) => number,
  yScale: (y: number) => number,
): Float32Array {
  const verts: number[] = []
  for (const p of points) {
    if (!p.band || !Number.isFinite(p.band[0]) || !Number.isFinite(p.band[1])) continue
    const x = xScale(p.t)
    verts.push(x, yScale(p.band[0]), x, yScale(p.band[1]))
  }
  return new Float32Array(verts)
}

/** Vertex arrays for the dial panel, in the unit circle (clip-ready). */
export interface DialTessellation {
  /** LINE list: rings (polylines as segment pairs) then radial sector lines. */
  readonly grid: Float32Array
  /** LINE list: the pointer line, empty when the card has no pointer. */
  readonly pointer: Float32Array
}

/**
 * Tessellate {@link RateCardGeometry} into GL line-list vertices. Rings are
 * `segments`-gon approximations of circles; radial lines run from the
 * innermost ring to the outermost at each sector boundary — from the centre
 * when there are fewer than two distinct ring radii (no rings: centre to
 * radius 1; one ring: centre to that ring), so sector divisions never
 * degenerate to points. Angles follow the rate-card convention: sector 0 at
 * 12 o'clock, increasing clockwise, i.e.
 * $\theta_k = \pi/2 - 2\pi k / \mathrm{sectors}$.
 *
 * @throws {RangeError} for a non-positive or non-integer `sectors`, `segments`
 *   below 3, a ring radius outside $(0, 1]$, or a `pointerSector` that is not
 *   an integer in $[0, \mathrm{sectors})$.
 */
export function tessellateDial(geometry: RateCardGeometry, segments = 128): DialTessellation {
  const { sectors, rings, pointerSector } = geometry
  if (!Number.isInteger(sectors) || sectors < 1) {
    throw new RangeError(`sectors must be a positive integer, got ${sectors}`)
  }
  if (!Number.isInteger(segments) || segments < 3) {
    throw new RangeError(`segments must be an integer ≥ 3, got ${segments}`)
  }
  if (!Array.isArray(rings)) throw new RangeError('rings must be an array of radii')
  let inner = Number.POSITIVE_INFINITY
  let outer = Number.NEGATIVE_INFINITY
  for (const r of rings) {
    if (!(r > 0 && r <= 1)) throw new RangeError(`ring radius must be in (0, 1], got ${r}`)
    inner = Math.min(inner, r)
    outer = Math.max(outer, r)
  }
  if (
    pointerSector !== undefined &&
    !(Number.isInteger(pointerSector) && pointerSector >= 0 && pointerSector < sectors)
  ) {
    throw new RangeError(
      `pointerSector must be an integer in [0, ${sectors}), got ${String(pointerSector)}`,
    )
  }
  if (rings.length === 0) outer = 1
  // fewer than two distinct radii: spokes start at the centre
  if (!(inner < outer)) inner = 0
  // each ring: `segments` line segments × 2 verts; each sector line: 2 verts
  const grid = new Float32Array((rings.length * segments * 2 + sectors * 2) * 2)
  let o = 0
  for (const r of rings) {
    for (let s = 0; s < segments; s++) {
      const a0 = (2 * Math.PI * s) / segments
      const a1 = (2 * Math.PI * (s + 1)) / segments
      grid[o++] = r * Math.cos(a0)
      grid[o++] = r * Math.sin(a0)
      grid[o++] = r * Math.cos(a1)
      grid[o++] = r * Math.sin(a1)
    }
  }
  for (let k = 0; k < sectors; k++) {
    const theta = Math.PI / 2 - (2 * Math.PI * k) / sectors
    grid[o++] = inner * Math.cos(theta)
    grid[o++] = inner * Math.sin(theta)
    grid[o++] = outer * Math.cos(theta)
    grid[o++] = outer * Math.sin(theta)
  }
  let pointer = new Float32Array(0)
  if (pointerSector !== undefined) {
    const theta = Math.PI / 2 - (2 * Math.PI * pointerSector) / sectors
    pointer = new Float32Array([0, 0, outer * Math.cos(theta), outer * Math.sin(theta)])
  }
  return { grid, pointer }
}

/**
 * How a matrix frame maps onto the colormap / bar heights: `lo ↦ 0`, `hi ↦ 1`
 * (values outside are clamped), and `baseline` is where the value 0 lands —
 * the edge bars grow from.
 */
export interface MatrixScale {
  readonly lo: number
  readonly hi: number
  /** Normalized position of the value 0, clamped to $[0, 1]$. */
  readonly baseline: number
  /** Bar mode (one row) rather than a heatmap. */
  readonly bars: boolean
  /** `true` when `lo`/`hi` came from the producer's `range`. */
  readonly fixed: boolean
}

/**
 * Choose the normalization for one matrix frame:
 *
 * - a valid producer `range` (finite, `lo < hi`) is used as-is;
 * - bars (`rows === 1`) span $[\min(0, \min v), \max(0, \max v)]$, so bar
 *   height stays proportional to magnitude from a zero baseline (a flat
 *   histogram renders as equal bars, not as 0–100 % noise);
 * - heatmaps span $[\min v, \max v]$.
 *
 * Non-finite values are ignored; a degenerate span becomes `[lo, lo + 1]`.
 */
export function matrixScale(
  data: ArrayLike<number>,
  rows: number,
  range?: readonly [number, number],
): MatrixScale {
  const bars = rows === 1
  let lo: number
  let hi: number
  let fixed = false
  if (
    range !== undefined &&
    Number.isFinite(range[0]) &&
    Number.isFinite(range[1]) &&
    range[0] < range[1]
  ) {
    fixed = true
    lo = range[0]
    hi = range[1]
  } else {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let i = 0; i < data.length; i++) {
      const v = data[i] as number
      if (!Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
    if (min > max) {
      min = 0
      max = 0
    }
    lo = bars ? Math.min(0, min) : min
    hi = bars ? Math.max(0, max) : max
    if (!(hi > lo)) hi = lo + 1
  }
  const baseline = Math.min(1, Math.max(0, (0 - lo) / (hi - lo)))
  return { lo, hi, baseline, bars, fixed }
}

/**
 * Map values through a {@link MatrixScale} into $[0, 1]$ (clamped). Non-finite
 * values land on the baseline for bars (no bar) and on 0 for heatmaps.
 */
export function normalizeMatrix(data: ArrayLike<number>, scale: MatrixScale): Float32Array {
  const out = new Float32Array(data.length)
  const span = scale.hi - scale.lo
  for (let i = 0; i < data.length; i++) {
    const v = data[i] as number
    if (!Number.isFinite(v)) {
      out[i] = scale.bars ? scale.baseline : 0
      continue
    }
    out[i] = Math.min(1, Math.max(0, (v - scale.lo) / span))
  }
  return out
}

/**
 * Panel-grid column count: near-square layout, capped at 4 columns so panels
 * stay legible — $\min\bigl(4, \lceil\sqrt{n}\,\rceil\bigr)$.
 */
export function gridColumns(panelCount: number): number {
  if (panelCount <= 1) return 1
  return Math.min(4, Math.ceil(Math.sqrt(panelCount)))
}

/** Narrowest panel, in CSS pixels, before the grid drops a column. */
export const MIN_PANEL_WIDTH = 320

/**
 * Columns that actually fit: the {@link gridColumns} choice, reduced so every
 * column is at least `minPanelWidth` wide (one column on a phone). A width of
 * 0 (not laid out yet) keeps the preferred count.
 */
export function fitColumns(
  panelCount: number,
  containerWidth: number,
  minPanelWidth = MIN_PANEL_WIDTH,
): number {
  const preferred = gridColumns(panelCount)
  if (!(containerWidth > 0)) return preferred
  return Math.max(1, Math.min(preferred, Math.floor(containerWidth / minPanelWidth)))
}
