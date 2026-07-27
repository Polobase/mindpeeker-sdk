/**
 * Dashboard client entry point: connects to the server's WebSocket and feeds
 * its decoded directory/frame/static messages to a {@link mountDashboard}
 * renderer, which owns the panel grid and the animation loop. The same
 * renderer is reused server-free by the demo site (see `client/mount.ts`).
 * Zero dependencies: everything is hand-rolled WebGL2 + a 2D text overlay.
 */
import { decodeFrame, PROTOCOL_VERSION, parseTextMessage } from '../src/protocol.js'
import { mountDashboard } from './mount.js'

const RECONNECT_MS = 2000

const grid = document.getElementById('panels') as HTMLElement
const connection = document.getElementById('connection') as HTMLElement
const dashboard = mountDashboard(grid)

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
        if (message.type === 'directory') {
          if (message.version !== PROTOCOL_VERSION) {
            connection.textContent = `protocol mismatch (server v${message.version})`
            return
          }
          dashboard.applyDirectory(message)
        } else dashboard.setStatic(message.id, message.data)
        return
      }
      dashboard.pushFrame(decodeFrame(new Uint8Array(event.data as ArrayBuffer)))
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

connect()
