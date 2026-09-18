<script setup lang="ts">
import {
  extent,
  linearScale,
  niceTicks,
  tickFormatter,
  tickLabel,
  useElementWidth,
  type VizColor,
  vizColor,
} from '~/lib/chart'

/**
 * Responsive SVG bar chart with an optional expected/reference overlay.
 * Theme-aware, hover tooltips on every bar, SSR-safe.
 *
 * ```vue
 * <BarChart :categories="['6', '7', '8', '9']" :values="observed"
 *   :expected="[0.0625, 0.3125, 0.4375, 0.1875]" expected-label="exact odds"
 *   y-label="frequency" :height="240" />
 * ```
 */
const props = withDefaults(
  defineProps<{
    categories: readonly string[]
    values: ArrayLike<number>
    /** One number for all bars, or one per bar — drawn as a reference tick. */
    expected?: number | ArrayLike<number>
    expectedLabel?: string
    color?: VizColor
    /** Highlight these indexes in the second palette slot. */
    highlight?: readonly number[]
    xLabel?: string
    yLabel?: string
    height?: number
    /** Show every n-th category label (default: automatic). */
    labelEvery?: number
    ariaLabel?: string
    format?: (value: number) => string
  }>(),
  {
    expected: undefined,
    expectedLabel: 'expected',
    color: undefined,
    highlight: () => [],
    xLabel: undefined,
    yLabel: undefined,
    height: 240,
    labelEvery: undefined,
    ariaLabel: undefined,
    format: undefined,
  },
)

const root = ref<HTMLElement>()
const width = useElementWidth(root, 640)

const margin = computed(() => ({
  top: 10,
  right: 14,
  bottom: props.xLabel ? 46 : 30,
  left: props.yLabel ? 62 : 48,
}))
const plotW = computed(() => Math.max(40, width.value - margin.value.left - margin.value.right))
const plotH = computed(() => Math.max(40, props.height - margin.value.top - margin.value.bottom))

const n = computed(() => Math.min(props.categories.length, props.values.length))
const expectedAt = (i: number): number | undefined => {
  const e = props.expected
  if (e === undefined) return undefined
  return typeof e === 'number' ? e : (e[i] as number | undefined)
}

const yDomain = computed<[number, number]>(() => {
  const values: number[] = []
  for (let i = 0; i < n.value; i++) {
    values.push(props.values[i] as number)
    const e = expectedAt(i)
    if (e !== undefined) values.push(e)
  }
  const [min, max] = extent(values)
  return [Math.min(0, min), max === 0 ? 1 : max * 1.08]
})

const yScale = computed(() => linearScale(yDomain.value, [plotH.value, 0]))
const yTicks = computed(() => niceTicks(yDomain.value[0], yDomain.value[1], 5))
// One formatter for the whole axis, so adjacent ticks stay distinct.
const yTickFmt = computed(() => tickFormatter(yTicks.value))
const band = computed(() => plotW.value / Math.max(1, n.value))
const barWidth = computed(() => Math.max(1, Math.min(24, band.value - 2)))

const bars = computed(() => {
  const out: {
    i: number
    label: string
    value: number
    x: number
    y: number
    h: number
    color: string
    expected?: number
  }[] = []
  const zero = yScale.value(0)
  for (let i = 0; i < n.value; i++) {
    const value = props.values[i] as number
    const y = yScale.value(Number.isFinite(value) ? value : 0)
    out.push({
      i,
      label: props.categories[i] as string,
      value,
      x: i * band.value + (band.value - barWidth.value) / 2,
      y: Math.min(y, zero),
      h: Math.max(1, Math.abs(zero - y)),
      color: props.highlight.includes(i) ? vizColor(2) : vizColor(props.color, 0),
      ...(expectedAt(i) !== undefined ? { expected: expectedAt(i) as number } : {}),
    })
  }
  return out
})

const every = computed(() => {
  if (props.labelEvery) return props.labelEvery
  const perLabel = Math.max(1, Math.ceil((n.value * 28) / Math.max(1, plotW.value)))
  return perLabel
})

const hovered = ref<number | null>(null)
const fmt = (value: number) => (props.format ? props.format(value) : tickLabel(value))
const label = computed(
  () => props.ariaLabel ?? `Bar chart of ${n.value} categories${props.yLabel ? ` (${props.yLabel})` : ''}`,
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

        <g>
          <rect
            v-for="bar in bars"
            :key="`b-${bar.i}`"
            :x="bar.x"
            :y="bar.y"
            :width="barWidth"
            :height="bar.h"
            :fill="bar.color"
            :fill-opacity="hovered === null || hovered === bar.i ? 1 : 0.55"
            rx="2"
            @pointerenter="hovered = bar.i"
            @pointerleave="hovered = null"
          >
            <title>{{ bar.label }}: {{ fmt(bar.value) }}</title>
          </rect>
        </g>

        <!-- expected overlay: a tick per bar, never a second axis -->
        <g v-if="expected !== undefined" stroke="var(--viz-axis)" stroke-width="2">
          <line
            v-for="bar in bars.filter((b) => b.expected !== undefined)"
            :key="`e-${bar.i}`"
            :x1="bar.x - 1"
            :x2="bar.x + barWidth + 1"
            :y1="yScale(bar.expected as number)"
            :y2="yScale(bar.expected as number)"
          />
        </g>

        <line x1="0" :x2="plotW" :y1="yScale(0)" :y2="yScale(0)" stroke="var(--viz-grid)" stroke-width="1" />

        <g fill="var(--viz-label)" font-size="10">
          <text
            v-for="tick in yTicks"
            :key="`ty-${tick}`"
            x="-8"
            :y="yScale(tick) + 3"
            text-anchor="end"
          >{{ yTickFmt(tick) }}</text>
          <template v-for="bar in bars" :key="`tx-${bar.i}`">
            <text
              v-if="bar.i % every === 0"
              :x="bar.x + barWidth / 2"
              :y="plotH + 16"
              text-anchor="middle"
            >{{ bar.label }}</text>
          </template>
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
      :style="{
        left: `${Math.min(width - 150, margin.left + (bars[hovered] as { x: number }).x)}px`,
        top: `${margin.top}px`,
      }"
    >
      <div class="text-muted">{{ (bars[hovered] as { label: string }).label }}</div>
      <div class="font-mono tabular-nums text-highlighted">
        {{ fmt((bars[hovered] as { value: number }).value) }}
      </div>
      <div
        v-if="(bars[hovered] as { expected?: number }).expected !== undefined"
        class="text-dimmed"
      >
        {{ expectedLabel }} {{ fmt((bars[hovered] as { expected: number }).expected) }}
      </div>
    </div>

    <figcaption
      v-if="expected !== undefined"
      class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
    >
      <span class="inline-flex items-center gap-1.5">
        <span class="h-2 w-4 rounded-sm" :style="{ backgroundColor: vizColor(color, 0) }" />
        observed
      </span>
      <span class="inline-flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line x1="0" y1="4" x2="16" y2="4" stroke="var(--viz-axis)" stroke-width="2" />
        </svg>
        {{ expectedLabel }}
      </span>
    </figcaption>
  </figure>
</template>
