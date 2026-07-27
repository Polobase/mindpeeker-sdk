/**
 * Server-agnostic dashboard renderer: owns the panel grid, the channel→panel
 * routing, and the shared animation loop. Feed it decoded directory/frame/
 * static updates through the returned {@link DashboardHandle} from any
 * transport — the bundled WebSocket client (`app.ts`) or a fully client-side
 * driver (the demo site).
 *
 * Browser-safe by construction: only relative + protocol imports, no bare
 * packages and no server reach, so the client-safety test covers it.
 */
import type { DecodedFrame } from '../src/protocol.js'
import type { ChannelInfo, DirectoryMessage } from '../src/types.js'
import { gridColumns } from './math.js'
import { bitmapPanel } from './panels/bitmap.js'
import { dialPanel } from './panels/dial.js'
import { matrixPanel } from './panels/matrix.js'
import { createShell, type Panel } from './panels/panel.js'
import { seriesPanel } from './panels/series.js'

interface Slot {
  readonly info: ChannelInfo
  readonly panel: Panel
}

/** Imperative handle for feeding a mounted dashboard. */
export interface DashboardHandle {
  /** Reconcile the panel grid with a channel directory. */
  applyDirectory(message: DirectoryMessage): void
  /** Route one decoded binary frame to its channel's panel. */
  pushFrame(frame: DecodedFrame): void
  /** Hand a static channel its JSON document. */
  setStatic(id: number, data: unknown): void
  /** Stop the animation loop and clear the grid. */
  destroy(): void
}

/**
 * Mount a dashboard into `grid` and start its render loop. The caller drives it
 * with directory/frame/static updates from whatever transport it likes.
 */
export function mountDashboard(grid: HTMLElement): DashboardHandle {
  const slots = new Map<number, Slot>()

  function makePanel(info: ChannelInfo): Panel {
    const shell = createShell(grid, info.name)
    try {
      switch (info.kind) {
        case 'bytes':
          return bitmapPanel(shell)
        case 'series':
          return seriesPanel(shell)
        case 'matrix':
          return matrixPanel(shell)
        case 'static':
          return dialPanel(shell)
      }
    } catch (error) {
      shell.fail(error instanceof Error ? error.message : String(error))
      return {
        root: shell.root,
        frame() {},
        setStatic() {},
        render() {},
        setStatus: shell.setStatus,
      }
    }
  }

  function applyDirectory(message: DirectoryMessage): void {
    const seen = new Set<number>()
    for (const info of message.channels) {
      seen.add(info.id)
      const existing = slots.get(info.id)
      if (existing && existing.info.name === info.name && existing.info.kind === info.kind) {
        existing.panel.setStatus(info.status)
        slots.set(info.id, { info, panel: existing.panel })
        continue
      }
      existing?.panel.root.remove()
      const panel = makePanel(info)
      panel.setStatus(info.status)
      slots.set(info.id, { info, panel })
    }
    for (const [id, slot] of slots) {
      if (!seen.has(id)) {
        slot.panel.root.remove()
        slots.delete(id)
      }
    }
    grid.style.gridTemplateColumns = `repeat(${gridColumns(slots.size)}, minmax(0, 1fr))`
  }

  let running = true
  function loop(timeMs: number): void {
    if (!running) return
    for (const slot of slots.values()) slot.panel.render(timeMs)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  return {
    applyDirectory,
    pushFrame(frame) {
      slots.get(frame.channelId)?.panel.frame(frame)
    },
    setStatic(id, data) {
      slots.get(id)?.panel.setStatic(data)
    },
    destroy() {
      running = false
      for (const slot of slots.values()) slot.panel.root.remove()
      slots.clear()
    },
  }
}
