/**
 * Bun-native dashboard server. THIS MODULE IS BUN-ONLY: it calls `Bun.serve`
 * and `Bun.file` directly (websocket fan-out and static file serving are
 * runtime concerns, deliberately outside the browser-safe surface —
 * `protocol.ts`/`types.ts` stay pure and shared with the client).
 */
import type { Server, ServerWebSocket } from 'bun'
import { VisualizerError } from '../errors.js'
import { RingBuffer } from '../internal/ring.js'
import {
  encodeBytesFrame,
  encodeMatrixFrame,
  encodeSeriesFrame,
  PROTOCOL_VERSION,
} from '../protocol.js'
import type {
  ChannelInfo,
  ChannelKind,
  ChannelStatus,
  Dashboard,
  DashboardOptions,
  DirectoryMessage,
  MatrixFrameInput,
  SeriesSample,
  StaticMessage,
} from '../types.js'

const DEFAULT_RING_CAPACITY = 256
/**
 * Per-socket buffered-bytes budget. When a client's kernel/user-space queue
 * exceeds this, new binary frames are dropped for that socket instead of
 * queued — the second half of the "slow clients never block producers"
 * guarantee (the ring buffer bounds replay history, this bounds live fan-out).
 */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024

interface Channel {
  readonly id: number
  readonly name: string
  readonly kind: ChannelKind
  status: ChannelStatus
  rowLabels?: readonly string[]
  colLabels?: readonly string[]
  readonly ring: RingBuffer<Uint8Array>
  staticData?: unknown
}

/** Serve the bundled client, falling back to a stub page before `bun run build`. */
async function clientAsset(name: 'index.html' | 'app.js'): Promise<Response | undefined> {
  // Compiled layout: dist/server/dashboard.js → dist/client/*.
  // Source layout (tests, `bun src/cli.ts`): src/server/dashboard.ts → dist/client/*.
  const candidates = [`../client/${name}`, `../../dist/client/${name}`]
  for (const rel of candidates) {
    const file = Bun.file(new URL(rel, import.meta.url))
    if (await file.exists()) {
      const type = name.endsWith('.js') ? 'text/javascript' : 'text/html'
      return new Response(file, { headers: { 'content-type': `${type}; charset=utf-8` } })
    }
  }
  if (name === 'index.html') {
    const stub =
      '<!doctype html><meta charset="utf-8"><title>mindpeeker visualizer</title>' +
      '<body style="font: 14px monospace; background: #0d1117; color: #c9d1d9; padding: 2rem">' +
      '<p>Client bundle not found — run <code>bun run build</code> in packages/visualizer.</p>'
    return new Response(stub, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  return undefined
}

/**
 * Start a dashboard: `Bun.serve` HTTP + WebSocket on one port. HTTP serves
 * the bundled WebGL2 client; `/ws` upgrades to the fan-out socket. Every
 * client receives, in order: the channel directory (JSON), all static
 * documents (JSON), then each channel's retained ring of binary frames —
 * so a late joiner immediately shows recent history.
 *
 * Producers attached via `attach*` are pumped in detached background tasks;
 * their frames go into a per-channel drop-oldest {@link RingBuffer} and are
 * fanned out to every open socket whose buffered amount is under budget.
 * Nothing a client does (or fails to do) can slow a producer down.
 */
export function createDashboard(opts: DashboardOptions = {}): Dashboard {
  if (opts.signal?.aborted) {
    throw new VisualizerError('aborted', 'dashboard aborted before start')
  }
  const ringCapacity = opts.ringCapacity ?? DEFAULT_RING_CAPACITY
  if (!Number.isInteger(ringCapacity) || ringCapacity < 1) {
    throw new VisualizerError('server', `ringCapacity must be an integer ≥ 1, got ${ringCapacity}`)
  }
  const host = opts.host ?? 'localhost'
  const channels = new Map<string, Channel>()
  const sockets = new Set<ServerWebSocket<undefined>>()
  let nextChannelId = 0
  let stopped = false

  const directoryMessage = (): string => {
    const list: ChannelInfo[] = [...channels.values()].map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      status: c.status,
      ...(c.rowLabels ? { rowLabels: c.rowLabels } : {}),
      ...(c.colLabels ? { colLabels: c.colLabels } : {}),
    }))
    const message: DirectoryMessage = {
      type: 'directory',
      version: PROTOCOL_VERSION,
      channels: list,
    }
    return JSON.stringify(message)
  }

  const staticMessage = (channel: Channel): string => {
    const message: StaticMessage = {
      type: 'static',
      id: channel.id,
      name: channel.name,
      data: channel.staticData,
    }
    return JSON.stringify(message)
  }

  const broadcastText = (text: string): void => {
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(text)
    }
  }

  const broadcastFrame = (frame: Uint8Array): void => {
    for (const ws of sockets) {
      if (ws.readyState !== 1) continue
      if (ws.getBufferedAmount() > MAX_BUFFERED_BYTES) continue // drop, never queue unboundedly
      ws.send(frame)
    }
  }

  let server: Server<undefined>
  try {
    server = Bun.serve({
      port: opts.port ?? 0,
      hostname: host,
      async fetch(req, srv) {
        const url = new URL(req.url)
        if (url.pathname === '/ws') {
          if (srv.upgrade(req)) return undefined
          return new Response('websocket upgrade required', { status: 400 })
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
          // clientAsset always yields a Response for index.html (stub fallback)
          return (await clientAsset('index.html')) ?? new Response('missing', { status: 500 })
        }
        if (url.pathname === '/app.js') {
          return (await clientAsset('app.js')) ?? new Response('not built', { status: 404 })
        }
        return new Response('not found', { status: 404 })
      },
      websocket: {
        open(ws) {
          sockets.add(ws)
          ws.send(directoryMessage())
          for (const channel of channels.values()) {
            if (channel.kind === 'static') ws.send(staticMessage(channel))
            for (const frame of channel.ring.snapshot()) ws.send(frame)
          }
        },
        message() {
          // The protocol is currently one-directional; client frames are ignored.
        },
        close(ws) {
          sockets.delete(ws)
        },
      },
    })
  } catch (cause) {
    throw new VisualizerError('server', `failed to start dashboard on ${host}:${opts.port ?? 0}`, {
      cause,
    })
  }

  const register = (name: string, kind: ChannelKind): Channel => {
    if (stopped) {
      throw new VisualizerError('server', 'dashboard already stopped', { channel: name })
    }
    if (name.length === 0) {
      throw new VisualizerError('invalid_channel', 'channel name must be non-empty')
    }
    if (channels.has(name)) {
      throw new VisualizerError('invalid_channel', `channel '${name}' already exists`, {
        channel: name,
      })
    }
    if (nextChannelId > 0xffff) {
      throw new VisualizerError('invalid_channel', 'channel id space (u16) exhausted', {
        channel: name,
      })
    }
    const channel: Channel = {
      id: nextChannelId++,
      name,
      kind,
      status: 'live',
      ring: new RingBuffer(ringCapacity),
    }
    channels.set(name, channel)
    return channel
  }

  const setStatus = (channel: Channel, status: ChannelStatus): void => {
    if (channel.status === status) return
    channel.status = status
    if (!stopped) broadcastText(directoryMessage())
  }

  /** Pump one producer; detached so attach* returns immediately. */
  const consume = <T>(channel: Channel, src: AsyncIterable<T>, encode: (item: T) => Uint8Array) => {
    void (async () => {
      try {
        for await (const item of src) {
          if (stopped) break
          const frame = encode(item)
          channel.ring.push(frame)
          broadcastFrame(frame)
        }
        setStatus(channel, 'ended')
      } catch {
        setStatus(channel, stopped ? 'ended' : 'error')
      }
    })()
  }

  const dashboard: Dashboard = {
    url: `http://${host}:${server.port}/`,
    port: server.port ?? 0,

    attachByteStream(name, src) {
      const channel = register(name, 'bytes')
      broadcastText(directoryMessage())
      consume(channel, src, (bytes) => encodeBytesFrame(channel.id, bytes))
    },

    attachSeries(name, src) {
      const channel = register(name, 'series')
      broadcastText(directoryMessage())
      let autoT = 0
      consume(channel, src, (sample: SeriesSample) => {
        const point =
          typeof sample === 'number'
            ? { t: autoT, value: sample }
            : { t: sample.t ?? autoT, value: sample.value, band: sample.band }
        autoT++
        return encodeSeriesFrame(channel.id, [point])
      })
    },

    attachMatrix(name, src) {
      const channel = register(name, 'matrix')
      broadcastText(directoryMessage())
      consume(channel, src, (frame: MatrixFrameInput) => {
        const labelsChanged =
          JSON.stringify(frame.rowLabels) !== JSON.stringify(channel.rowLabels) ||
          JSON.stringify(frame.colLabels) !== JSON.stringify(channel.colLabels)
        if (labelsChanged) {
          channel.rowLabels = frame.rowLabels
          channel.colLabels = frame.colLabels
          broadcastText(directoryMessage())
        }
        return encodeMatrixFrame(channel.id, frame)
      })
    },

    attachStatic(name, json) {
      const channel = register(name, 'static')
      channel.staticData = json
      broadcastText(directoryMessage())
      broadcastText(staticMessage(channel))
    },

    async stop() {
      if (stopped) return
      stopped = true
      // Drain: clients get a clean 1000 close before the listener dies.
      for (const ws of sockets) ws.close(1000, 'dashboard stopped')
      // Bun ≤ 1.3 quirk: when websockets were server-closed first, the
      // stop() promise may never settle even though the port is released
      // immediately. Bound the wait so stop() always returns.
      await Promise.race([
        server.stop(true),
        new Promise<void>((resolve) => setTimeout(resolve, 150)),
      ])
    },
  }

  opts.signal?.addEventListener('abort', () => void dashboard.stop(), { once: true })
  return Object.freeze(dashboard)
}
