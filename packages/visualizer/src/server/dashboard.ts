/**
 * Bun-native dashboard server. THIS MODULE IS BUN-ONLY: it calls `Bun.serve`
 * directly (websocket fan-out and static file serving are runtime concerns,
 * deliberately outside the browser-safe surface — `protocol.ts`/`types.ts`
 * stay pure and shared with the client).
 */
import type { Server, ServerWebSocket } from 'bun'
import { VisualizerError } from '../errors.js'
import { describeError } from '../internal/describe-error.js'
import { CANCELLED, cancellableNext, closeIterator, toAsyncIterator } from '../internal/iterate.js'
import { RingBuffer } from '../internal/ring.js'
import { encodeBytesFrame, encodeMatrixFrame } from '../protocol.js'
import type {
  ChannelKind,
  ChannelStatus,
  Dashboard,
  DashboardOptions,
  MatrixFrameInput,
  SeriesSample,
} from '../types.js'
import { clientAssetResponse } from './assets.js'
import {
  type Channel,
  directoryText,
  type Frame,
  matrixMeta,
  rendition,
  seriesEmission,
  sharedFrame,
} from './channel.js'
import { planReplay } from './replay.js'
import {
  MAX_INBOUND_PAYLOAD_BYTES,
  negotiateProtocolVersion,
  resolveServerConfig,
  upgradeRefusal,
} from './security.js'

/**
 * Per-socket buffered-bytes budget. When a client's kernel/user-space queue
 * exceeds this, new binary frames are dropped for that socket instead of
 * queued — the second half of the "slow clients never block producers"
 * guarantee (the ring buffer bounds replay history, this bounds live fan-out
 * and the replay a late joiner is sent).
 */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024
/** Longest wait for one consumed iterator's `return()` during `stop()`. */
const PUMP_CLOSE_GRACE_MS = 150
/** Longest wait for `server.stop(true)` (see the Bun ≤ 1.3 note in `stop`). */
const SERVER_STOP_GRACE_MS = 150
/** Cap on the `error` text published in the directory. */
const MAX_ERROR_TEXT = 300
/** Cap on a channel note. */
const MAX_NOTE_TEXT = 200
/** Note changes are coalesced into at most one directory update per interval. */
const NOTE_BROADCAST_MS = 100

/** What each socket remembers: the protocol version it negotiated. */
interface SocketData {
  readonly version: number
}

interface Pump {
  /** Pre-empts the pump's pending pull; set only while a pull is outstanding. */
  cancel?: () => void
  readonly done: Promise<void>
}

function defaultChannelErrorHandler(channel: string, error: unknown): void {
  console.error(`[@mindpeeker/visualizer] channel '${channel}' failed:`, error)
}

async function bounded(task: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  await Promise.race([task.then(noop, noop), grace])
  clearTimeout(timer)
}

function noop(): void {}

/** Value key of a channel's published labels and range. */
function metaKeyOf(meta: Partial<Channel>): string {
  return JSON.stringify([
    meta.rowLabels ?? null,
    meta.colLabels ?? null,
    meta.range ?? null,
    meta.bandLabels ?? null,
  ])
}

/** The key of a channel without labels or range: no directory update until some arrive. */
const EMPTY_META_KEY = metaKeyOf({})

/**
 * Start a dashboard: `Bun.serve` HTTP + WebSocket on one port. HTTP serves
 * the bundled WebGL2 client (`Cache-Control: no-cache`); `/ws` upgrades to the
 * fan-out socket after the Origin/Host policy check (see
 * `DashboardOptions.allowedOrigins`) and protocol negotiation (`/ws?v=<n>`
 * gets `min(n, PROTOCOL_VERSION)`, no `v` gets 1, a malformed `v` HTTP 400).
 * Every client receives, in order: the channel directory (JSON, for its
 * version), every static document (JSON), then each streaming channel's
 * retained frames, oldest first, in registration order — so a late joiner
 * immediately shows recent history. The replay respects the buffered-amount
 * budget: when the retained history is larger, each channel replays its
 * newest frames that fit (see `planReplay`). The socket is send-only: any
 * inbound message closes it (1003), and inbound messages over 1 KiB are
 * refused by the runtime.
 *
 * Producers attached via `attach*` are pumped in detached background tasks;
 * their frames go into a per-channel drop-oldest {@link RingBuffer} and are
 * fanned out to every open socket whose buffered amount is under budget.
 * Nothing a client does (or fails to do) can slow a producer down. A failing
 * producer marks its channel `error` (with a reason) and is reported through
 * `onChannelError`.
 *
 * @throws {VisualizerError} `aborted` for a pre-aborted signal; `server` for
 *   invalid options or when the runtime cannot bind.
 */
export function createDashboard(opts: DashboardOptions = {}): Dashboard {
  if (opts.signal?.aborted) {
    throw new VisualizerError('aborted', 'dashboard aborted before start')
  }
  const config = resolveServerConfig(opts)
  const onChannelError = opts.onChannelError ?? defaultChannelErrorHandler
  if (typeof onChannelError !== 'function') {
    throw new VisualizerError('server', 'onChannelError must be a function')
  }
  const channels = new Map<string, Channel>()
  const sockets = new Set<ServerWebSocket<SocketData>>()
  const pumps = new Set<Pump>()
  let nextChannelId = 0
  let stopped = false
  let stopping: Promise<void> | undefined
  let noteTimer: ReturnType<typeof setTimeout> | undefined

  const broadcastText = (text: string): void => {
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(text)
    }
  }

  /** Send every socket the directory for its version (each rendering built once). */
  const broadcastDirectory = (): void => {
    if (noteTimer !== undefined) {
      clearTimeout(noteTimer)
      noteTimer = undefined
    }
    const texts = new Map<number, string>()
    for (const ws of sockets) {
      if (ws.readyState !== 1) continue
      const { version } = ws.data
      let text = texts.get(version)
      if (text === undefined) {
        text = directoryText(channels.values(), version)
        texts.set(version, text)
      }
      ws.send(text)
    }
  }

  const broadcastFrame = (frame: Frame): void => {
    for (const ws of sockets) {
      if (ws.readyState !== 1) continue
      if (ws.getBufferedAmount() > MAX_BUFFERED_BYTES) continue // drop, never queue unboundedly
      ws.send(rendition(frame, ws.data.version))
    }
  }

  let server: Server<SocketData>
  try {
    server = Bun.serve<SocketData>({
      port: config.port,
      hostname: config.host,
      async fetch(req, srv) {
        const url = new URL(req.url)
        if (url.pathname === '/ws') {
          const refusal = upgradeRefusal(req, config)
          if (refusal !== undefined) {
            return new Response(`forbidden: ${refusal}`, { status: 403 })
          }
          const version = negotiateProtocolVersion(url)
          if (version === undefined) {
            return new Response('bad protocol version request (expected ?v=<integer ≥ 1>)', {
              status: 400,
            })
          }
          if (srv.upgrade(req, { data: { version } })) return undefined
          return new Response('websocket upgrade required', { status: 400 })
        }
        return (
          (await clientAssetResponse(url.pathname)) ?? new Response('not found', { status: 404 })
        )
      },
      websocket: {
        maxPayloadLength: MAX_INBOUND_PAYLOAD_BYTES,
        open(ws) {
          if (stopped) {
            ws.close(1000, 'dashboard stopped')
            return
          }
          sockets.add(ws)
          try {
            const { version } = ws.data
            ws.send(directoryText(channels.values(), version))
            for (const channel of channels.values()) {
              if (channel.staticText !== undefined) ws.send(channel.staticText)
            }
            const rings = [...channels.values()].map((channel) =>
              channel.ring.snapshot().map((frame) => rendition(frame, version)),
            )
            const budget = MAX_BUFFERED_BYTES - ws.getBufferedAmount()
            for (const frames of planReplay(rings, budget)) {
              for (const frame of frames) ws.send(frame)
            }
          } catch {
            sockets.delete(ws)
            ws.close(1011, 'replay failed')
          }
        },
        message(ws) {
          // The protocol is one-directional; a client that talks is misbehaving.
          ws.close(1003, 'the dashboard socket is send-only')
        },
        close(ws) {
          sockets.delete(ws)
        },
      },
    })
  } catch (cause) {
    throw new VisualizerError(
      'server',
      `failed to start dashboard on ${config.urlHost}:${config.port}`,
      { cause },
    )
  }

  const assertRunning = (name: unknown): void => {
    if (stopped) {
      throw new VisualizerError('server', 'dashboard already stopped', {
        channel: typeof name === 'string' ? name : undefined,
      })
    }
  }

  /** Validate a new channel name without registering anything. */
  const checkName = (name: unknown): string => {
    assertRunning(name)
    if (typeof name !== 'string' || name.length === 0) {
      throw new VisualizerError('invalid_channel', 'channel name must be a non-empty string')
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
    return name
  }

  /** Own an iterator over the producer before registering (throws `invalid_channel`). */
  const openSource = <T>(name: string, src: unknown): AsyncIterator<T> => {
    try {
      const iterator = toAsyncIterator<T>(src)
      if (iterator) return iterator
    } catch (cause) {
      throw new VisualizerError('invalid_channel', `source of '${name}' could not be iterated`, {
        channel: name,
        cause,
      })
    }
    throw new VisualizerError('invalid_channel', `source of '${name}' is not an AsyncIterable`, {
      channel: name,
    })
  }

  const register = (name: string, kind: ChannelKind): Channel => {
    const channel: Channel = {
      id: nextChannelId++,
      name,
      kind,
      status: 'live',
      metaKey: EMPTY_META_KEY,
      ring: new RingBuffer<Frame>(config.ringCapacity),
    }
    channels.set(name, channel)
    return channel
  }

  const setStatus = (channel: Channel, status: ChannelStatus, error?: string): void => {
    if (channel.status === status && channel.error === error) return
    channel.status = status
    channel.error = error
    if (!stopped) broadcastDirectory()
  }

  const fail = (channel: Channel, error: unknown): void => {
    setStatus(channel, 'error', describeError(error, MAX_ERROR_TEXT))
    try {
      onChannelError(channel.name, error)
    } catch (hookError) {
      console.error('[@mindpeeker/visualizer] onChannelError threw:', hookError)
    }
  }

  /** Publish changed metadata (compared by value, so a mutated reused array is seen). */
  const updateMeta = (channel: Channel, meta: Partial<Channel>): void => {
    const metaKey = metaKeyOf(meta)
    if (metaKey === channel.metaKey) return
    channel.metaKey = metaKey
    channel.rowLabels = meta.rowLabels
    channel.colLabels = meta.colLabels
    channel.range = meta.range
    channel.bandLabels = meta.bandLabels
    broadcastDirectory()
  }

  /** Pump one producer; detached so attach* returns immediately. */
  const consume = <T>(
    channel: Channel,
    iterator: AsyncIterator<T>,
    encode: (item: T) => Frame,
  ): void => {
    let finish: () => void = noop
    const pump: Pump = { done: new Promise<void>((resolve) => (finish = resolve)) }
    pumps.add(pump)
    void (async () => {
      // `return()` is owed when we leave early (stop, encoder failure), not
      // after the iterator itself finished or threw — `for await` semantics.
      let owesReturn = true
      try {
        while (!stopped) {
          const pull = cancellableNext(iterator)
          pump.cancel = pull.cancel
          let step: Awaited<typeof pull.result>
          try {
            step = await pull.result
          } catch (error) {
            owesReturn = false
            throw error
          } finally {
            pump.cancel = undefined
          }
          if (step === CANCELLED || stopped) break
          if (step.done) {
            owesReturn = false
            break
          }
          const frame = encode(step.value)
          channel.ring.push(frame)
          broadcastFrame(frame)
        }
        setStatus(channel, 'ended')
      } catch (error) {
        if (stopped) setStatus(channel, 'ended')
        else fail(channel, error)
      } finally {
        if (owesReturn) await closeIterator(iterator, PUMP_CLOSE_GRACE_MS)
        pumps.delete(pump)
        finish()
      }
    })()
  }

  const shutdown = async (): Promise<void> => {
    stopped = true
    if (noteTimer !== undefined) clearTimeout(noteTimer)
    noteTimer = undefined
    opts.signal?.removeEventListener('abort', onAbort)
    const drained = [...pumps].map((pump) => pump.done)
    for (const pump of pumps) pump.cancel?.()
    // Drain: clients get a clean 1000 close before the listener dies.
    for (const ws of sockets) ws.close(1000, 'dashboard stopped')
    // Bun ≤ 1.3 quirk: when websockets were server-closed first, the
    // stop() promise may never settle even though the port is released
    // immediately. Bound the wait so stop() always returns.
    await Promise.all([Promise.all(drained), bounded(server.stop(true), SERVER_STOP_GRACE_MS)])
  }

  const dashboard: Dashboard = {
    url: `http://${config.urlHost}:${server.port}/`,
    port: server.port ?? 0,

    attachByteStream(name, src) {
      const channelName = checkName(name)
      const iterator = openSource<Uint8Array>(channelName, src)
      const channel = register(channelName, 'bytes')
      broadcastDirectory()
      consume(channel, iterator, (bytes) => sharedFrame(encodeBytesFrame(channel.id, bytes)))
    },

    attachSeries(name, src) {
      const channelName = checkName(name)
      const iterator = openSource<SeriesSample>(channelName, src)
      const channel = register(channelName, 'series')
      broadcastDirectory()
      let autoT = 0
      consume(channel, iterator, (sample) => {
        const emission = seriesEmission(channel.id, channel.name, sample, autoT)
        autoT++
        // a sample without bands keeps the last published labels
        if (emission.bandLabels) updateMeta(channel, { bandLabels: emission.bandLabels })
        return emission.frame
      })
    },

    attachMatrix(name, src) {
      const channelName = checkName(name)
      const iterator = openSource<MatrixFrameInput>(channelName, src)
      const channel = register(channelName, 'matrix')
      broadcastDirectory()
      consume(channel, iterator, (frame) => {
        const bytes = encodeMatrixFrame(channel.id, frame)
        updateMeta(channel, matrixMeta(frame, channel.name))
        return sharedFrame(bytes)
      })
    },

    attachStatic(name, json) {
      const channelName = checkName(name)
      let dataText: string | undefined
      try {
        dataText = JSON.stringify(json)
      } catch (cause) {
        throw new VisualizerError(
          'invalid_channel',
          `static document for '${channelName}' is not JSON-serializable`,
          { channel: channelName, cause },
        )
      }
      if (dataText === undefined) {
        throw new VisualizerError(
          'invalid_channel',
          `static document for '${channelName}' serializes to nothing (undefined, function or symbol)`,
          { channel: channelName },
        )
      }
      const channel = register(channelName, 'static')
      // Same key order as JSON.stringify({ type, id, name, data }).
      channel.staticText = `{"type":"static","id":${channel.id},"name":${JSON.stringify(channelName)},"data":${dataText}}`
      broadcastDirectory()
      broadcastText(channel.staticText)
    },

    setNote(name, note) {
      assertRunning(name)
      const channel = typeof name === 'string' ? channels.get(name) : undefined
      if (!channel) {
        throw new VisualizerError('invalid_channel', `no channel named ${JSON.stringify(name)}`)
      }
      if (note !== undefined && typeof note !== 'string') {
        throw new VisualizerError('invalid_channel', 'a channel note must be a string', {
          channel: channel.name,
        })
      }
      const text =
        note !== undefined && note.length > MAX_NOTE_TEXT
          ? `${note.slice(0, MAX_NOTE_TEXT - 1)}…`
          : note
      if (text === channel.note) return
      channel.note = text
      noteTimer ??= setTimeout(() => {
        noteTimer = undefined
        if (!stopped) broadcastDirectory()
      }, NOTE_BROADCAST_MS)
    },

    stop() {
      stopping ??= shutdown()
      return stopping
    },
  }

  const onAbort = (): void => {
    void dashboard.stop()
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  return Object.freeze(dashboard)
}
