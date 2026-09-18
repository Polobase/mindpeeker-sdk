<script setup lang="ts">
/**
 * The shared point field: the study window, its points, and whatever marks the
 * sections publish (attractor and void disks, the quadrat grid, the KDE
 * extremes, the scan window).
 *
 * No SDK import — it draws plain `{ x, y }` numbers. Colours are read from the
 * `--viz-*` CSS variables at paint time and the canvas repaints when the theme
 * class on <html> changes, so it follows light and dark mode like the charts.
 */
import { useElementWidth } from '~/lib/chart'
import type { FieldOverlay, OverlayColor } from '~/lib/field/types'

const props = withDefaults(
  defineProps<{
    points: readonly { x: number; y: number }[]
    region: { kind: 'rect'; width: number; height: number } | { kind: 'disk'; radius: number }
    overlays?: readonly FieldOverlay[]
    /** Points from this index on are drawn as the planted blob. */
    highlightFrom?: number
    /** Longest side in CSS pixels (default 560). */
    size?: number
    ariaLabel?: string
  }>(),
  { overlays: () => [], highlightFrom: undefined, size: 560, ariaLabel: undefined },
)

const wrap = ref<HTMLElement>()
const canvasEl = ref<HTMLCanvasElement>()
const hover = ref<{ x: number; y: number } | null>(null)
const available = useElementWidth(wrap, 560)

const box = computed<[number, number, number, number]>(() =>
  props.region.kind === 'rect'
    ? [0, 0, props.region.width, props.region.height]
    : [-props.region.radius, -props.region.radius, props.region.radius, props.region.radius],
)

const cssWidth = computed(() => Math.max(220, Math.min(props.size, available.value)))
const cssHeight = computed(() => {
  const [x0, y0, x1, y1] = box.value
  return Math.round((cssWidth.value * (y1 - y0)) / (x1 - x0))
})

function cssVar(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value.length > 0 ? value : fallback
}

const SLOT_FALLBACK = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7']

function paint(): void {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1)
  const w = cssWidth.value
  const h = cssHeight.value
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const slot = (c: OverlayColor) => cssVar(canvas, `--viz-${c}`, SLOT_FALLBACK[c - 1] as string)
  const axis = cssVar(canvas, '--viz-axis', '#8a8a8a')
  const grid = cssVar(canvas, '--viz-grid', '#d4d4d4')

  const [x0, y0, x1, y1] = box.value
  const scale = w / (x1 - x0)
  const px = (x: number) => (x - x0) * scale
  // y grows upwards in region coordinates, downwards on a canvas.
  const py = (y: number) => h - (y - y0) * scale

  // Window outline.
  ctx.lineWidth = 1
  ctx.strokeStyle = axis
  if (props.region.kind === 'rect') {
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
  } else {
    ctx.beginPath()
    ctx.arc(px(0), py(0), props.region.radius * scale - 0.5, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Grid overlays first, so points stay readable on top of them.
  for (const mark of props.overlays) {
    if (mark.kind !== 'grid') continue
    ctx.strokeStyle = slot(mark.color)
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < mark.nx; i++) {
      const x = px(x0 + ((x1 - x0) * i) / mark.nx)
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
    }
    for (let j = 1; j < mark.ny; j++) {
      const y = py(y0 + ((y1 - y0) * j) / mark.ny)
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // Points.
  const dot = Math.max(1.4, Math.min(3, 260 / Math.sqrt(Math.max(1, props.points.length)) / 6))
  const base = slot(1)
  const planted = slot(5)
  const cut = props.highlightFrom ?? props.points.length
  for (let i = 0; i < props.points.length; i++) {
    const p = props.points[i] as { x: number; y: number }
    ctx.fillStyle = i >= cut ? planted : base
    ctx.globalAlpha = i >= cut ? 0.95 : 0.8
    ctx.beginPath()
    ctx.arc(px(p.x), py(p.y), dot, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Circles and dots.
  for (const mark of props.overlays) {
    if (mark.kind === 'circle') {
      ctx.strokeStyle = slot(mark.color)
      ctx.lineWidth = 2
      ctx.setLineDash(mark.dashed ? [5, 4] : [])
      ctx.beginPath()
      ctx.arc(px(mark.x), py(mark.y), Math.max(2, mark.r * scale), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = slot(mark.color)
      ctx.beginPath()
      ctx.arc(px(mark.x), py(mark.y), 3.2, 0, Math.PI * 2)
      ctx.fill()
    } else if (mark.kind === 'dot') {
      ctx.strokeStyle = slot(mark.color)
      ctx.lineWidth = 2
      const cx = px(mark.x)
      const cy = py(mark.y)
      ctx.beginPath()
      ctx.moveTo(cx - 7, cy)
      ctx.lineTo(cx + 7, cy)
      ctx.moveTo(cx, cy - 7)
      ctx.lineTo(cx, cy + 7)
      ctx.stroke()
    }
  }
  ctx.strokeStyle = grid
}

function onMove(event: PointerEvent): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const [x0, y0, x1, y1] = box.value
  const fx = (event.clientX - rect.left) / rect.width
  const fy = (event.clientY - rect.top) / rect.height
  hover.value = { x: x0 + fx * (x1 - x0), y: y1 - fy * (y1 - y0) }
}

const legend = computed(() =>
  props.overlays
    .filter((m) => typeof m.label === 'string' && m.label.length > 0)
    .map((m) => ({ label: m.label as string, color: `var(--viz-${m.color})` })),
)

useElementReady(canvasEl, (canvas) => {
  paint()
  // Repaint when the colour mode flips the class on <html>.
  const observer = new MutationObserver(() => paint())
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  void canvas
  return () => observer.disconnect()
})

watch(
  () => [props.points, props.overlays, props.region, props.highlightFrom, cssWidth.value] as const,
  () => paint(),
  { flush: 'post' },
)
</script>

<template>
  <figure ref="wrap" class="w-full viz-fit flex flex-col items-center gap-2">
    <canvas
      ref="canvasEl"
      class="rounded border border-default bg-elevated/40 max-w-full"
      :style="{ width: `${cssWidth}px`, height: `${cssHeight}px` }"
      role="img"
      :aria-label="ariaLabel ?? `Point field of ${points.length} points in the study window`"
      @pointermove="onMove"
      @pointerleave="hover = null"
    />
    <figcaption class="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted">
      <span
        v-for="item in legend"
        :key="item.label"
        class="inline-flex items-center gap-1.5"
      >
        <span class="size-2.5 rounded-full" :style="{ background: item.color }" aria-hidden="true" />
        {{ item.label }}
      </span>
      <span v-if="highlightFrom !== undefined" class="inline-flex items-center gap-1.5">
        <span class="size-2.5 rounded-full" style="background: var(--viz-5)" aria-hidden="true" />
        planted blob
      </span>
      <span v-if="hover" class="font-mono tabular-nums text-highlighted">
        ({{ hover.x.toFixed(1) }}, {{ hover.y.toFixed(1) }})
      </span>
    </figcaption>
  </figure>
</template>
