<script setup lang="ts">
import { extent, VIRIDIS, viridisCss } from '~/lib/chart'
import { fmtNum } from '~/lib/format'

/**
 * A matrix as a canvas heatmap on the viridis ramp (perceptually uniform, one
 * hue family, CVD-safe) with a legend and a hovered-cell readout. Client-only
 * (it paints a canvas), no SDK imports.
 *
 * ```vue
 * <HeatmapCanvas :data="density" :rows="16" :cols="16"
 *   aria-label="byte-value density" row-label="high nibble" col-label="low nibble" />
 * ```
 */
const props = withDefaults(
  defineProps<{
    /** Row-major matrix of length rows × cols. */
    data: ArrayLike<number>
    rows: number
    cols: number
    /** Colour-scale bounds; default: the data extent. */
    min?: number
    max?: number
    /** CSS height of the canvas (default 240). */
    height?: number
    ariaLabel?: string
    rowLabel?: string
    colLabel?: string
    /** Show the colour legend (default true). */
    legend?: boolean
    /** Formats a cell value in the readout. */
    format?: (value: number) => string
  }>(),
  {
    min: undefined,
    max: undefined,
    height: 240,
    ariaLabel: undefined,
    rowLabel: undefined,
    colLabel: undefined,
    legend: true,
    format: undefined,
  },
)

const canvasEl = ref<HTMLCanvasElement>()
const hover = ref<{ row: number; col: number; value: number } | null>(null)

const bounds = computed<[number, number]>(() => {
  if (props.min !== undefined && props.max !== undefined) return [props.min, props.max]
  const [lo, hi] = extent(props.data)
  return [props.min ?? lo, props.max ?? (hi === lo ? lo + 1 : hi)]
})

function paint(): void {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const { rows, cols, data } = props
  if (rows < 1 || cols < 1) return
  canvas.width = cols
  canvas.height = rows
  const image = ctx.createImageData(cols, rows)
  const [lo, hi] = bounds.value
  const span = hi - lo || 1
  for (let i = 0; i < rows * cols; i++) {
    const value = data[i] as number
    const t = Number.isFinite(value) ? Math.max(0, Math.min(1, (value - lo) / span)) : 0
    const c = Math.round(t * 255) * 3
    image.data[i * 4] = VIRIDIS[c] as number
    image.data[i * 4 + 1] = VIRIDIS[c + 1] as number
    image.data[i * 4 + 2] = VIRIDIS[c + 2] as number
    image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
}

function onMove(event: PointerEvent): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const col = Math.floor(((event.clientX - rect.left) / rect.width) * props.cols)
  const row = Math.floor(((event.clientY - rect.top) / rect.height) * props.rows)
  if (row < 0 || col < 0 || row >= props.rows || col >= props.cols) {
    hover.value = null
    return
  }
  hover.value = { row, col, value: props.data[row * props.cols + col] as number }
}

const fmt = (value: number) => (props.format ? props.format(value) : fmtNum(value, { digits: 3 }))

// Not `onMounted`: inside a *.client.vue component the template ref is still
// undefined there during hydration (see useElementReady).
useElementReady(canvasEl, () => paint())
watch(
  () => [props.data, props.rows, props.cols, props.min, props.max],
  () => paint(),
  { deep: false, flush: 'post' },
)
</script>

<template>
  <figure class="w-full viz-fit">
    <canvas
      ref="canvasEl"
      class="w-full rounded border border-default bg-elevated [image-rendering:pixelated]"
      :style="{ height: `${height}px` }"
      :aria-label="ariaLabel ?? `Heatmap of ${rows} by ${cols} values`"
      role="img"
      @pointermove="onMove"
      @pointerleave="hover = null"
    />
    <figcaption class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span v-if="legend" class="inline-flex items-center gap-1.5">
        <span class="tabular-nums">{{ fmt(bounds[0]) }}</span>
        <span
          class="h-2 w-24 rounded-sm"
          :style="{
            background: `linear-gradient(to right, ${viridisCss(0)}, ${viridisCss(0.25)}, ${viridisCss(0.5)}, ${viridisCss(0.75)}, ${viridisCss(1)})`,
          }"
          aria-hidden="true"
        />
        <span class="tabular-nums">{{ fmt(bounds[1]) }}</span>
      </span>
      <span v-if="rowLabel || colLabel" class="text-dimmed">
        {{ [rowLabel ? `rows: ${rowLabel}` : '', colLabel ? `columns: ${colLabel}` : ''].filter(Boolean).join(' · ') }}
      </span>
      <span v-if="hover" class="font-mono tabular-nums text-highlighted">
        [{{ hover.row }}, {{ hover.col }}] = {{ fmt(hover.value) }}
      </span>
    </figcaption>
  </figure>
</template>
