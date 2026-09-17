/**
 * Demo plumbing behind the `mindpeeker-viz` CLI, importable and side-effect
 * free (the CLI in `cli.ts` is a thin entry that parses `Bun.argv`, calls
 * {@link startDemo} / {@link startReplay} and handles SIGINT). BUN-ONLY: it
 * starts a dashboard, resolves device-backed sources through `sources.ts` and
 * reads/writes recordings with `node:fs`.
 *
 * Live wiring, one device session fanned out to every panel:
 *
 * - the source's byte stream              → scrolling noise bitmap (health note)
 * - `windowedNegentropy` over that noise  → rolling series panel
 * - 200-bit trials as hash-chained psi JSONL v2 lines (written to disk with
 *   `--record`) → per-round Stouffer Z → {@link NetvarMonitor}:
 *   - cumulative deviation $D(t)$ with the two-sided 90% pointwise $\chi^2$
 *     band and the anytime-valid (α = 0.05) boundary
 *   - running netvar Z with the anytime-valid p in its caption
 * - decaying byte-value histogram         → 1×32 bar-mode matrix panel
 * - a hardcoded sample rate-card geometry → radial dial panel
 *
 * `--replay` verifies a recording's hash chain and drives the two trial
 * channels from its lines through the same Stouffer/monitor path.
 */
import { basename } from 'node:path'
import { windowedNegentropy } from '@mindpeeker/negentropy'
import type { DemoOptions, ReplayOptions } from './demo/args.js'
import { type HealthEvent, healthMonitored, healthNote } from './demo/health.js'
import {
  anytimeNote,
  cumdevSample,
  type MonitorPoint,
  monitorPoints,
  netvarSample,
} from './demo/monitor.js'
import {
  BITS_PER_TRIAL,
  createRecorder,
  liveTrialLines,
  pacedRounds,
  type Recorder,
  readRecording,
  roundZs,
  stoufferRounds,
  tapLines,
  type VerifiedRecording,
} from './demo/recording.js'
import { VisualizerError } from './errors.js'
import { describeError } from './internal/describe-error.js'
import { fanOut, paced } from './internal/fan-out.js'
import { createDashboard } from './server/dashboard.js'
import { resolveSource, sourceDescriptions } from './sources.js'
import type { Dashboard, MatrixFrameInput, RateCardGeometry, SeriesSample } from './types.js'

export type { DemoCommand, DemoOptions, ReplayOptions } from './demo/args.js'
export { parseArgs, USAGE } from './demo/args.js'
export type { HealthEvent } from './demo/health.js'
export type { MonitorPoint } from './demo/monitor.js'
export { BAND_LABELS, NetvarMonitor } from './demo/monitor.js'
export type { VerifiedRecording } from './demo/recording.js'
export { BITS_PER_TRIAL } from './demo/recording.js'
export type { FanOutOptions } from './internal/fan-out.js'
export { fanOut, paced }

/** Pause after every source chunk, so the bitmap scrolls legibly (all panels share it). */
export const SOURCE_INTERVAL_MS = 50
/** Bytes per source chunk. */
export const SOURCE_CHUNK_BYTES = 256

/** Panel titles; the band legends state exactly what each envelope is. */
export const CHANNEL_LABELS = Object.freeze({
  negentropy: 'windowed negentropy (logcosh)',
  cumdev: 'cumulative deviation · pointwise χ² band and anytime-valid boundary',
  netvar: 'running netvar Z of the Stouffer Z series',
  histogram: 'byte histogram',
  rateCard: 'rate card',
})

/**
 * Sample rate-card geometry (Malcolm Rae style base-44 layout). Hardcoded on
 * purpose: the dial panel consumes plain JSON, so the demo must not import
 * `@mindpeeker/rate` — any producer can publish this shape via `attachStatic`.
 */
export const SAMPLE_RATE_CARD: RateCardGeometry = Object.freeze({
  type: 'rate-card',
  sectors: 44,
  rings: Object.freeze([0.3, 0.5, 0.7, 0.9]) as readonly number[],
  pointerSector: 17,
  label: 'sample base-44 rate card',
})

/** Map `windowedNegentropy` emissions (window 512, hop 128) to series samples. */
export async function* negentropySeries(
  bytes: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SeriesSample> {
  const points = windowedNegentropy(bytes, { windowSize: 512, hopSize: 128, signal })
  for await (const point of points) {
    yield { t: point.startSample, value: point.j }
  }
}

/** A byte source in the `{ name, stream(opts?) }` shape `trialStream` consumes. */
export interface DemoByteSource {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}

/**
 * Live trial statistics, one point per 200-bit trial: the source's trials as
 * hash-chained schema-v2 lines (persisted first when a `recorder` is given),
 * then the same Stouffer-round → {@link NetvarMonitor} path a replay takes.
 * Every trial the source delivers is used, at the source's own pace.
 */
export function liveMonitorPoints(
  src: DemoByteSource,
  opts: {
    readonly signal?: AbortSignal
    readonly recorder?: Recorder
    readonly now?: () => number
  } = {},
): AsyncGenerator<MonitorPoint> {
  const lines = liveTrialLines(src, opts)
  const persisted = opts.recorder ? tapLines(lines, opts.recorder) : lines
  return monitorPoints(roundZs(stoufferRounds(persisted, 'live trials')), BITS_PER_TRIAL)
}

/**
 * Replayed trial statistics of a verified recording: its rounds (paced by the
 * recorded timestamps unless `pace` is false) → Stouffer Z → monitor, with
 * $n$ = sources × bits per trial fair bits per step.
 */
export function replayMonitorPoints(
  recording: VerifiedRecording,
  opts: { readonly signal?: AbortSignal; readonly pace?: boolean } = {},
): AsyncGenerator<MonitorPoint> {
  const rounds = stoufferRounds(recording.lines, recording.name)
  const timed = opts.pace === false ? rounds : pacedRounds(rounds, opts)
  return monitorPoints(roundZs(timed), recording.sources.length * recording.bitsPerTrial)
}

/** Cumulative-deviation samples: pointwise χ² band plus the anytime-valid boundary. */
export async function* cumdevSeries(
  points: AsyncIterable<MonitorPoint>,
): AsyncGenerator<SeriesSample> {
  for await (const point of points) yield cumdevSample(point)
}

/** Netvar Z samples; `onNote` receives the anytime-p caption whenever its text changes. */
export async function* netvarSeries(
  points: AsyncIterable<MonitorPoint>,
  onNote: (text: string) => void = () => {},
): AsyncGenerator<SeriesSample> {
  let last: string | undefined
  for await (const point of points) {
    const text = anytimeNote(point)
    if (text !== last) {
      last = text
      onNote(text)
    }
    yield netvarSample(point)
  }
}

/**
 * Exponentially decaying byte-value histogram: 32 bins of width 8, every bin
 * multiplied by 0.9 per chunk before the chunk's bytes are counted — one frame
 * per chunk. For uniform 256-byte chunks the steady state per bin has mean 80
 * and standard deviation ≈ 6.4.
 */
export async function* histogramMatrix(
  bytes: AsyncIterable<Uint8Array>,
): AsyncGenerator<MatrixFrameInput> {
  const bins = new Float32Array(32)
  const labels = Object.freeze([...bins.keys()].map((i) => `${i * 8}`))
  for await (const chunk of bytes) {
    for (let i = 0; i < bins.length; i++) bins[i] = (bins[i] as number) * 0.9
    for (const byte of chunk) bins[byte >> 3] = (bins[byte >> 3] as number) + 1
    yield { rows: 1, cols: 32, data: bins.slice(), colLabels: labels }
  }
}

/** The `--list-sources` text. */
export function sourceListing(): string {
  const lines = sourceDescriptions().map(({ name, describe }) => `  ${name.padEnd(8)} ${describe}`)
  return ['available entropy sources:', ...lines].join('\n')
}

/**
 * An `onChannelError` handler that writes one line per failure with the full
 * cause chain. The demo's panels share one device session, so a device
 * failure hits every streaming channel with the same reason: repeats are
 * shortened to `(same reason)`.
 */
export function createErrorReporter(
  write: (line: string) => void,
): (channel: string, error: unknown) => void {
  const seen = new Set<string>()
  return (channel, error) => {
    const reason = describeError(error, 1000)
    if (seen.has(reason)) {
      write(`channel '${channel}' failed (same reason)`)
      return
    }
    seen.add(reason)
    write(`channel '${channel}' failed: ${reason}`)
  }
}

/** A running demo (live or replay). */
export interface DemoSession {
  readonly dashboard: Dashboard
  /** The live provider's name, or `replay`. */
  readonly providerName: string
  /** One-line note on what the source needs, or what is being replayed. */
  readonly note: string
  /** Abort every stream, stop the dashboard and close a recording; idempotent. */
  stop(): Promise<void>
}

/** Runtime hooks shared by {@link startDemo} and {@link startReplay}. */
export interface DemoRuntime {
  readonly signal?: AbortSignal
  readonly onChannelError?: (channel: string, error: unknown) => void
  /** Called for each health-test failure of a health-tested live source. */
  readonly onHealthEvent?: (event: HealthEvent) => void
  /** Trial timestamp clock for live recordings (tests). Default `Date.now`. */
  readonly now?: () => number
  /** Replay at the recorded pace (default) or as fast as the panels pull. */
  readonly pace?: boolean
}

/** A note on a channel that may already be gone because the demo stopped. */
function noteQuietly(dashboard: Dashboard, channel: string, text: string): void {
  try {
    dashboard.setNote(channel, text)
  } catch {
    // stopped: nothing left to annotate
  }
}

/** Fan monitor points out to the cumulative-deviation and netvar channels. */
function attachTrialChannels(
  dashboard: Dashboard,
  points: AsyncIterable<MonitorPoint>,
  signal: AbortSignal,
): void {
  const [cumdevPoints, netvarPoints] = fanOut(points, 2, { signal }) as [
    AsyncIterableIterator<MonitorPoint>,
    AsyncIterableIterator<MonitorPoint>,
  ]
  dashboard.attachSeries(CHANNEL_LABELS.cumdev, cumdevSeries(cumdevPoints))
  dashboard.attachSeries(
    CHANNEL_LABELS.netvar,
    netvarSeries(netvarPoints, (text) => noteQuietly(dashboard, CHANNEL_LABELS.netvar, text)),
  )
}

function abortedBeforeStart(): VisualizerError {
  return new VisualizerError('aborted', 'demo aborted before start')
}

/** Start a dashboard whose lifetime follows `runtime.signal` and a private controller. */
function openDashboard(
  options: { readonly port: number; readonly host: string },
  runtime: DemoRuntime,
): { dashboard: Dashboard; controller: AbortController; detach: () => void } {
  if (runtime.signal?.aborted) throw abortedBeforeStart()
  const controller = new AbortController()
  const dashboard = createDashboard({
    port: options.port,
    host: options.host,
    signal: controller.signal,
    ...(runtime.onChannelError ? { onChannelError: runtime.onChannelError } : {}),
  })
  const forwardAbort = (): void => controller.abort()
  runtime.signal?.addEventListener('abort', forwardAbort, { once: true })
  return {
    dashboard,
    controller,
    detach: () => runtime.signal?.removeEventListener('abort', forwardAbort),
  }
}

function session(
  opened: ReturnType<typeof openDashboard>,
  fields: { readonly providerName: string; readonly note: string },
  recorder?: Recorder,
): DemoSession {
  let stopping: Promise<void> | undefined
  return Object.freeze({
    dashboard: opened.dashboard,
    ...fields,
    stop() {
      stopping ??= (async () => {
        opened.detach()
        opened.controller.abort()
        await opened.dashboard.stop()
        await recorder?.close()
      })()
      return stopping
    },
  })
}

/**
 * Resolve the source, start a dashboard and attach the six demo channels.
 * Nothing touches the device until the first frame is pulled. With
 * `options.record`, the recording file is created (never overwritten) before
 * any trial flows.
 *
 * @throws {VisualizerError} `invalid_options` for an unknown source, bad
 *   source options, or a `--record` file that exists or cannot be created;
 *   `server` / `aborted` from `createDashboard`.
 */
export async function startDemo(
  options: DemoOptions,
  runtime: DemoRuntime = {},
): Promise<DemoSession> {
  const { provider, note, healthTested } = resolveSource(options.source, options.sourceOpts)
  const opened = openDashboard(options, runtime)
  const { dashboard, controller } = opened
  let recorder: Recorder | undefined
  if (options.record !== undefined) {
    try {
      recorder = await createRecorder(options.record)
    } catch (error) {
      opened.detach()
      await dashboard.stop()
      throw error
    }
  }
  const signal = controller.signal
  if (signal.aborted) {
    await session(opened, { providerName: provider.name, note }, recorder).stop()
    throw abortedBeforeStart()
  }
  const noiseChannel = `${provider.name} noise`
  const source = healthTested
    ? healthMonitored(provider, (event) => {
        noteQuietly(dashboard, noiseChannel, healthNote(event))
        runtime.onHealthEvent?.(event)
      })
    : provider

  // One device session, fanned out to every panel — a single camera or serial
  // port is opened exactly once (opening it per panel would conflict).
  const streams = fanOut(
    paced(source.stream({ chunkBytes: SOURCE_CHUNK_BYTES, signal }), SOURCE_INTERVAL_MS, signal),
    4,
    { signal },
  ) as [
    AsyncIterableIterator<Uint8Array>,
    AsyncIterableIterator<Uint8Array>,
    AsyncIterableIterator<Uint8Array>,
    AsyncIterableIterator<Uint8Array>,
  ]
  const [bitmapBytes, negentropyBytes, trialBytes, histogramBytes] = streams

  dashboard.attachByteStream(noiseChannel, bitmapBytes)
  if (healthTested) dashboard.setNote(noiseChannel, healthNote())
  dashboard.attachSeries(CHANNEL_LABELS.negentropy, negentropySeries(negentropyBytes, signal))
  const trials = liveMonitorPoints(
    { name: provider.name, stream: () => trialBytes },
    { signal, ...(recorder && { recorder }), ...(runtime.now && { now: runtime.now }) },
  )
  attachTrialChannels(dashboard, trials, signal)
  if (recorder) dashboard.setNote(CHANNEL_LABELS.cumdev, `recording → ${basename(recorder.path)}`)
  dashboard.attachMatrix(CHANNEL_LABELS.histogram, histogramMatrix(histogramBytes))
  dashboard.attachStatic(CHANNEL_LABELS.rateCard, SAMPLE_RATE_CARD)
  return session(opened, { providerName: provider.name, note }, recorder)
}

/**
 * Verify a recording's hash chain, then start a dashboard whose two trial
 * channels (cumulative deviation with both envelopes, netvar Z with the
 * anytime p) are driven by it. Byte-level panels need raw bytes, which a
 * trial recording does not hold, so they are absent.
 *
 * @throws {VisualizerError} `invalid_options` for an unreadable file or a
 *   broken chain (nothing is served then); `server` / `aborted` from
 *   `createDashboard`.
 */
export async function startReplay(
  options: ReplayOptions,
  runtime: DemoRuntime = {},
): Promise<DemoSession> {
  const recording = await readRecording(options.replay)
  const opened = openDashboard(options, runtime)
  const { dashboard, controller } = opened
  const signal = controller.signal
  const pace = runtime.pace ?? true
  attachTrialChannels(dashboard, replayMonitorPoints(recording, { signal, pace }), signal)
  dashboard.setNote(
    CHANNEL_LABELS.cumdev,
    `replay of ${recording.name} · chain ok · head ${recording.head.slice(0, 12)}…`,
  )
  const note = `${recording.name}: ${recording.trials} trials from ${recording.sources.join(', ')} (${recording.bitsPerTrial} bits each), hash chain verified, head ${recording.head}`
  return session(opened, { providerName: 'replay', note })
}
