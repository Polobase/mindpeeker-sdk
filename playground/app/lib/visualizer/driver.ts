/**
 * The `mindpeeker-viz` demo wiring, run entirely in the browser.
 *
 * The CLI (`src/demo.ts`) fans one device session out to six channels, encodes
 * every emission with `src/protocol.ts` and ships the frames over a WebSocket
 * that `createDashboard` (Bun-only) serves. Here the same producers run in the
 * page, the same encoders produce the same bytes, and `decodeFrame` hands the
 * frames straight to the bundled WebGL2 client through `mountDashboard` — so
 * the panels see byte-identical wire frames with the socket left out.
 *
 * What is shared verbatim with the CLI: `NetvarMonitor` / `cumdevSample` /
 * `netvarSample` / `anytimeNote` (`@viz/src/demo/monitor`, pure), every
 * `encode*` / `decodeFrame` (`@viz/src/protocol`), `windowedNegentropy`
 * (window 512, hop 128) and psi's `recordSession` (schema v2, `chain: true`,
 * 200-bit trials). What is re-stated here: the histogram decay and the byte
 * pump, because `src/demo.ts` imports `node:fs`.
 *
 * CLIENT-ONLY: imports `@mindpeeker/*` and `@viz/*`.
 */
import { DEFAULT_BITS_PER_TRIAL, windowedNegentropy } from '@mindpeeker/negentropy'
import { parseRecordLine, recordSession } from '@mindpeeker/psi'
import type { DashboardHandle } from '@viz/client/mount'
import {
  anytimeNote,
  cumdevSample,
  type MonitorPoint,
  NetvarMonitor,
  netvarSample,
} from '@viz/src/demo/monitor'
import {
  decodeFrame,
  encodeBytesFrame,
  encodeMatrixFrame,
  encodeSeriesFrame,
  FRAME_KIND,
} from '@viz/src/protocol'
import type { SeriesPoint, SeriesSample } from '@viz/src/types'
import { isAbortError } from '~/lib/errors'
import {
  CHANNEL,
  CHANNEL_LABELS,
  HISTOGRAM_BINS,
  HISTOGRAM_DECAY,
  NEGENTROPY_HOP,
  NEGENTROPY_WINDOW,
} from './channels'
import type { Feed } from './feed'
import { pushable } from './pushable'

/** GCP convention: a trial is the sum of 200 bits (psi/negentropy's default). */
export const BITS_PER_TRIAL = DEFAULT_BITS_PER_TRIAL
/** Bytes per trial pull — 200 bits. */
const TRIAL_CHUNK_BYTES = BITS_PER_TRIAL / 8
/** Chain lines retained for the recording panel (a prefix is itself a valid chain). */
const RETAINED_LINES = 400
/** The netvar note is rewritten at most this often, like the server's 100 ms coalescing. */
const NOTE_INTERVAL_MS = 250

/** Frame accounting per channel, as it goes onto the wire. */
export interface WireStat {
  /** The `u16` in the frame header. */
  readonly channelId: number
  readonly channel: string
  /** Frame kind byte: 1 bytes, 2 series, 3 matrix, 4 multi-band series. */
  readonly kindByte: number
  readonly kindName: string
  /** First byte of the frame — the layout version of that kind (1, or 2 for kind 4). */
  readonly layoutVersion: number
  readonly lastBytes: number
  readonly frames: number
  readonly totalBytes: number
}

/** Everything the UI reads out of a running driver, sampled on a timer. */
export interface DriverSnapshot {
  readonly running: boolean
  readonly paused: boolean
  readonly chunks: number
  readonly bytes: number
  readonly trials: number
  readonly elapsedMs: number
  readonly point: MonitorPoint | undefined
  readonly negentropy: { readonly startSample: number; readonly j: number } | undefined
  readonly wire: readonly WireStat[]
  readonly droppedChunks: number
  readonly lines: readonly string[]
  readonly totalLines: number
  readonly error: unknown
}

export interface DriverOptions {
  readonly handle: DashboardHandle
  readonly feed: Feed
  readonly chunkBytes: number
  readonly intervalMs: number
  /** The anytime-p caption of the netvar channel changed. */
  readonly onNote: (text: string) => void
  /** A producer failed: the channel badges should turn `error` with this reason. */
  readonly onError: (error: unknown) => void
  /** The source ended on its own (a finite stream). */
  readonly onEnd?: () => void
}

export interface Driver {
  start(): void
  pause(): void
  resume(): void
  setIntervalMs(ms: number): void
  snapshot(): DriverSnapshot
  stop(): Promise<void>
}

const KIND_NAMES: Record<number, string> = {
  [FRAME_KIND.bytes]: 'bytes',
  [FRAME_KIND.series]: 'series',
  [FRAME_KIND.matrix]: 'matrix',
  [FRAME_KIND.bands]: 'bands',
}

/** A `SeriesSample` as the server would store it: `t` filled in, bands kept. */
export function toPoint(sample: SeriesSample): SeriesPoint {
  if (typeof sample === 'number') return { t: 0, value: sample }
  return {
    t: sample.t ?? 0,
    value: sample.value,
    ...(sample.bands ? { bands: sample.bands } : {}),
    ...(sample.band ? { band: sample.band } : {}),
  }
}

/** A sleep that resolves immediately when the run is aborted. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Wire the six demo channels to a mounted dashboard and pump `feed` into them.
 * Every consumer is bounded: a slow one drops the oldest chunk rather than
 * queueing without limit, and the drop count is reported.
 */
export function createDriver(opts: DriverOptions): Driver {
  const controller = new AbortController()
  const { signal } = controller
  const monitor = new NetvarMonitor(BITS_PER_TRIAL)
  const bins = new Float32Array(HISTOGRAM_BINS)
  const wire = new Map<number, { -readonly [K in keyof WireStat]: WireStat[K] }>()
  const negQueue = pushable<Uint8Array>(24)
  const trialQueue = pushable<Uint8Array>(48)
  const lines: string[] = []

  let intervalMs = opts.intervalMs
  let running = false
  let paused = false
  let waiters: (() => void)[] = []
  let started = 0
  let chunks = 0
  let bytes = 0
  let trials = 0
  let totalLines = 0
  let point: MonitorPoint | undefined
  let negentropy: { startSample: number; j: number } | undefined
  let error: unknown
  let lastNote = ''
  let noteAt = 0
  let tasks: Promise<void>[] = []

  const release = (): void => {
    const pending = waiters
    waiters = []
    for (const resume of pending) resume()
  }
  signal.addEventListener('abort', release, { once: true })

  const gate = async (): Promise<void> => {
    while (paused && !signal.aborted) {
      await new Promise<void>((resolve) => waiters.push(resolve))
    }
  }

  const fail = (cause: unknown): void => {
    if (signal.aborted || isAbortError(cause)) return
    error ??= cause
    opts.onError(cause)
    controller.abort()
  }

  /** Encode → account → decode → route, the path a frame takes through the socket. */
  const send = (channelId: number, channel: string, frame: Uint8Array): void => {
    const kindByte = frame[1] ?? 0
    const stat = wire.get(channelId) ?? {
      channelId,
      channel,
      kindByte,
      kindName: KIND_NAMES[kindByte] ?? `kind ${kindByte}`,
      layoutVersion: frame[0] ?? 0,
      lastBytes: 0,
      frames: 0,
      totalBytes: 0,
    }
    stat.kindByte = kindByte
    stat.kindName = KIND_NAMES[kindByte] ?? `kind ${kindByte}`
    stat.layoutVersion = frame[0] ?? 0
    stat.lastBytes = frame.byteLength
    stat.frames++
    stat.totalBytes += frame.byteLength
    wire.set(channelId, stat)
    opts.handle.pushFrame(decodeFrame(frame))
  }

  /** `windowedNegentropy` over the byte queue — the CLI's `negentropySeries`. */
  const runNegentropy = async (): Promise<void> => {
    try {
      const points = windowedNegentropy(negQueue, {
        windowSize: NEGENTROPY_WINDOW,
        hopSize: NEGENTROPY_HOP,
        signal,
      })
      for await (const p of points) {
        negentropy = { startSample: p.startSample, j: p.j }
        send(
          CHANNEL.negentropy,
          CHANNEL_LABELS.negentropy,
          encodeSeriesFrame(CHANNEL.negentropy, [{ t: p.startSample, value: p.j }]),
        )
      }
    } catch (cause) {
      fail(cause)
    }
  }

  /**
   * Trials as hash-chained psi JSONL v2 lines, then the CLI's Stouffer path:
   * `z = (sum − k/2)/√(k/4)` per line, one source, so the round's Stouffer Z
   * is that z — exactly what `--record` writes and `--replay` reads back.
   */
  const runTrials = async (): Promise<void> => {
    try {
      const source = { name: opts.feed.providerName, stream: () => trialQueue }
      const session = recordSession([source], {
        bitsPerTrial: BITS_PER_TRIAL,
        chunkBytes: TRIAL_CHUNK_BYTES,
        chain: true,
        signal,
      })
      for await (const line of session) {
        totalLines++
        if (lines.length < RETAINED_LINES) lines.push(line)
        const record = parseRecordLine(line, totalLines)
        if (record.v !== 2 || 'kind' in record) continue
        const k = record.bitsPerTrial
        const next = monitor.add((record.sum - k / 2) / Math.sqrt(k / 4))
        point = next
        trials = next.t
        send(
          CHANNEL.cumdev,
          CHANNEL_LABELS.cumdev,
          encodeSeriesFrame(CHANNEL.cumdev, [toPoint(cumdevSample(next))]),
        )
        send(
          CHANNEL.netvar,
          CHANNEL_LABELS.netvar,
          encodeSeriesFrame(CHANNEL.netvar, [toPoint(netvarSample(next))]),
        )
        const note = anytimeNote(next)
        const now = performance.now()
        if (note !== lastNote && now - noteAt >= NOTE_INTERVAL_MS) {
          lastNote = note
          noteAt = now
          opts.onNote(note)
        }
      }
    } catch (cause) {
      fail(cause)
    }
  }

  /** One paced pull from the feed, fanned out to the four byte consumers. */
  const runPump = async (): Promise<void> => {
    const iterator = opts.feed.stream({ chunkBytes: opts.chunkBytes, signal })[
      Symbol.asyncIterator
    ]()
    try {
      for (;;) {
        await gate()
        if (signal.aborted) return
        const next = await iterator.next()
        if (next.done) {
          opts.onEnd?.()
          return
        }
        const chunk = next.value
        if (chunk.length === 0) continue
        chunks++
        bytes += chunk.length
        send(CHANNEL.noise, `${opts.feed.label} noise`, encodeBytesFrame(CHANNEL.noise, chunk))
        negQueue.push(chunk)
        trialQueue.push(chunk)
        for (let i = 0; i < bins.length; i++) bins[i] = (bins[i] ?? 0) * HISTOGRAM_DECAY
        for (const byte of chunk) bins[byte >> 3] = (bins[byte >> 3] ?? 0) + 1
        send(
          CHANNEL.histogram,
          CHANNEL_LABELS.histogram,
          encodeMatrixFrame(CHANNEL.histogram, {
            rows: 1,
            cols: HISTOGRAM_BINS,
            data: bins.slice(),
          }),
        )
        await sleep(intervalMs, signal)
      }
    } catch (cause) {
      fail(cause)
    } finally {
      // the pump owns the queues: closing them lets both consumers finish
      running = false
      negQueue.close()
      trialQueue.close()
      await iterator.return?.().catch(() => undefined)
    }
  }

  return {
    start(): void {
      if (running) return
      running = true
      started = performance.now()
      tasks = [runNegentropy(), runTrials(), runPump()]
    },
    pause(): void {
      paused = true
    },
    resume(): void {
      paused = false
      release()
    },
    setIntervalMs(ms: number): void {
      intervalMs = ms
    },
    snapshot(): DriverSnapshot {
      return {
        running: running && !signal.aborted,
        paused,
        chunks,
        bytes,
        trials,
        elapsedMs: running ? performance.now() - started : 0,
        point,
        negentropy,
        wire: [...wire.values()]
          .map((stat) => ({ ...stat }))
          .sort((a, b) => a.channelId - b.channelId),
        droppedChunks: negQueue.dropped + trialQueue.dropped,
        lines,
        totalLines,
        error,
      }
    },
    async stop(): Promise<void> {
      paused = false
      controller.abort()
      release()
      negQueue.close()
      trialQueue.close()
      running = false
      await Promise.allSettled(tasks)
      tasks = []
    },
  }
}
