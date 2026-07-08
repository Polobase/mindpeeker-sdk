/**
 * Panel plumbing shared by every renderer: the DOM shell (title bar, stacked
 * GL + overlay canvases) and the interface the app's frame router and
 * animation loop talk to.
 */
import type { DecodedFrame } from '../../src/protocol.js'

/** What the app requires of every panel implementation. */
export interface Panel {
  /** Root element, already inserted in the grid. */
  readonly root: HTMLElement
  /** Feed one decoded binary frame (bytes/series/matrix panels). */
  frame(f: DecodedFrame): void
  /** Feed the static JSON document (dial panel). */
  setStatic(data: unknown): void
  /** Called every animation frame with a monotonic time in ms. */
  render(timeMs: number): void
  /** Reflect the channel's directory status (live/ended/error). */
  setStatus(status: string): void
}

/** DOM scaffold for one panel: title, status badge, GL canvas, 2D overlay. */
export interface PanelShell {
  readonly root: HTMLElement
  readonly glCanvas: HTMLCanvasElement
  readonly overlayCanvas: HTMLCanvasElement
  setStatus(text: string): void
  /** Replace the GL area with an error message (e.g. WebGL2 unavailable). */
  fail(message: string): void
}

/** Build the shell and size both canvases to the CSS box × devicePixelRatio. */
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

  const dpr = globalThis.devicePixelRatio || 1
  glCanvas.width = Math.max(1, Math.round(glCanvas.clientWidth * dpr))
  glCanvas.height = Math.max(1, Math.round(glCanvas.clientHeight * dpr))

  return {
    root,
    glCanvas,
    overlayCanvas,
    setStatus(text) {
      status.textContent = text
      status.className = `status ${text}`
    },
    fail(message) {
      wrap.textContent = message
      wrap.classList.add('failed')
    },
  }
}
