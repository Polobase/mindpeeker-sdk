/**
 * Dashboard client entry point. Connects to the server's WebSocket, keeps
 * the panel grid in sync with the channel directory, routes binary frames to
 * panels by channel id, and drives one shared requestAnimationFrame loop.
 * Zero dependencies: everything is hand-rolled WebGL2 + a 2D text overlay.
 */
import { decodeFrame, PROTOCOL_VERSION, parseTextMessage } from '../src/protocol.js'
import type { ChannelInfo, DirectoryMessage } from '../src/types.js'
import { gridColumns } from './math.js'
import { bitmapPanel } from './panels/bitmap.js'
import { dialPanel } from './panels/dial.js'
import { matrixPanel } from './panels/matrix.js'
import type { Panel } from './panels/panel.js'
import { createShell } from './panels/panel.js'
import { seriesPanel } from './panels/series.js'

const RECONNECT_MS = 2000

const grid = document.getElementById('panels') as HTMLElement
const connection = document.getElementById('connection') as HTMLElement

interface Slot {
  readonly info: ChannelInfo
  readonly panel: Panel
}

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

function syncDirectory(message: DirectoryMessage): void {
  if (message.version !== PROTOCOL_VERSION) {
    connection.textContent = `protocol mismatch (server v${message.version})`
    return
  }
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

function connect(): void {
  const ws = new WebSocket(`ws://${location.host}/ws`)
  ws.binaryType = 'arraybuffer'
  connection.textContent = 'connecting…'
  connection.className = 'pending'

  ws.onopen = () => {
    connection.textContent = 'connected'
    connection.className = 'ok'
  }

  ws.onmessage = (event: MessageEvent) => {
    try {
      if (typeof event.data === 'string') {
        const message = parseTextMessage(event.data)
        if (message.type === 'directory') syncDirectory(message)
        else slots.get(message.id)?.panel.setStatic(message.data)
        return
      }
      const frame = decodeFrame(new Uint8Array(event.data as ArrayBuffer))
      slots.get(frame.channelId)?.panel.frame(frame)
    } catch (error) {
      console.error('frame rejected:', error)
    }
  }

  ws.onclose = () => {
    connection.textContent = 'disconnected — retrying'
    connection.className = 'down'
    setTimeout(connect, RECONNECT_MS)
  }
}

function loop(timeMs: number): void {
  for (const slot of slots.values()) slot.panel.render(timeMs)
  requestAnimationFrame(loop)
}

connect()
requestAnimationFrame(loop)
