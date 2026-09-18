<script setup lang="ts">
import {
  decimate,
  extent,
  linePath,
  linearScale,
  logScale,
  logTicks,
  niceTicks,
  padDomain,
  tickFormatter,
  tickLabel,
  useElementWidth,
  type ChartBand,
  type LineSeries,
  type RefLine,
  vizColor,
} from '~/lib/chart'

/**
 * Responsive SVG line chart with shaded bands, reference lines, an optional
 * log y-axis and a crosshair tooltip. Theme-aware (every colour is a CSS
 * variable), keyboard-navigable, SSR-safe.
 *
 * ```vue
 * <LineChart
 *   :series="[{ name: 'cumulative Z²−1', y: walk }, { name: 'control', y: ctrl, color: 2, dashed: true }]"
 *   :bands="[{ lo: -env, hi: env, label: 'pointwise χ² envelope' }]"
 *   :hlines="[{ value: 0 }]"
 *   x-label="trial" y-label="cumulative deviation" :height="280" />
 * ```
 */
const props = withDefaults(
  defineProps<{
    series: readonly LineSeries[]
    /** Shared x values for series that don't carry their own. */
    x?: ArrayLike<number>
    bands?: readonly ChartBand[]
    /** Horizontal reference lines (constant y). */
    hlines?: readonly RefLine[]
    /** Vertical reference lines (constant x). */
    vlines?: readonly RefLine[]
    xLabel?: string
    yLabel?: string
    logY?: boolean
    yDomain?: readonly [number, number]
    xDomain?: readonly [number, number]
    height?: number
    /** Accessible summary; falls back to the series names. */
    ariaLabel?: string
    /** Show the legend (default: whenever there are 2+ series or a band). */
    legend?: boolean
    /** Formats values in the tooltip. */
    format?: (value: number) => string
  }>(),
  {
    x: undefined,
    bands: () => [],
    hlines: () => [],
    vlines: () => [],
    xLabel: undefined,
    yLabel: undefined,
    logY: false,
    yDomain: undefined,
    xDomain: undefined,
    height: 260,
    ariaLabel: undefined,
    legend: undefined,
    format: undefined,
  },
)

const root = ref<HTMLElement>()
const width = useElementWidth(root, 640)

/**
 * Room to the right of the plot for the `hlines` labels. Drawn inside the plot
 * they sit on whatever the series is doing at the right edge — the QA round
 * caught the ACF curve running straight through '+1.96/√n' — so when the
 * longest label fits in a sane gutter, every label moves out of the plot.
 *
 * A label too long for that gutter stays inside rather than being clipped by
 * the SVG edge; the halo below keeps it readable either way.
 */
const HLINE_CHAR_PX = 5.4

const gutter = computed(() => {
  let longest = 0
  for (const line of props.hlines) if (line.label) longest = Math.max(longest, line.label.length)
  if (longest === 0) return 0
  const needed = Math.round(longest * HLINE_CHAR_PX) + 8
  return needed <= Math.min(150, Math.round(width.value * 0.32)) ? needed : 0
})

/** True when the `hlines` labels sit in the gutter instead of over the plot. */
const hlineOutside = computed(() => gutter.value > 0)

const margin = computed(() => ({
  top: 10,
  right: 14 + gutter.value,
  bottom: props.xLabel ? 44 : 28,
  left: props.yLabel ? 62 : 48,
}))

const plotW = computed(() => Math.max(40, width.value - margin.value.left - margin.value.right))
const plotH = computed(() => Math.max(40, props.height - margin.value.top - margin.value.bottom))

function seriesPoints(s: LineSeries, shared?: ArrayLike<number>): (readonly [number, number])[] {
  if (s.points) return s.points as (readonly [number, number])[]
  const y = s.y
  if (!y) return []
  const x = s.x ?? shared
  const out: (readonly [number, number])[] = []
  for (let i = 0; i < y.length; i++) out.push([x ? (x[i] as number) : i, y[i] as number])
  return out
}

const resolved = computed(() =>
  props.series.map((s, index) => ({
    ...s,
    index,
    color: vizColor(s.color, index),
    data: seriesPoints(s, props.x),
  })),
)

const bandPoints = computed(() =>
  props.bands.map((band, index) => {
    const x = band.x ?? props.x
    const n = Math.min(band.lo.length, band.hi.length)
    const lo: (readonly [number, number])[] = []
    const hi: (readonly [number, number])[] = []
    for (let i = 0; i < n; i++) {
      const xv = x ? (x[i] as number) : i
      lo.push([xv, band.lo[i] as number])
      hi.push([xv, band.hi[i] as number])
    }
    return { ...band, index, color: vizColor(band.color ?? 'muted', index), lo, hi }
  }),
)

const xExtent = computed<[number, number]>(() => {
  if (props.xDomain) return [props.xDomain[0], props.xDomain[1]]
  const xs: number[] = []
  for (const s of resolved.value) for (const point of s.data) xs.push(point[0])
  for (const band of bandPoints.value) for (const point of band.lo) xs.push(point[0])
  for (const line of props.vlines) xs.push(line.value)
  return xs.length ? extent(xs) : [0, 1]
})

const yExtent = computed<[number, number]>(() => {
  if (props.yDomain) return [props.yDomain[0], props.yDomain[1]]
  const ys: number[] = []
  for (const s of resolved.value) for (const point of s.data) ys.push(point[1])
  for (const band of bandPoints.value) {
    for (const point of band.lo) ys.push(point[1])
    for (const point of band.hi) ys.push(point[1])
  }
  for (const line of props.hlines) ys.push(line.value)
  const raw = ys.length ? extent(ys) : ([0, 1] as [number, number])
  if (props.logY) {
    const positive = ys.filter((v) => v > 0)
    const lo = positive.length ? Math.min(...positive) : 1e-6
    return [lo, Math.max(raw[1], lo * 10)]
  }
  return padDomain(raw)
})

const xScale = computed(() => linearScale(xExtent.value, [0, plotW.value]))
const yScale = computed(() =>
  props.logY
    ? logScale(yExtent.value, [plotH.value, 0])
    : linearScale(yExtent.value, [plotH.value, 0]),
)

const yTicks = computed(() =>
  props.logY
    ? logTicks(yExtent.value[0], yExtent.value[1])
    : niceTicks(yExtent.value[0], yExtent.value[1], plotH.value < 160 ? 4 : 6),
)
const xTicks = computed(() =>
  niceTicks(xExtent.value[0], xExtent.value[1], plotW.value < 380 ? 4 : 7),
)

// One formatter per axis, so neighbouring ticks never round to the same string.
// A log axis is exempt: its ticks are decades, not a constant step, and each one
// is already labelled compactly on its own.
const yTickFmt = computed(() => (props.logY ? tickLabel : tickFormatter(yTicks.value)))
const xTickFmt = computed(() => tickFormatter(xTicks.value))

/** A reference line's label, kept inside the vertical bounds of the plot. */
function hlineLabelY(value: number): number {
  return Math.max(9, Math.min(plotH.value, yScale.value(value) + 3))
}

const paths = computed(() =>
  resolved.value.map((s) => ({
    ...s,
    d: linePath(decimate(s.data, Math.max(40, plotW.value * 2)), xScale.value, yScale.value),
  })),
)

const bandPaths = computed(() =>
  bandPoints.value.map((band) => {
    const up = linePath(decimate(band.hi, Math.max(40, plotW.value * 2)), xScale.value, yScale.value)
    const down = decimate(band.lo, Math.max(40, plotW.value * 2))
      .slice()
      .reverse()
    const back = linePath(down, xScale.value, yScale.value).replace(/^M/, 'L')
    return { ...band, d: up && back ? `${up}${back}Z` : '' }
  }),
)

const showLegend = computed(() =>
  props.legend === undefined
    ? props.series.length > 1 || props.bands.length > 0
    : props.legend,
)

const fmt = (value: number) => (props.format ? props.format(value) : tickLabel(value))

// ── crosshair ────────────────────────────────────────────────────────────────
const cursor = ref<number | null>(null) // x in data units

function nearestValue(data: readonly (readonly [number, number])[], xv: number): number | undefined {
  if (!data.length) return undefined
  let best = data[0] as readonly [number, number]
  let bestDist = Math.abs(best[0] - xv)
  for (const point of data) {
    const dist = Math.abs(point[0] - xv)
    if (dist < bestDist) {
      best = point
      bestDist = dist
    }
  }
  return Number.isFinite(best[1]) ? best[1] : undefined
}

const hover = computed(() => {
  if (cursor.value === null) return undefined
  const xv = cursor.value
  const rows = resolved.value.map((s) => ({
    name: s.name,
    color: s.color,
    value: nearestValue(s.data, xv),
  }))
  return { x: xv, px: xScale.value(xv), rows }
})

function onPointer(event: PointerEvent): void {
  const rect = (event.currentTarget as SVGRectElement).getBoundingClientRect()
  const px = event.clientX - rect.left
  cursor.value = xScale.value.invert(px)
}

function onKey(event: KeyboardEvent): void {
  const [lo, hi] = xExtent.value
  const step = (hi - lo) / 40 || 1
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault()
    const base = cursor.value ?? (lo + hi) / 2
    cursor.value = Math.min(hi, Math.max(lo, base + (event.key === 'ArrowRight' ? step : -step)))
  } else if (event.key === 'Escape') {
    cursor.value = null
  }
}

const label = computed(
  () =>
    props.ariaLabel ??
    `Line chart of ${props.series.map((s) => s.name).join(', ')}${props.xLabel ? ` over ${props.xLabel}` : ''}`,
)
</script>

<template>
  <figure ref="root" class="relative w-full viz-fit">
    <svg
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      :aria-label="label"
      tabindex="0"
      class="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
      @keydown="onKey"
    >
      <g :transform="`translate(${margin.left},${margin.top})`">
        <!-- gridlines -->
        <g stroke="var(--viz-grid)" stroke-width="1">
          <line
            v-for="tick in yTicks"
            :key="`gy-${tick}`"
            x1="0"
            :x2="plotW"
            :y1="yScale(tick)"
            :y2="yScale(tick)"
          />
        </g>

        <!-- bands -->
        <path
          v-for="band in bandPaths"
          :key="`band-${band.index}`"
          :d="band.d"
          :fill="band.color"
          fill-opacity="0.12"
          stroke="none"
        />

        <!-- reference lines -->
        <g v-for="(line, i) in hlines" :key="`h-${i}`">
          <line
            x1="0"
            :x2="plotW"
            :y1="yScale(line.value)"
            :y2="yScale(line.value)"
            :stroke="vizColor(line.color ?? 'axis')"
            stroke-width="1"
            :stroke-dasharray="line.dashed === false ? undefined : '4 3'"
          />
          <text
            v-if="line.label"
            :x="hlineOutside ? plotW + 6 : plotW - 4"
            :y="hlineOutside ? hlineLabelY(line.value) : yScale(line.value) - 4"
            :text-anchor="hlineOutside ? 'start' : 'end'"
            fill="var(--viz-label)" font-size="10"
            stroke="var(--viz-surface)" stroke-width="3" stroke-linejoin="round"
            paint-order="stroke"
          >{{ line.label }}</text>
        </g>
        <g v-for="(line, i) in vlines" :key="`v-${i}`">
          <line
            :x1="xScale(line.value)"
            :x2="xScale(line.value)"
            y1="0"
            :y2="plotH"
            :stroke="vizColor(line.color ?? 'axis')"
            stroke-width="1"
            :stroke-dasharray="line.dashed === false ? undefined : '4 3'"
          />
          <text
            v-if="line.label"
            :x="xScale(line.value) + 4"
            y="10"
            fill="var(--viz-label)" font-size="10"
            stroke="var(--viz-surface)" stroke-width="3" stroke-linejoin="round"
            paint-order="stroke"
          >{{ line.label }}</text>
        </g>

        <!-- series -->
        <path
          v-for="line in paths"
          :key="`s-${line.index}`"
          :d="line.d"
          fill="none"
          :stroke="line.color"
          :stroke-width="line.width ?? 2"
          stroke-linejoin="round"
          stroke-linecap="round"
          :stroke-dasharray="line.dashed ? '6 4' : undefined"
        />

        <!-- crosshair -->
        <g v-if="hover" pointer-events="none">
          <line
            :x1="hover.px"
            :x2="hover.px"
            y1="0"
            :y2="plotH"
            stroke="var(--viz-axis)"
            stroke-width="1"
          />
          <template v-for="(row, i) in hover.rows" :key="`c-${i}`">
            <circle
              v-if="row.value !== undefined"
              :cx="hover.px"
              :cy="yScale(row.value)"
              r="4"
              :fill="row.color"
              stroke="var(--viz-surface)"
              stroke-width="2"
            />
          </template>
        </g>

        <!-- axes -->
        <line x1="0" :x2="plotW" :y1="plotH" :y2="plotH" stroke="var(--viz-grid)" stroke-width="1" />
        <g fill="var(--viz-label)" font-size="10">
          <text
            v-for="tick in yTicks"
            :key="`ty-${tick}`"
            x="-8"
            :y="yScale(tick) + 3"
            text-anchor="end"
          >{{ yTickFmt(tick) }}</text>
          <text
            v-for="tick in xTicks"
            :key="`tx-${tick}`"
            :x="xScale(tick)"
            :y="plotH + 16"
            text-anchor="middle"
          >{{ xTickFmt(tick) }}</text>
        </g>
        <text
          v-if="xLabel"
          :x="plotW / 2"
          :y="plotH + 34"
          text-anchor="middle"
          fill="var(--viz-label)" font-size="11"
        >{{ xLabel }}</text>
        <text
          v-if="yLabel"
          :transform="`translate(${-margin.left + 12},${plotH / 2}) rotate(-90)`"
          text-anchor="middle"
          fill="var(--viz-label)" font-size="11"
        >{{ yLabel }}</text>

        <!-- hover surface -->
        <rect
          x="0"
          y="0"
          :width="plotW"
          :height="plotH"
          fill="transparent"
          @pointermove="onPointer"
          @pointerdown="onPointer"
          @pointerleave="cursor = null"
        />
      </g>
    </svg>

    <div
      v-if="hover"
      class="pointer-events-none absolute z-10 rounded-md border border-default bg-default/95 px-2 py-1.5 text-xs shadow-lg"
      :style="{
        left: `${Math.min(width - 160, margin.left + hover.px + 10)}px`,
        top: `${margin.top + 6}px`,
      }"
    >
      <div class="text-dimmed tabular-nums">{{ xLabel || 'x' }} ≈ {{ tickLabel(hover.x) }}</div>
      <div v-for="(row, i) in hover.rows" :key="`t-${i}`" class="flex items-center gap-1.5">
        <span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: row.color }" />
        <span class="text-muted">{{ row.name }}</span>
        <span class="ms-auto ps-2 font-mono tabular-nums text-highlighted">
          {{ row.value === undefined ? '—' : fmt(row.value) }}
        </span>
      </div>
    </div>

    <figcaption v-if="showLegend" class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <span v-for="line in paths" :key="`l-${line.index}`" class="inline-flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line
            x1="0"
            y1="4"
            x2="16"
            y2="4"
            :stroke="line.color"
            stroke-width="2"
            :stroke-dasharray="line.dashed ? '4 3' : undefined"
          />
        </svg>
        {{ line.name }}
      </span>
      <span
        v-for="band in bandPaths"
        :key="`lb-${band.index}`"
        class="inline-flex items-center gap-1.5"
      >
        <span
          class="h-2 w-4 rounded-sm shrink-0"
          :style="{ backgroundColor: band.color, opacity: 0.25 }"
        />
        {{ band.label ?? 'band' }}
      </span>
    </figcaption>
  </figure>
</template>
