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
import {
  encodeBytesFrame,
  encodeMatrixFrame,
  encodeSeriesFrame,
  isValidRange,
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
} from '../types.js'
import { clientAssetResponse } from './assets.js'
import { MAX_INBOUND_PAYLOAD_BYTES, resolveServerConfig, upgradeRefusal } from './security.js'

/**
 * Per-socket buffered-bytes budget. When a client's kernel/user-space queue
 * exceeds this, new binary frames are dropped for that socket instead of
 * queued — the second half of the "slow clients never block producers"
 * guarantee (the ring buffer bounds replay history, this bounds live fan-out).
 */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024
/** Longest wait for one consumed iterator's `return()` during `stop()`. */
const PUMP_CLOSE_GRACE_MS = 150
/** Longest wait for `server.stop(true)` (see the Bun ≤ 1.3 note in `stop`). */
const SERVER_STOP_GRACE_MS = 150
/** Cap on the `error` text published in the directory. */
const MAX_ERROR_TEXT = 300

interface Channel {
  readonly id: number
  readonly name: string
  readonly kind: ChannelKind
  status: ChannelStatus
  error?: string
  rowLabels?: readonly string[]
  colLabels?: readonly string[]
  range?: readonly [number, number]
  /** JSON of the last published labels + range, for change detection. */
  metaKey: string
  readonly ring: RingBuffer<Uint8Array>
  /** Pre-serialized `static` text frame (static channels only). */
  staticText?: string
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

function labelList(value: unknown, field: string, channel: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((label) => typeof label === 'string')) {
    throw new VisualizerError('protocol', `matrix ${field} must be an array of strings`, {
      channel,
    })
  }
  return Object.freeze([...value])
}

/**
 * Start a dashboard: `Bun.serve` HTTP + WebSocket on one port. HTTP serves
 * the bundled WebGL2 client (`Cache-Control: no-cache`); `/ws` upgrades to the
 * fan-out socket after the Origin/Host policy check (see
 * `DashboardOptions.allowedOrigins`). Every client receives, in order: the
 * channel directory (JSON), every static document (JSON), then each streaming
 * channel's retained ring of binary frames, oldest first, in registration
 * order — so a late joiner immediately shows recent history. The socket is
 * send-only: any inbound message closes it (1003), and inbound messages over
 * 1 KiB are refused by the runtime.
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
  const sockets = new Set<ServerWebSocket<undefined>>()
  const pumps = new Set<Pump>()
  let nextChannelId = 0
  let stopped = false
  let stopping: Promise<void> | undefined

  const directoryMessage = (): string => {
    const list: ChannelInfo[] = [...channels.values()].map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      status: c.status,
      ...(c.rowLabels ? { rowLabels: c.rowLabels } : {}),
      ...(c.colLabels ? { colLabels: c.colLabels } : {}),
      ...(c.range ? { range: c.range } : {}),
      ...(c.status === 'error' && c.error !== undefined ? { error: c.error } : {}),
    }))
    const message: DirectoryMessage = {
      type: 'directory',
      version: PROTOCOL_VERSION,
      channels: list,
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
      port: config.port,
      hostname: config.host,
      async fetch(req, srv) {
        const url = new URL(req.url)
        if (url.pathname === '/ws') {
          const refusal = upgradeRefusal(req, config)
          if (refusal !== undefined) {
            return new Response(`forbidden: ${refusal}`, { status: 403 })
          }
          if (srv.upgrade(req)) return undefined
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
            ws.send(directoryMessage())
            for (const channel of channels.values()) {
              if (channel.staticText !== undefined) ws.send(channel.staticText)
            }
            for (const channel of channels.values()) {
              for (const frame of channel.ring.snapshot()) ws.send(frame)
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
      {
        cause,
      },
    )
  }

  /** Validate a new channel name without registering anything. */
  const checkName = (name: unknown): string => {
    if (stopped) {
      throw new VisualizerError('server', 'dashboard already stopped', {
        channel: typeof name === 'string' ? name : undefined,
      })
    }
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
      metaKey: '',
      ring: new RingBuffer(config.ringCapacity),
    }
    channels.set(name, channel)
    return channel
  }

  const setStatus = (channel: Channel, status: ChannelStatus, error?: string): void => {
    if (channel.status === status && channel.error === error) return
    channel.status = status
    channel.error = error
    if (!stopped) broadcastText(directoryMessage())
  }

  const fail = (channel: Channel, error: unknown): void => {
    setStatus(channel, 'error', describeError(error, MAX_ERROR_TEXT))
    try {
      onChannelError(channel.name, error)
    } catch (hookError) {
      console.error('[@mindpeeker/visualizer] onChannelError threw:', hookError)
    }
  }

  /** Pump one producer; detached so attach* returns immediately. */
  const consume = <T>(
    channel: Channel,
    iterator: AsyncIterator<T>,
    encode: (item: T) => Uint8Array,
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
      broadcastText(directoryMessage())
      consume(channel, iterator, (bytes) => encodeBytesFrame(channel.id, bytes))
    },

    attachSeries(name, src) {
      const channelName = checkName(name)
      const iterator = openSource<SeriesSample>(channelName, src)
      const channel = register(channelName, 'series')
      broadcastText(directoryMessage())
      let autoT = 0
      consume(channel, iterator, (sample) => {
        const point =
          typeof sample === 'number'
            ? { t: autoT, value: sample }
            : { t: sample.t ?? autoT, value: sample.value, band: sample.band }
        autoT++
        return encodeSeriesFrame(channel.id, [point])
      })
    },

    attachMatrix(name, src) {
      const channelName = checkName(name)
      const iterator = openSource<MatrixFrameInput>(channelName, src)
      const channel = register(channelName, 'matrix')
      broadcastText(directoryMessage())
      consume(channel, iterator, (frame) => {
        const bytes = encodeMatrixFrame(channel.id, frame)
        const rowLabels = labelList(frame.rowLabels, 'rowLabels', channel.name)
        const colLabels = labelList(frame.colLabels, 'colLabels', channel.name)
        if (frame.range !== undefined && !isValidRange(frame.range)) {
          throw new VisualizerError(
            'protocol',
            'matrix range must be a finite [lo, hi] with lo < hi',
            {
              channel: channel.name,
            },
          )
        }
        const range = frame.range
          ? Object.freeze([frame.range[0], frame.range[1]] as const)
          : undefined
        // Compare copies by value, so a producer mutating one reused label array is still seen.
        const metaKey = JSON.stringify([rowLabels ?? null, colLabels ?? null, range ?? null])
        if (metaKey !== channel.metaKey) {
          channel.metaKey = metaKey
          channel.rowLabels = rowLabels
          channel.colLabels = colLabels
          channel.range = range
          broadcastText(directoryMessage())
        }
        return bytes
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
      broadcastText(directoryMessage())
      broadcastText(channel.staticText)
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
