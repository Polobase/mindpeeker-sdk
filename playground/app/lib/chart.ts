// Shared plumbing for the SVG charts: colour roles, nice ticks, scales,
// decimation and a width observer. SSR-safe (no SDK, no DOM at import time).

import { onScopeDispose, type Ref, ref, watch } from 'vue'

/**
 * Colour roles. A number or `series-N` picks the categorical palette (fixed
 * order, never cycled); the semantic names map to Nuxt UI's theme variables;
 * anything else is passed through as a raw CSS colour.
 */
export type VizColor = number | string

const SEMANTIC: Record<string, string> = {
  primary: 'var(--ui-primary)',
  secondary: 'var(--ui-secondary)',
  success: 'var(--ui-success)',
  info: 'var(--ui-info)',
  warning: 'var(--ui-warning)',
  error: 'var(--ui-error)',
  neutral: 'var(--viz-label)',
  muted: 'var(--viz-label)',
  grid: 'var(--viz-grid)',
  axis: 'var(--viz-axis)',
}

export const SERIES_SLOTS = 6

export function vizColor(color: VizColor | undefined, index = 0): string {
  if (typeof color === 'number') return `var(--viz-${((color - 1) % SERIES_SLOTS) + 1})`
  if (typeof color === 'string') {
    if (SEMANTIC[color]) return SEMANTIC[color] as string
    const match = /^series-([1-9])$/.exec(color)
    if (match) return `var(--viz-${((Number(match[1]) - 1) % SERIES_SLOTS) + 1})`
    return color
  }
  return `var(--viz-${(index % SERIES_SLOTS) + 1})`
}

/** Nice round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [min]
  const span = max - min
  const rawStep = span / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const norm = rawStep / magnitude
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * magnitude
  const first = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = first; v <= max + step * 1e-6; v += step) {
    // Kill the float noise a repeated += leaves behind.
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)))
  }
  return ticks
}

/** Decade ticks for a log axis over [min, max] (both > 0). */
export function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > 0)) return []
  const lo = Math.floor(Math.log10(min))
  const hi = Math.ceil(Math.log10(max))
  const ticks: number[] = []
  for (let e = lo; e <= hi; e++) {
    const v = 10 ** e
    if (v >= min * 0.999 && v <= max * 1.001) ticks.push(v)
  }
  return ticks
}

/** Short label for a single value (tooltips, `<title>` text): 1,000 / 0.25 / 1e-5. */
export function tickLabel(value: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6 || abs < 1e-3) return value.toExponential(0).replace('e+', 'e')
  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  const decimals = abs < 0.1 ? 3 : abs < 1 ? 2 : abs < 10 ? 2 : 1
  return Number(value.toFixed(decimals)).toString()
}

/** Decimals that render every value in `values` without rounding it away. */
function exactDecimals(values: readonly number[], start: number): number {
  let decimals = Math.min(10, Math.max(0, start))
  while (
    decimals < 10 &&
    values.some((v) => Math.abs(Number(v.toFixed(decimals)) - v) > Math.abs(v) * 1e-9)
  ) {
    decimals++
  }
  return decimals
}

/**
 * One formatter for a whole axis. Formatting each tick on its own rounds
 * 0.0015 and 0.002 to the same '0.002' and mixes '5e-4' with '0.001' on one
 * scale; deriving the decimals from the tick *step* and picking a single
 * notation for the axis keeps adjacent labels distinct and comparable.
 *
 * ```ts
 * const fmt = tickFormatter([0, 0.0005, 0.001, 0.0015])
 * fmt(0.0015) // '0.0015'
 * ```
 */
export function tickFormatter(ticks: readonly number[]): (value: number) => string {
  const finite = ticks.filter((t) => Number.isFinite(t))
  if (finite.length === 0) return tickLabel
  let maxAbs = 0
  for (const tick of finite) maxAbs = Math.max(maxAbs, Math.abs(tick))
  if (maxAbs === 0) return () => '0'
  let step = Number.POSITIVE_INFINITY
  for (let i = 1; i < finite.length; i++) {
    const gap = Math.abs((finite[i] as number) - (finite[i - 1] as number))
    if (gap > 0 && gap < step) step = gap
  }
  if (!Number.isFinite(step)) step = maxAbs

  // Far enough from 1 in either direction that fixed notation stops being
  // readable: one exponent form for every tick, including the ones near zero.
  if (maxAbs >= 1e6 || maxAbs < 1e-3) {
    const exponent = Math.floor(Math.log10(maxAbs))
    const mantissas = finite.map((t) => t / 10 ** exponent)
    const mantissaStep = step / 10 ** exponent
    const decimals = Math.min(
      6,
      exactDecimals(mantissas, Math.max(0, Math.ceil(-Math.log10(mantissaStep) - 1e-9))),
    )
    return (value) => (value === 0 ? '0' : value.toExponential(decimals).replace('e+', 'e'))
  }

  const decimals = exactDecimals(finite, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)))
  return (value) =>
    value === 0
      ? '0'
      : value.toLocaleString('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: decimals,
        })
}

export interface Scale {
  (value: number): number
  readonly domain: readonly [number, number]
  readonly range: readonly [number, number]
  invert(pixel: number): number
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): Scale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0 || 1
  const fn = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as {
    (value: number): number
    domain?: unknown
    range?: unknown
    invert?: unknown
  }
  fn.domain = domain
  fn.range = range
  fn.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span
  return fn as Scale
}

export function logScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): Scale {
  const d0 = Math.log10(Math.max(domain[0], Number.MIN_VALUE))
  const d1 = Math.log10(Math.max(domain[1], Number.MIN_VALUE))
  const linear = linearScale([d0, d1], range)
  const fn = ((value: number) =>
    linear(Math.log10(Math.max(value, Number.MIN_VALUE)))) as unknown as {
    (value: number): number
    domain?: unknown
    range?: unknown
    invert?: unknown
  }
  fn.domain = domain
  fn.range = range
  fn.invert = (pixel: number) => 10 ** linear.invert(pixel)
  return fn as Scale
}

/** Extent of several numeric arrays, ignoring non-finite values. */
export function extent(...arrays: (ArrayLike<number> | undefined)[]): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const array of arrays) {
    if (!array) continue
    for (let i = 0; i < array.length; i++) {
      const v = array[i] as number
      if (!Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return Number.isFinite(min) ? [min, max] : [0, 1]
}

/** Pad a domain by a fraction of its span (and never leave a zero-width one). */
export function padDomain(
  [min, max]: readonly [number, number],
  fraction = 0.06,
): [number, number] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1
    return [min - pad, max + pad]
  }
  const pad = (max - min) * fraction
  return [min - pad, max + pad]
}

/**
 * Min/max decimation: keeps the visual envelope of a long series while drawing
 * at most ~2 points per pixel column.
 */
export function decimate(
  points: readonly (readonly [number, number])[],
  maxPoints: number,
): (readonly [number, number])[] {
  if (points.length <= maxPoints || maxPoints < 4) return points as (readonly [number, number])[]
  const buckets = Math.floor(maxPoints / 2)
  const size = points.length / buckets
  const out: (readonly [number, number])[] = []
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size)
    const end = Math.min(points.length, Math.floor((b + 1) * size))
    if (end <= start) continue
    let lo = points[start] as readonly [number, number]
    let hi = lo
    for (let i = start; i < end; i++) {
      const point = points[i] as readonly [number, number]
      if (point[1] < lo[1]) lo = point
      if (point[1] > hi[1]) hi = point
    }
    if (lo[0] <= hi[0]) out.push(lo, hi)
    else out.push(hi, lo)
  }
  return out
}

/** An SVG path for a polyline, skipping non-finite values (gaps). */
export function linePath(
  points: readonly (readonly [number, number])[],
  x: Scale,
  y: Scale,
): string {
  let path = ''
  let pen = false
  for (const [px, py] of points) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      pen = false
      continue
    }
    path += `${pen ? 'L' : 'M'}${x(px).toFixed(2)} ${y(py).toFixed(2)}`
    pen = true
  }
  return path
}

/**
 * Track an element's width (ResizeObserver), so an SVG chart can be laid out in
 * real pixels instead of being stretched by a viewBox.
 */
export function useElementWidth(el: Ref<HTMLElement | undefined>, fallback = 640): Ref<number> {
  const width = ref(fallback)
  let observer: ResizeObserver | undefined
  // `watch(..., { flush: 'post' })` rather than `onMounted`, so this also works
  // when the chart sits inside a *.client.vue component, whose template refs are
  // still undefined in `onMounted` during hydration.
  const stop = watch(
    el,
    (node) => {
      observer?.disconnect()
      observer = undefined
      if (!node) return
      const measure = () => {
        const next = node.clientWidth
        if (next > 0) width.value = next
      }
      measure()
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure)
        observer.observe(node)
      }
    },
    { immediate: true, flush: 'post' },
  )
  onScopeDispose(() => {
    stop()
    observer?.disconnect()
    observer = undefined
  })
  return width
}

/** 256-step viridis lookup table (perceptually uniform, CVD-safe). */
export function viridisLut(): Uint8ClampedArray {
  const anchors: readonly (readonly [number, number, number])[] = [
    [68, 1, 84],
    [72, 36, 117],
    [65, 68, 135],
    [53, 95, 141],
    [42, 120, 142],
    [33, 145, 140],
    [34, 168, 132],
    [68, 191, 112],
    [122, 209, 81],
    [189, 223, 38],
    [253, 231, 37],
  ]
  const lut = new Uint8ClampedArray(256 * 3)
  const last = anchors.length - 1
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * last
    const idx = Math.min(last - 1, Math.floor(t))
    const frac = t - idx
    const a = anchors[idx] as readonly [number, number, number]
    const b = anchors[idx + 1] as readonly [number, number, number]
    lut[i * 3] = a[0] + (b[0] - a[0]) * frac
    lut[i * 3 + 1] = a[1] + (b[1] - a[1]) * frac
    lut[i * 3 + 2] = a[2] + (b[2] - a[2]) * frac
  }
  return lut
}

/** `rgb(...)` for a value in [0, 1] on the viridis ramp. */
export function viridisCss(t: number, lut = VIRIDIS): string {
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3
  return `rgb(${lut[i]}, ${lut[i + 1]}, ${lut[i + 2]})`
}

export const VIRIDIS = viridisLut()

// ── chart data shapes (shared by LineChart / BarChart / Histogram) ───────────

export interface LineSeries {
  name: string
  /** y values; x comes from the chart's `x`, the series' own `x`, or the index. */
  y?: ArrayLike<number>
  x?: ArrayLike<number>
  /** [x, y] pairs, as an alternative to y/x. */
  points?: readonly (readonly [number, number])[]
  color?: VizColor
  dashed?: boolean
  /** Stroke width in px (default 2). */
  width?: number
}

export interface ChartBand {
  lo: ArrayLike<number>
  hi: ArrayLike<number>
  x?: ArrayLike<number>
  label?: string
  color?: VizColor
}

/** A constant-value reference line (horizontal in LineChart's `hlines`). */
export interface RefLine {
  value: number
  label?: string
  color?: VizColor
  /** Dashed unless explicitly false. */
  dashed?: boolean
}

/** A labelled vertical marker on a Histogram. */
export interface ChartMarker {
  value: number
  label?: string
  color?: VizColor
  dashed?: boolean
}
