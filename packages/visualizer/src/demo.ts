/**
 * Demo plumbing behind the `mindpeeker-viz` CLI, importable and side-effect
 * free (the CLI in `cli.ts` is a thin entry that parses `Bun.argv`, calls
 * {@link startDemo} and handles SIGINT). BUN-ONLY: it starts a dashboard and
 * resolves device-backed sources through `sources.ts`.
 *
 * Wiring, one device session fanned out to every panel:
 *
 * - the source's byte stream              → scrolling noise bitmap
 * - `windowedNegentropy` over that noise  → rolling series panel
 * - GCP cumulative deviation
 *   $D(t) = \sum_{s\le t} (Z_s^2 - 1)$ of a live `trialStream`, banded by the
 *   two-sided 90% pointwise $\chi^2$ envelope
 * - decaying byte-value histogram         → 1×32 bar-mode matrix panel
 * - a hardcoded sample rate-card geometry → radial dial panel
 */
import { trialStream, windowedNegentropy } from '@mindpeeker/negentropy'
import { chi2Ppf, KahanSum } from '@mindpeeker/negentropy/numerics'
import { VisualizerError } from './errors.js'
import { describeError } from './internal/describe-error.js'
import { fanOut, paced } from './internal/fan-out.js'
import { createDashboard } from './server/dashboard.js'
import { resolveSource, type SourceOptions, sourceDescriptions } from './sources.js'
import type { Dashboard, MatrixFrameInput, RateCardGeometry, SeriesSample } from './types.js'

/** GCP convention: a trial is the sum of 200 bits, Binomial(200, ½) under H0. */
export const BITS_PER_TRIAL = 200
/** Probability mass in each tail outside the demo envelope (two-sided 90% band). */
export const ENVELOPE_TAIL = 0.05
/** Pause after every source chunk, so the bitmap scrolls legibly (all panels share it). */
export const SOURCE_INTERVAL_MS = 50
/** Bytes per source chunk. */
export const SOURCE_CHUNK_BYTES = 256

export type { FanOutOptions } from './internal/fan-out.js'
export { fanOut, paced }

/** Panel titles; the cumdev title states exactly what the band is. */
export const CHANNEL_LABELS = Object.freeze({
  negentropy: 'windowed negentropy (logcosh)',
  cumdev: 'cumulative deviation · two-sided 90% pointwise χ² envelope',
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
 * Live GCP-style cumulative deviation with its envelope, one point per trial.
 * Every trial the source delivers is used — the pace is the source's own, the
 * generator never sleeps — and `t` is the 1-based trial count.
 *
 * - `value` is $D(t) = \sum_{s \le t}(Z_s^2 - 1)$ with
 *   $Z_s = (S_s - k/2)/\sqrt{k/4}$, $k = 200$, accumulated incrementally with
 *   the Neumaier-compensated `KahanSum` in the same order as negentropy's
 *   batch `cumulativeDeviation` — so every value is bit-identical to the batch
 *   statistic over the trials so far, at $O(1)$ cost per trial.
 * - `band` is the two-sided 90% **pointwise** envelope
 *   $[\chi^2_{0.05}(t) - t,\ \chi^2_{0.95}(t) - t]$ (the de Moivre–Laplace
 *   approximation for Binomial trials, as in negentropy's
 *   `significanceEnvelope`); an $H_0$ path leaves it *somewhere* far more
 *   often than 10%.
 */
export async function* cumdevSeries(
  src: DemoByteSource,
  opts: { readonly signal?: AbortSignal } = {},
): AsyncGenerator<SeriesSample> {
  const accumulator = new KahanSum()
  const sd = Math.sqrt(BITS_PER_TRIAL / 4)
  let t = 0
  const trials = trialStream(src, {
    bitsPerTrial: BITS_PER_TRIAL,
    chunkBytes: 25,
    signal: opts.signal,
  })
  for await (const trial of trials) {
    const z = (trial.sum - BITS_PER_TRIAL / 2) / sd
    accumulator.add(z * z - 1)
    t++
    const lo = chi2Ppf(ENVELOPE_TAIL, t) - t
    const hi = chi2Ppf(1 - ENVELOPE_TAIL, t) - t
    yield { t, value: accumulator.value, band: [lo, hi] }
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

/** What the demo serves and reads. */
export interface DemoOptions {
  readonly port: number
  readonly host: string
  readonly source: string
  readonly sourceOpts: SourceOptions
}

/** Result of {@link parseArgs}: run the demo, or print help / the source list. */
export type DemoCommand =
  | { readonly command: 'run'; readonly options: DemoOptions }
  | { readonly command: 'help' }
  | { readonly command: 'list-sources' }

/** CLI usage text. */
export const USAGE = `usage: mindpeeker-viz [options]

  --source <name>       entropy source (default: crypto); see --list-sources
  --raw                 pass hardware raw samples through, skip SHA-256 conditioning
  --serial-path <path>  serial/esp32 device (default: /dev/cu.usbserial-110 or /dev/ttyUSB0)
  --baud <n>            serial baud rate, a positive integer (default: 921600)
  --camera-device <id>  ffmpeg camera device (default: '0' macOS / '/dev/video0' Linux)
  --mic-device <spec>   ffmpeg audio device (default: ':0' macOS / 'default' Linux)
  --hwrng-path <path>   kernel hwrng device (default: /dev/hwrng)
  --port <n>            HTTP/WS port, 0-65535 (default: 0 = ephemeral)
  --host <h>            bind host (default: localhost)
  --list-sources        print the available entropy sources and exit
  -h, --help            print this help and exit`

function optionsError(message: string): VisualizerError {
  return new VisualizerError('invalid_options', message)
}

/** Strict unsigned decimal: rejects '', '1e3', '0x10', '-1', '8080abc', ' 80'. */
function parseDecimal(flag: string, raw: string, expected: string): number {
  if (!/^\d+$/.test(raw)) throw optionsError(`${flag} must be ${expected}, got '${raw}'`)
  return Number(raw)
}

/**
 * Parse CLI arguments (without the executable and script). Pure: never
 * prints, never exits. `--help`/`-h` and `--list-sources` return at once.
 *
 * @throws {VisualizerError} `invalid_options` for an unknown flag, a flag
 *   without a value (a following `--flag` does not count as a value), an empty
 *   value, `--port` outside $[0, 65535]$ or `--baud` that is not an integer ≥ 1
 *   (both strictly decimal).
 */
export function parseArgs(argv: readonly string[]): DemoCommand {
  let port = 0
  let host = 'localhost'
  let source = 'crypto'
  const sourceOpts: SourceOptions = {}
  let i = 0
  const value = (flag: string): string => {
    const v = argv[++i]
    if (v === undefined || v.startsWith('--')) throw optionsError(`missing value for ${flag}`)
    if (v.length === 0) throw optionsError(`empty value for ${flag}`)
    return v
  }
  for (; i < argv.length; i++) {
    const arg = argv[i] as string
    switch (arg) {
      case '--help':
      case '-h':
        return { command: 'help' }
      case '--list-sources':
        return { command: 'list-sources' }
      case '--port':
        port = parseDecimal('--port', value(arg), 'an integer in [0, 65535]')
        if (port > 65_535) throw optionsError(`--port must be in [0, 65535], got ${port}`)
        break
      case '--baud': {
        const baud = parseDecimal('--baud', value(arg), 'a positive integer')
        if (!(Number.isSafeInteger(baud) && baud >= 1)) {
          throw optionsError(`--baud must be a positive integer, got ${baud}`)
        }
        sourceOpts.baudRate = baud
        break
      }
      case '--host':
        host = value(arg)
        break
      case '--source':
        source = value(arg)
        break
      case '--raw':
        sourceOpts.raw = true
        break
      case '--serial-path':
        sourceOpts.serialPath = value(arg)
        break
      case '--camera-device':
        sourceOpts.cameraDevice = value(arg)
        break
      case '--mic-device':
        sourceOpts.micDevice = value(arg)
        break
      case '--hwrng-path':
        sourceOpts.hwrngPath = value(arg)
        break
      default:
        throw optionsError(`unknown argument: ${arg}`)
    }
  }
  return { command: 'run', options: { port, host, source, sourceOpts } }
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

/** A running demo. */
export interface DemoSession {
  readonly dashboard: Dashboard
  readonly providerName: string
  /** One-line note on what the source needs (hardware, ffmpeg, root, …). */
  readonly note: string
  /** Abort every stream and stop the dashboard; idempotent. */
  stop(): Promise<void>
}

/**
 * Resolve the source, start a dashboard and attach the five demo channels.
 * Nothing touches the device until the first frame is pulled.
 *
 * @throws {VisualizerError} `invalid_options` for an unknown source or bad
 *   source options; `server` / `aborted` from `createDashboard`.
 */
export function startDemo(
  options: DemoOptions,
  runtime: {
    readonly signal?: AbortSignal
    readonly onChannelError?: (channel: string, error: unknown) => void
  } = {},
): DemoSession {
  const { provider, note } = resolveSource(options.source, options.sourceOpts)
  if (runtime.signal?.aborted) throw new VisualizerError('aborted', 'demo aborted before start')
  const controller = new AbortController()
  const dashboard = createDashboard({
    port: options.port,
    host: options.host,
    signal: controller.signal,
    ...(runtime.onChannelError ? { onChannelError: runtime.onChannelError } : {}),
  })
  const signal = controller.signal
  const forwardAbort = (): void => controller.abort()
  runtime.signal?.addEventListener('abort', forwardAbort, { once: true })

  // One device session, fanned out to every panel — a single camera or serial
  // port is opened exactly once (opening it per panel would conflict).
  const streams = fanOut(
    paced(provider.stream({ chunkBytes: SOURCE_CHUNK_BYTES, signal }), SOURCE_INTERVAL_MS, signal),
    4,
    { signal },
  ) as [
    AsyncIterableIterator<Uint8Array>,
    AsyncIterableIterator<Uint8Array>,
    AsyncIterableIterator<Uint8Array>,
    AsyncIterableIterator<Uint8Array>,
  ]
  const [bitmapBytes, negentropyBytes, trialBytes, histogramBytes] = streams

  dashboard.attachByteStream(`${provider.name} noise`, bitmapBytes)
  dashboard.attachSeries(CHANNEL_LABELS.negentropy, negentropySeries(negentropyBytes, signal))
  dashboard.attachSeries(
    CHANNEL_LABELS.cumdev,
    cumdevSeries({ name: provider.name, stream: () => trialBytes }, { signal }),
  )
  dashboard.attachMatrix(CHANNEL_LABELS.histogram, histogramMatrix(histogramBytes))
  dashboard.attachStatic(CHANNEL_LABELS.rateCard, SAMPLE_RATE_CARD)

  let stopping: Promise<void> | undefined
  return Object.freeze({
    dashboard,
    providerName: provider.name,
    note,
    stop() {
      stopping ??= (async () => {
        runtime.signal?.removeEventListener('abort', forwardAbort)
        controller.abort()
        await dashboard.stop()
      })()
      return stopping
    },
  })
}
