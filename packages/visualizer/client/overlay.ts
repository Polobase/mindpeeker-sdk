/**
 * 2D-canvas overlay for text, axes, and legends. WHY a second canvas: WebGL2
 * core has no text rasterization — shipping a glyph atlas or an SDF font
 * would break the zero-dependency budget, while `CanvasRenderingContext2D`
 * renders crisp, DPI-aware text for free. Each panel therefore stacks a
 * transparent 2D canvas over its GL canvas; GL draws data, 2D draws words.
 */

export interface Overlay {
  readonly ctx: CanvasRenderingContext2D
  /** CSS-pixel width/height (the context is pre-scaled for devicePixelRatio). */
  readonly width: number
  readonly height: number
  clear(): void
}

const FONT = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
export const OVERLAY_TEXT = '#9da7b3'
export const OVERLAY_GRID = 'rgba(157, 167, 179, 0.15)'

/** Size a canvas to its CSS box × devicePixelRatio and return a 2D overlay. */
export function setupOverlay(canvas: HTMLCanvasElement): Overlay {
  const dpr = globalThis.devicePixelRatio || 1
  const width = canvas.clientWidth || 300
  const height = canvas.clientHeight || 150
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable')
  ctx.scale(dpr, dpr)
  ctx.font = FONT
  return {
    ctx,
    width,
    height,
    clear() {
      ctx.clearRect(0, 0, width, height)
    },
  }
}

/** Draw horizontal gridlines + right-aligned labels for y-axis ticks. */
export function drawYTicks(
  overlay: Overlay,
  ticks: readonly number[],
  yScale: (v: number) => number,
): void {
  const { ctx, width } = overlay
  ctx.strokeStyle = OVERLAY_GRID
  ctx.fillStyle = OVERLAY_TEXT
  ctx.lineWidth = 1
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  for (const tick of ticks) {
    const y = yScale(tick)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
    ctx.fillText(formatTick(tick), 4, y - 2)
  }
}

/** Compact tick formatting: trims float noise, switches to exponent notation. */
export function formatTick(v: number): string {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 10_000 || abs < 0.001) return v.toExponential(1)
  return Number(v.toPrecision(4)).toString()
}

/** Status caption in a panel corner (latest value, drop counts, …). */
export function drawCaption(overlay: Overlay, text: string): void {
  const { ctx } = overlay
  ctx.fillStyle = OVERLAY_TEXT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(text, overlay.width - 6, 6)
}
