/**
 * Dashboard client entry point: connects to the server's WebSocket and feeds
 * its decoded directory/frame/static messages to a {@link mountDashboard}
 * renderer, which owns the panel grid and the animation loop. The same
 * renderer is reused server-free by the demo site (see `client/mount.ts`).
 * Zero dependencies: everything is hand-rolled WebGL2 + a 2D text overlay.
 *
 * Connection hygiene: the socket scheme follows the page (`wss:` under
 * https), panels are reset on every (re)connect before the server replays its
 * retained frames, and a server speaking another protocol version closes the
 * socket for good (reload the page after upgrading).
 */
import { decodeFrame, PROTOCOL_VERSION, parseTextMessage } from '../src/protocol.js'
import { mountDashboard } from './mount.js'

const RECONNECT_MS = 2000

const grid = document.getElementById('panels') as HTMLElement
const connection = document.getElementById('connection') as HTMLElement
const dashboard = mountDashboard(grid)
/** Set once a protocol mismatch was seen: no further messages, no reconnects. */
let halted = false

function socketUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}/ws`
}

function connect(): void {
  const ws = new WebSocket(socketUrl())
  ws.binaryType = 'arraybuffer'
  connection.textContent = 'connecting…'
  connection.className = 'pending'

  ws.onopen = () => {
    // the server replays every retained frame on connect; start from empty
    dashboard.reset()
    connection.textContent = 'connected'
    connection.className = 'ok'
  }

  ws.onmessage = (event: MessageEvent) => {
    if (halted) return
    try {
      if (typeof event.data === 'string') {
        const message = parseTextMessage(event.data)
        if (message.type === 'directory') {
          if (message.version !== PROTOCOL_VERSION) {
            halted = true
            connection.textContent = `protocol mismatch (server v${message.version}, client v${PROTOCOL_VERSION}) — reload after upgrading`
            connection.className = 'down'
            ws.close(1000, 'protocol mismatch')
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
    if (halted) return
    connection.textContent = 'disconnected — retrying'
    connection.className = 'down'
    setTimeout(connect, RECONNECT_MS)
  }
}

connect()
