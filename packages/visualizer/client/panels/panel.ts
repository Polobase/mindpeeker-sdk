/**
 * Panel plumbing shared by every renderer: the DOM shell (title bar, stacked
 * GL + overlay canvases) and the interface the app's frame router, resize
 * observer and animation loop talk to.
 */
import type { DecodedFrame } from '../../src/protocol.js'
import type { ChannelInfo } from '../../src/types.js'

/** What the app requires of every panel implementation. */
export interface Panel {
  /** Root element, already inserted in the grid. */
  readonly root: HTMLElement
  /** The canvas container whose size drives {@link Panel.resize}. */
  readonly wrap: HTMLElement
  /** Feed one decoded binary frame (bytes/series/matrix panels). */
  frame(f: DecodedFrame): void
  /** Feed the static JSON document (dial panel). */
  setStatic(data: unknown): void
  /** Called every animation frame with a monotonic time in ms. */
  render(timeMs: number): void
  /** Reflect the channel's directory entry (status, error reason, matrix range). */
  setInfo(info: ChannelInfo): void
  /**
   * Re-read the canvas box size and `devicePixelRatio`, resize both canvases
   * (and any aspect-dependent state) and redraw on the next frame.
   */
  resize(): void
  /** Drop accumulated data (points, rows, last frame) — e.g. before a reconnect replay. */
  reset(): void
  /** Release GPU resources; the panel must not be used afterwards. */
  dispose(): void
}

/** DOM scaffold for one panel: title, status badge, GL canvas, 2D overlay. */
export interface PanelShell {
  readonly root: HTMLElement
  readonly wrap: HTMLElement
  readonly glCanvas: HTMLCanvasElement
  readonly overlayCanvas: HTMLCanvasElement
  /** Show a status badge; `detail` (an error reason) is appended and put in the tooltip. */
  setStatus(status: string, detail?: string): void
  /** Replace the GL area with an error message (e.g. WebGL2 unavailable). */
  fail(message: string): void
  /** Size the GL canvas backing store to its CSS box × `devicePixelRatio`. */
  resizeGl(): void
  /** Lose the GL context (frees the browser's per-page context budget). */
  release(): void
}

/** Size a canvas backing store to its CSS box × devicePixelRatio (at least 1×1). */
export function fitCanvas(canvas: HTMLCanvasElement): void {
  const dpr = globalThis.devicePixelRatio || 1
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

/** Build the shell and size the GL canvas to the CSS box × devicePixelRatio. */
export function createShell(container: HTMLElement, title: string): PanelShell {
  const root = document.createElement('section')
  root.className = 'panel'
  const header = document.createElement('header')
  const heading = document.createElement('h2')
  heading.textContent = title
  const status = document.createElement('span')
  status.className = 'status live'
  status.textContent = 'live'
  header.append(heading, status)
  const wrap = document.createElement('div')
  wrap.className = 'canvas-wrap'
  const glCanvas = document.createElement('canvas')
  glCanvas.className = 'gl'
  const overlayCanvas = document.createElement('canvas')
  overlayCanvas.className = 'overlay'
  wrap.append(glCanvas, overlayCanvas)
  root.append(header, wrap)
  container.append(root)
  fitCanvas(glCanvas)

  return {
    root,
    wrap,
    glCanvas,
    overlayCanvas,
    setStatus(text, detail) {
      status.textContent = detail ? `${text} — ${detail}` : text
      status.title = detail ?? ''
      status.className = `status ${text}`
    },
    fail(message) {
      wrap.textContent = message
      wrap.classList.add('failed')
    },
    resizeGl() {
      fitCanvas(glCanvas)
    },
    release() {
      const gl = glCanvas.getContext('webgl2')
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
