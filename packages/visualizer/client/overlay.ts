/**
 * 2D-canvas overlay for text, axes, and legends. WHY a second canvas: WebGL2
 * core has no text rasterization — shipping a glyph atlas or an SDF font
 * would break the zero-dependency budget, while `CanvasRenderingContext2D`
 * renders crisp, DPI-aware text for free. Each panel therefore stacks a
 * transparent 2D canvas over its GL canvas; GL draws data, 2D draws words.
 */

export interface Overlay {
  readonly ctx: CanvasRenderingContext2D
  /** Current CSS-pixel width/height (the context is pre-scaled for devicePixelRatio). */
  readonly width: number
  readonly height: number
  clear(): void
  /**
   * Re-read the canvas's CSS box and `devicePixelRatio`, resize the backing
   * store and re-apply the DPR transform and font. Clears the canvas.
   */
  resize(): void
}

const FONT = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
/** Pixel height reserved for one line of tick-label text. */
const LABEL_HEIGHT = 13
export const OVERLAY_TEXT = '#9da7b3'
export const OVERLAY_GRID = 'rgba(157, 167, 179, 0.15)'

/** Size a canvas to its CSS box × devicePixelRatio and return a resizable 2D overlay. */
export function setupOverlay(canvas: HTMLCanvasElement): Overlay {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable')
  let width = 0
  let height = 0
  const resize = (): void => {
    const dpr = globalThis.devicePixelRatio || 1
    width = canvas.clientWidth || 300
    height = canvas.clientHeight || 150
    // assigning width/height resets the context state (transform, font)
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.font = FONT
  }
  resize()
  return {
    ctx,
    get width() {
      return width
    },
    get height() {
      return height
    },
    clear() {
      ctx.clearRect(0, 0, width, height)
    },
    resize,
  }
}

/**
 * Draw horizontal gridlines with left-aligned y-axis labels. Each label sits
 * just above its gridline, or just below it when there is no room above (the
 * topmost tick), so labels never clip at the canvas edge. `yScale` must map
 * values to CSS pixels of the overlay's *current* size.
 */
export function drawYTicks(
  overlay: Overlay,
  ticks: readonly number[],
  yScale: (v: number) => number,
): void {
  const { ctx, width, height } = overlay
  ctx.strokeStyle = OVERLAY_GRID
  ctx.fillStyle = OVERLAY_TEXT
  ctx.lineWidth = 1
  ctx.textAlign = 'left'
  for (const tick of ticks) {
    const y = yScale(tick)
    if (!(y >= 0 && y <= height)) continue
    // snap to the pixel centre so a 1px line is crisp, not a 2px blur
    const lineY = Math.round(y) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, lineY)
    ctx.lineTo(width, lineY)
    ctx.stroke()
    const above = y - LABEL_HEIGHT >= 0
    ctx.textBaseline = above ? 'bottom' : 'top'
    ctx.fillText(formatTick(tick), 4, above ? lineY - 2 : lineY + 2)
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
