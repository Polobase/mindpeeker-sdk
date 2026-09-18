<script setup lang="ts">
import {
  type ChartMarker,
  extent,
  linePath,
  linearScale,
  niceTicks,
  tickFormatter,
  tickLabel,
  useElementWidth,
  type VizColor,
  vizColor,
} from '~/lib/chart'

/**
 * Responsive SVG histogram with an optional reference density curve and
 * labelled vertical markers (an observed statistic against its null, say).
 * Theme-aware, hover tooltips per bin, SSR-safe.
 *
 * ```vue
 * <Histogram :values="surrogateTEs" :bins="40" density
 *   :reference="(x) => chiSquareDensity(x, df)" reference-label="χ² null"
 *   :markers="[{ value: observed, label: 'observed TE', color: 2 }]"
 *   x-label="transfer entropy (bits)" />
 * ```
 */
const props = withDefaults(
  defineProps<{
    values: ArrayLike<number>
    /** Number of equal-width bins (default 30). */
    bins?: number
    /** Explicit [min, max]; default: the data extent. */
    domain?: readonly [number, number]
    /** Plot density (area 1) instead of counts — required for a reference curve. */
    density?: boolean
    /** Reference probability density, drawn as a 2px curve. */
    reference?: (x: number) => number
    referenceLabel?: string
    markers?: readonly ChartMarker[]
    color?: VizColor
    xLabel?: string
    yLabel?: string
    height?: number
    ariaLabel?: string
  }>(),
  {
    bins: 30,
    domain: undefined,
    density: false,
    reference: undefined,
    referenceLabel: 'reference density',
    markers: () => [],
    color: undefined,
    xLabel: undefined,
    yLabel: undefined,
    height: 240,
    ariaLabel: undefined,
  },
)

const root = ref<HTMLElement>()
const width = useElementWidth(root, 640)

const margin = computed(() => ({
  top: 14,
  right: 14,
  bottom: props.xLabel ? 46 : 30,
  left: props.yLabel ? 62 : 48,
}))
const plotW = computed(() => Math.max(40, width.value - margin.value.left - margin.value.right))
const plotH = computed(() => Math.max(40, props.height - margin.value.top - margin.value.bottom))

const asDensity = computed(() => props.density || props.reference !== undefined)

const histogram = computed(() => {
  const count = Math.max(1, Math.floor(props.bins))
  const [dataMin, dataMax] = props.domain ? [props.domain[0], props.domain[1]] : extent(props.values)
  const min = dataMin
  const max = dataMax > dataMin ? dataMax : dataMin + 1
  const step = (max - min) / count
  const counts = new Float64Array(count)
  let total = 0
  for (let i = 0; i < props.values.length; i++) {
    const v = props.values[i] as number
    if (!Number.isFinite(v) || v < min || v > max) continue
    const index = Math.min(count - 1, Math.floor((v - min) / step))
    counts[index] = (counts[index] as number) + 1
    total++
  }
  const heights = Array.from(counts, (c) =>
    asDensity.value ? (total > 0 ? c / (total * step) : 0) : c,
  )
  return { min, max, step, count, counts: Array.from(counts), heights, total }
})

const curve = computed<(readonly [number, number])[]>(() => {
  const fn = props.reference
  if (!fn) return []
  const { min, max } = histogram.value
  const samples = Math.max(60, Math.min(400, Math.round(plotW.value / 2)))
  const out: (readonly [number, number])[] = []
  for (let i = 0; i <= samples; i++) {
    const x = min + ((max - min) * i) / samples
    const y = fn(x)
    out.push([x, Number.isFinite(y) ? y : Number.NaN])
  }
  return out
})

const xDomain = computed<[number, number]>(() => {
  const { min, max } = histogram.value
  const marks = props.markers.map((m) => m.value)
  const lo = marks.length ? Math.min(min, ...marks) : min
  const hi = marks.length ? Math.max(max, ...marks) : max
  return [lo, hi]
})

const yDomain = computed<[number, number]>(() => {
  const values = [...histogram.value.heights, ...curve.value.map((p) => p[1])].filter((v) =>
    Number.isFinite(v),
  )
  const max = values.length ? Math.max(...values) : 1
  return [0, max * 1.1 || 1]
})

const xScale = computed(() => linearScale(xDomain.value, [0, plotW.value]))
const yScale = computed(() => linearScale(yDomain.value, [plotH.value, 0]))
const xTicks = computed(() => niceTicks(xDomain.value[0], xDomain.value[1], plotW.value < 380 ? 4 : 6))
const yTicks = computed(() => niceTicks(yDomain.value[0], yDomain.value[1], 4))

// One formatter per axis, so 0.0015 and 0.002 cannot both print as '0.002'.
const xTickFmt = computed(() => tickFormatter(xTicks.value))
const yTickFmt = computed(() => tickFormatter(yTicks.value))

const bars = computed(() => {
  const { min, step, count, heights, counts } = histogram.value
  const out: { i: number; x: number; y: number; w: number; h: number; lo: number; hi: number; value: number; count: number }[] = []
  const zero = yScale.value(0)
  for (let i = 0; i < count; i++) {
    const lo = min + i * step
    const hi = lo + step
    const x0 = xScale.value(lo)
    const x1 = xScale.value(hi)
    const value = heights[i] as number
    const y = yScale.value(value)
    out.push({
      i,
      x: x0 + 1,
      y,
      w: Math.max(1, x1 - x0 - 2), // 2px surface gap between neighbours
      h: Math.max(0, zero - y),
      lo,
      hi,
      value,
      count: counts[i] as number,
    })
  }
  return out
})

const curvePath = computed(() => (curve.value.length ? linePath(curve.value, xScale.value, yScale.value) : ''))
const hovered = ref<number | null>(null)
const label = computed(
  () =>
    props.ariaLabel ??
    `Histogram of ${histogram.value.total} values in ${histogram.value.count} bins${props.xLabel ? ` of ${props.xLabel}` : ''}`,
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
      class="block w-full"
    >
      <g :transform="`translate(${margin.left},${margin.top})`">
        <g stroke="var(--viz-grid)" stroke-width="1">
          <line
            v-for="tick in yTicks"
            :key="`g-${tick}`"
            x1="0"
            :x2="plotW"
            :y1="yScale(tick)"
            :y2="yScale(tick)"
          />
        </g>

        <rect
          v-for="bar in bars"
          :key="`b-${bar.i}`"
          :x="bar.x"
          :y="bar.y"
          :width="bar.w"
          :height="bar.h"
          :fill="vizColor(color, 0)"
          :fill-opacity="hovered === null || hovered === bar.i ? 0.9 : 0.5"
          rx="2"
          @pointerenter="hovered = bar.i"
          @pointerleave="hovered = null"
        >
          <title>[{{ tickLabel(bar.lo) }}, {{ tickLabel(bar.hi) }}): {{ bar.count }}</title>
        </rect>

        <path
          v-if="curvePath"
          :d="curvePath"
          fill="none"
          :stroke="vizColor(2)"
          stroke-width="2"
          stroke-linejoin="round"
        />

        <g v-for="(marker, i) in markers" :key="`m-${i}`">
          <line
            :x1="xScale(marker.value)"
            :x2="xScale(marker.value)"
            y1="0"
            :y2="plotH"
            :stroke="vizColor(marker.color ?? 3)"
            stroke-width="2"
            :stroke-dasharray="marker.dashed === false ? undefined : '5 3'"
          />
          <text
            v-if="marker.label"
            :x="xScale(marker.value)"
            y="-3"
            text-anchor="middle"
            fill="var(--viz-label)"
            font-size="10"
          >{{ marker.label }}</text>
        </g>

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
          :y="plotH + 36"
          text-anchor="middle"
          fill="var(--viz-label)"
          font-size="11"
        >{{ xLabel }}</text>
        <text
          v-if="yLabel"
          :transform="`translate(${-margin.left + 12},${plotH / 2}) rotate(-90)`"
          text-anchor="middle"
          fill="var(--viz-label)"
          font-size="11"
        >{{ yLabel }}</text>
      </g>
    </svg>

    <div
      v-if="hovered !== null && bars[hovered]"
      class="pointer-events-none absolute z-10 rounded-md border border-default bg-default/95 px-2 py-1.5 text-xs shadow-lg"
      :style="{ left: `${Math.min(width - 170, margin.left + (bars[hovered] as { x: number }).x)}px`, top: `${margin.top}px` }"
    >
      <div class="text-muted tabular-nums">
        [{{ tickLabel((bars[hovered] as { lo: number }).lo) }},
        {{ tickLabel((bars[hovered] as { hi: number }).hi) }})
      </div>
      <div class="font-mono tabular-nums text-highlighted">
        {{ (bars[hovered] as { count: number }).count }} values
        <span v-if="asDensity" class="text-dimmed">
          · density {{ tickLabel((bars[hovered] as { value: number }).value) }}
        </span>
      </div>
    </div>

    <figcaption
      v-if="curvePath || markers.length"
      class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
    >
      <span class="inline-flex items-center gap-1.5">
        <span class="h-2 w-4 rounded-sm" :style="{ backgroundColor: vizColor(color, 0), opacity: 0.9 }" />
        {{ asDensity ? 'observed density' : 'observed counts' }}
      </span>
      <span v-if="curvePath" class="inline-flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line x1="0" y1="4" x2="16" y2="4" :stroke="vizColor(2)" stroke-width="2" />
        </svg>
        {{ referenceLabel }}
      </span>
      <span v-for="(marker, i) in markers" :key="`lm-${i}`" class="inline-flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line
            x1="0"
            y1="4"
            x2="16"
            y2="4"
            :stroke="vizColor(marker.color ?? 3)"
            stroke-width="2"
            stroke-dasharray="5 3"
          />
        </svg>
        {{ marker.label ?? 'marker' }}
      </span>
    </figcaption>
  </figure>
</template>
