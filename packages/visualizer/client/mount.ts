/**
 * Server-agnostic dashboard renderer: owns the panel grid, the channel→panel
 * routing, the resize tracking and the shared animation loop. Feed it decoded
 * directory/frame/static updates through the returned {@link DashboardHandle}
 * from any transport — the bundled WebSocket client (`app.ts`) or a fully
 * client-side driver (the demo site).
 *
 * Browser-safe by construction: only relative + protocol imports, no bare
 * packages and no server reach, so the client-safety test covers it.
 */
import type { DecodedFrame } from '../src/protocol.js'
import type { ChannelInfo, DirectoryMessage } from '../src/types.js'
import { planDirectory } from './directory.js'
import { fitColumns } from './math.js'
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
  /**
   * Clear every panel's accumulated data (series points, bitmap rows, last
   * matrix) while keeping the panels — call it when a new connection is about
   * to replay the server's retained frames, so history is not duplicated.
   */
  reset(): void
  /** Stop the animation loop and resize tracking, release GL contexts, clear the grid. */
  destroy(): void
}

/**
 * Mount a dashboard into `grid` and start its render loop. The caller drives it
 * with directory/frame/static updates from whatever transport it likes. Every
 * panel follows its container's size (a `ResizeObserver`) and the display's
 * `devicePixelRatio`, so canvases stay sharp and the dial stays circular; the
 * grid's inline column count follows the grid width (one column on a phone).
 */
export function mountDashboard(grid: HTMLElement): DashboardHandle {
  const slots = new Map<number, Slot>()
  const panelsByWrap = new Map<Element, Panel>()
  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (entry.target === grid) layoutColumns()
            else panelsByWrap.get(entry.target)?.resize()
          }
        })
      : undefined
  observer?.observe(grid)

  /** Column count last written to the grid's inline style (browsers normalize the string). */
  let appliedColumns = 0
  function applyColumns(columns: number): void {
    if (columns === appliedColumns) return
    appliedColumns = columns
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`
  }
  /** Column count for the current grid width (one column on a phone). */
  function layoutColumns(): void {
    if (slots.size > 0) applyColumns(fitColumns(slots.size, grid.clientWidth))
  }

  // devicePixelRatio changes (zoom, moving to another monitor) do not resize
  // the CSS box, so a resolution media query re-armed per ratio tracks them.
  let dprQuery: MediaQueryList | undefined
  const onDprChange = (): void => {
    for (const slot of slots.values()) slot.panel.resize()
    watchDpr()
  }
  function watchDpr(): void {
    dprQuery?.removeEventListener('change', onDprChange)
    dprQuery = undefined
    if (typeof globalThis.matchMedia !== 'function') return
    dprQuery = globalThis.matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`)
    dprQuery.addEventListener('change', onDprChange)
  }
  watchDpr()

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
        wrap: shell.wrap,
        frame() {},
        setStatic() {},
        render() {},
        setInfo(next) {
          shell.setStatus(next.status, next.error)
        },
        resize() {},
        reset() {},
        dispose: shell.release,
      }
    }
  }

  function removeSlot(slot: Slot): void {
    observer?.unobserve(slot.panel.wrap)
    panelsByWrap.delete(slot.panel.wrap)
    slot.panel.dispose()
    slot.panel.root.remove()
  }

  function applyDirectory(message: DirectoryMessage): void {
    const plan = planDirectory(
      new Map([...slots].map(([id, slot]) => [id, slot.info] as const)),
      message.channels,
      grid.clientWidth,
    )
    for (const id of plan.remove) {
      const slot = slots.get(id)
      if (slot) removeSlot(slot)
      slots.delete(id)
    }
    // the final layout must exist before new panels size their canvases
    applyColumns(plan.columns)
    plan.entries.forEach(({ info, create }, index) => {
      let panel = slots.get(info.id)?.panel
      if (create || !panel) {
        panel = makePanel(info)
        panelsByWrap.set(panel.wrap, panel)
        observer?.observe(panel.wrap)
      }
      slots.set(info.id, { info, panel })
      panel.setInfo(info)
      const occupant = grid.children[index]
      if (occupant !== panel.root) grid.insertBefore(panel.root, occupant ?? null)
    })
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
    reset() {
      for (const slot of slots.values()) slot.panel.reset()
    },
    destroy() {
      running = false
      observer?.disconnect()
      dprQuery?.removeEventListener('change', onDprChange)
      dprQuery = undefined
      for (const slot of slots.values()) removeSlot(slot)
      slots.clear()
      appliedColumns = 0
      grid.style.gridTemplateColumns = ''
    },
  }
}
