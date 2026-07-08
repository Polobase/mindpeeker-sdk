#!/usr/bin/env bun
/**
 * `mindpeeker-viz` — demo dashboard wiring a live entropy source to every panel:
 *
 * - the source's byte stream             → scrolling noise bitmap
 * - `windowedNegentropy` over that noise → rolling series panel
 * - GCP cumulative deviation
 *   $D(t) = \sum_{s\le t} (Z_s^2 - 1)$ of a live `trialStream`, with the
 *   pointwise $\chi^2$-quantile `significanceEnvelope` as its band
 * - decaying byte-value histogram        → 1×N bar-mode matrix panel
 * - a hardcoded sample rate-card geometry → radial dial panel
 *
 * The source is selectable with `--source` (crypto, jitter, esp32/serial,
 * camera, mic, hwrng — see `--list-sources`). A single device session feeds
 * all panels via {@link fanOut}, so one camera or serial port is opened once.
 *
 * Prints the URL; never auto-opens a browser. Bun-only.
 */
import {
  cumulativeDeviation,
  significanceEnvelope,
  trialStream,
  windowedNegentropy,
} from '@mindpeeker/negentropy'
import { createDashboard } from './server/dashboard.js'
import { resolveSource, type SourceOptions, sourceDescriptions } from './sources.js'
import type { MatrixFrameInput, RateCardGeometry, SeriesSample } from './types.js'

const BITS_PER_TRIAL = 200 // GCP convention: trial ~ Binomial(200, ½), mean 100, variance 50
const ENVELOPE_P = 0.05

/**
 * Sample rate-card geometry (Malcolm Rae style base-44 layout). Hardcoded on
 * purpose: the dial panel consumes plain JSON, so the demo must not import
 * `@mindpeeker/rate` — any producer can publish this shape via `attachStatic`.
 */
const SAMPLE_RATE_CARD: RateCardGeometry = Object.freeze({
  type: 'rate-card',
  sectors: 44,
  rings: Object.freeze([0.3, 0.5, 0.7, 0.9]) as readonly number[],
  pointerSector: 17,
  label: 'sample base-44 rate card',
})

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Pace a stream for on-screen legibility: pull-based, so the source slows too. */
async function* paced<T>(src: AsyncIterable<T>, intervalMs: number): AsyncGenerator<T> {
  for await (const item of src) {
    yield item
    await sleep(intervalMs)
  }
}

/**
 * Broadcast one byte stream to `n` independent consumers so a single physical
 * device (camera, serial port) is opened exactly once. Each consumer has a
 * bounded queue; a slow consumer drops its oldest chunks rather than blocking
 * the source or the other consumers (chunks are read-only, so sharing the
 * reference across consumers is safe). The shared pull loop ends every consumer
 * when the source ends, errors, or `signal` fires.
 */
function fanOut(
  src: AsyncIterable<Uint8Array>,
  n: number,
  opts: { capacity?: number; signal?: AbortSignal } = {},
): AsyncGenerator<Uint8Array>[] {
  const capacity = opts.capacity ?? 64
  const queues: Uint8Array[][] = Array.from({ length: n }, () => [])
  const wakers: Array<(() => void) | null> = new Array(n).fill(null)
  let done = false
  let failure: unknown = null

  const wake = (i: number): void => {
    const w = wakers[i]
    if (w) {
      wakers[i] = null
      w()
    }
  }

  void (async () => {
    try {
      for await (const chunk of src) {
        if (opts.signal?.aborted) break
        for (let i = 0; i < n; i++) {
          const q = queues[i] as Uint8Array[]
          q.push(chunk)
          if (q.length > capacity) q.shift()
          wake(i)
        }
      }
    } catch (err) {
      failure = err
    } finally {
      done = true
      for (let i = 0; i < n; i++) wake(i)
    }
  })()

  return queues.map((q, i) =>
    (async function* consumer(): AsyncGenerator<Uint8Array> {
      while (true) {
        const next = q.shift()
        if (next !== undefined) {
          yield next
          continue
        }
        if (done) {
          if (failure) throw failure
          return
        }
        await new Promise<void>((resolve) => {
          wakers[i] = resolve
        })
      }
    })(),
  )
}

/** Map `windowedNegentropy` emissions to series samples. */
async function* negentropySeries(
  bytes: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SeriesSample> {
  const points = windowedNegentropy(bytes, { windowSize: 512, hopSize: 128, signal })
  for await (const point of points) {
    yield { t: point.startSample, value: point.j }
  }
}

/**
 * Live GCP-style cumulative deviation with its significance envelope. The
 * envelope arrays grow geometrically so `significanceEnvelope` (which
 * computes all steps up to $t$) costs amortized $O(1)$ quantile evaluations
 * per trial; `cumulativeDeviation` is re-run over the full z history each
 * step so the plotted values are exactly the batch statistic.
 */
async function* cumdevSeries(
  src: { name: string; stream(opts?: object): AsyncIterable<Uint8Array> },
  signal: AbortSignal,
): AsyncGenerator<SeriesSample> {
  const zs: number[] = []
  let hi: Float64Array = new Float64Array(0)
  let lo: Float64Array = new Float64Array(0)
  const trials = trialStream(src, { bitsPerTrial: BITS_PER_TRIAL, chunkBytes: 25, signal })
  for await (const trial of trials) {
    const z = (trial.sum - BITS_PER_TRIAL / 2) / Math.sqrt(BITS_PER_TRIAL / 4)
    zs.push(z)
    const t = zs.length
    if (t > hi.length) {
      const steps = Math.max(256, hi.length * 2)
      hi = significanceEnvelope(steps, ENVELOPE_P)
      lo = significanceEnvelope(steps, 1 - ENVELOPE_P)
    }
    const d = cumulativeDeviation(zs)
    yield { t, value: d[t - 1] as number, band: [lo[t - 1] as number, hi[t - 1] as number] }
    await sleep(150)
  }
}

/** Exponentially decaying byte-value histogram (32 bins), one frame per chunk. */
async function* histogramMatrix(
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

interface CliArgs {
  port: number
  host: string
  source: string
  sourceOpts: SourceOptions
}

const USAGE = `usage: mindpeeker-viz [options]

  --source <name>       entropy source (default: crypto); see --list-sources
  --raw                 pass hardware raw samples through, skip SHA-256 conditioning
  --serial-path <path>  serial/esp32 device (default: /dev/cu.usbserial-110 or /dev/ttyUSB0)
  --baud <n>            serial baud rate (default: 921600)
  --camera-device <id>  ffmpeg camera device (default: '0' macOS / '/dev/video0' Linux)
  --mic-device <spec>   ffmpeg audio device (default: ':0' macOS / 'default' Linux)
  --hwrng-path <path>   kernel hwrng device (default: /dev/hwrng)
  --port <n>            HTTP/WS port (default: 0 = ephemeral)
  --host <h>            bind host (default: localhost)
  --list-sources        print the available entropy sources and exit
  -h, --help            print this help and exit`

function parseArgs(argv: readonly string[]): CliArgs {
  let port = 0
  let host = 'localhost'
  let source = 'crypto'
  const sourceOpts: SourceOptions = {}
  const next = (i: number): string => {
    const v = argv[i]
    if (v === undefined) {
      console.error(`missing value for ${argv[i - 1]}`)
      process.exit(1)
    }
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port') port = Number(next(++i))
    else if (arg === '--host') host = next(++i)
    else if (arg === '--source') source = next(++i)
    else if (arg === '--raw') sourceOpts.raw = true
    else if (arg === '--serial-path') sourceOpts.serialPath = next(++i)
    else if (arg === '--baud') sourceOpts.baudRate = Number(next(++i))
    else if (arg === '--camera-device') sourceOpts.cameraDevice = next(++i)
    else if (arg === '--mic-device') sourceOpts.micDevice = next(++i)
    else if (arg === '--hwrng-path') sourceOpts.hwrngPath = next(++i)
    else if (arg === '--list-sources') {
      console.log('available entropy sources:')
      for (const { name, describe } of sourceDescriptions()) {
        console.log(`  ${name.padEnd(8)} ${describe}`)
      }
      process.exit(0)
    } else if (arg === '--help' || arg === '-h') {
      console.log(USAGE)
      process.exit(0)
    } else {
      console.error(`unknown argument: ${arg}\n\n${USAGE}`)
      process.exit(1)
    }
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    console.error(`invalid --port: ${port}`)
    process.exit(1)
  }
  return { port, host, source, sourceOpts }
}

const { port, host, source, sourceOpts } = parseArgs(Bun.argv.slice(2))

let resolved: ReturnType<typeof resolveSource>
try {
  resolved = resolveSource(source, sourceOpts)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
const { provider, note } = resolved

const abort = new AbortController()
const dashboard = createDashboard({ port, host, signal: abort.signal })
const streamOpts = { chunkBytes: 256, signal: abort.signal }

// One device session, fanned out to every panel — a single camera or serial
// port is opened exactly once (opening it per panel would conflict).
const [bitmapBytes, negentropyBytes, trialBytes, histogramBytes] = fanOut(
  paced(provider.stream(streamOpts), 50),
  4,
  { signal: abort.signal },
) as [
  AsyncGenerator<Uint8Array>,
  AsyncGenerator<Uint8Array>,
  AsyncGenerator<Uint8Array>,
  AsyncGenerator<Uint8Array>,
]

dashboard.attachByteStream(`${provider.name} noise`, bitmapBytes)
dashboard.attachSeries(
  'windowed negentropy (logcosh)',
  negentropySeries(negentropyBytes, abort.signal),
)
dashboard.attachSeries(
  `cumulative deviation ±${ENVELOPE_P} envelope`,
  cumdevSeries({ name: provider.name, stream: () => trialBytes }, abort.signal),
)
dashboard.attachMatrix('byte histogram', histogramMatrix(paced(histogramBytes, 400)))
dashboard.attachStatic('rate card', SAMPLE_RATE_CARD)

console.log(`mindpeeker visualizer demo → ${dashboard.url}`)
console.log(`source: ${provider.name} — ${note}`)
console.log(
  `channels: ${provider.name} noise · windowed negentropy · cumdev+envelope · histogram · dial`,
)
console.log('press Ctrl+C to stop')

process.on('SIGINT', () => {
  abort.abort()
  void dashboard.stop().then(() => process.exit(0))
})
