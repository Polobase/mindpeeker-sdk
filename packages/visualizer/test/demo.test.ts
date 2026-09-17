import { describe, expect, test } from 'bun:test'
import { cumulativeDeviation, significanceEnvelope, trialsFromBytes } from '@mindpeeker/negentropy'
import {
  BITS_PER_TRIAL,
  CHANNEL_LABELS,
  createErrorReporter,
  cumdevSeries,
  type DemoByteSource,
  histogramMatrix,
  parseArgs,
  SAMPLE_RATE_CARD,
  sourceListing,
  startDemo,
} from '../src/demo.js'
import { VisualizerError } from '../src/errors.js'
import { parseTextMessage } from '../src/protocol.js'
import type { DirectoryMessage, MatrixFrameInput, SeriesSample } from '../src/types.js'
import { closed, fromItems, openSocket, prngBytes, WsInbox } from './helpers/streams.js'

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(VisualizerError)
    return (error as VisualizerError).code
  }
  throw new Error('expected a VisualizerError')
}

async function collect<T>(src: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of src) out.push(item)
  return out
}

describe('parseArgs', () => {
  test('defaults to the crypto source on an ephemeral localhost port', () => {
    expect(parseArgs([])).toEqual({
      command: 'run',
      options: { port: 0, host: 'localhost', source: 'crypto', sourceOpts: {} },
    })
  })

  test('parses every flag', () => {
    const argv = [
      '--source',
      'esp32',
      '--raw',
      '--serial-path',
      '/dev/ttyUSB0',
      '--baud',
      '115200',
      '--camera-device',
      '1',
      '--mic-device',
      ':1',
      '--hwrng-path',
      '/dev/hwrng0',
      '--port',
      '8080',
      '--host',
      '::1',
    ]
    expect(parseArgs(argv)).toEqual({
      command: 'run',
      options: {
        port: 8080,
        host: '::1',
        source: 'esp32',
        sourceOpts: {
          raw: true,
          serialPath: '/dev/ttyUSB0',
          baudRate: 115_200,
          cameraDevice: '1',
          micDevice: ':1',
          hwrngPath: '/dev/hwrng0',
        },
      },
    })
  })

  test('--port accepts exactly the decimal integers 0…65535', () => {
    const port = (raw: string) => {
      const parsed = parseArgs(['--port', raw])
      return parsed.command === 'run' ? parsed.options.port : undefined
    }
    expect(port('0')).toBe(0)
    expect(port('65535')).toBe(65_535)
    expect(port('08080')).toBe(8080)
    for (const raw of ['65536', '-1', '1e3', '0x50', '80.5', 'abc', ' 80', '9'.repeat(400)]) {
      expect(codeOf(() => parseArgs(['--port', raw]))).toBe('invalid_options')
    }
  })

  test('--baud must be a decimal integer ≥ 1', () => {
    const parsed = parseArgs(['--baud', '921600'])
    expect(parsed.command === 'run' && parsed.options.sourceOpts.baudRate).toBe(921_600)
    for (const raw of ['0', '921k', '-9600', '1.5', '', '9'.repeat(30)]) {
      expect(codeOf(() => parseArgs(['--baud', raw]))).toBe('invalid_options')
    }
  })

  test('a flag without a value, or followed by another flag, is an error', () => {
    for (const argv of [['--port'], ['--source'], ['--serial-path', '--raw'], ['--host', '']]) {
      expect(codeOf(() => parseArgs(argv))).toBe('invalid_options')
    }
  })

  test('unknown arguments are errors; help and list-sources short-circuit', () => {
    expect(codeOf(() => parseArgs(['--verbose']))).toBe('invalid_options')
    expect(parseArgs(['--port', '1', '-h', '--bogus'])).toEqual({ command: 'help' })
    expect(parseArgs(['--help'])).toEqual({ command: 'help' })
    expect(parseArgs(['--list-sources'])).toEqual({ command: 'list-sources' })
  })

  test('sourceListing names every source', () => {
    const listing = sourceListing()
    for (const name of ['crypto', 'jitter', 'serial', 'esp32', 'camera', 'mic', 'hwrng']) {
      expect(listing).toContain(`  ${name}`)
    }
  })
})

/** A byte source that serves `bytes` in chunks of `chunk`, optionally pausing between them. */
function recordedSource(bytes: Uint8Array, chunk: number, pauseMs = 0): DemoByteSource {
  return {
    name: 'recorded',
    async *stream() {
      for (let at = 0; at < bytes.length; at += chunk) {
        if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs))
        yield bytes.subarray(at, at + chunk)
      }
    },
  }
}

type Point = Exclude<SeriesSample, number>

describe('cumdevSeries', () => {
  const bytes = prngBytes(25_000, 0x5eed) // exactly 1000 trials of 200 bits

  test('plots every trial, t = 1…T, bit-identical to the batch cumulative deviation', async () => {
    const points = (await collect(cumdevSeries(recordedSource(bytes, 256)))) as Point[]
    const { sums } = trialsFromBytes(bytes, 'recorded', { bitsPerTrial: BITS_PER_TRIAL })
    expect(points).toHaveLength(1000)
    expect(sums).toHaveLength(1000)
    const zs = Array.from(sums, (s) => (s - 100) / Math.sqrt(50))
    const batch = cumulativeDeviation(zs)
    let squares = 0
    points.forEach((point, i) => {
      expect(point.t).toBe(i + 1)
      expect(point.value).toBe(batch[i] as number)
      // exact rational reference: D(t) = (Σ(S−100)² − 50t) / 50
      squares += ((sums[i] as number) - 100) ** 2
      expect(point.value).toBeCloseTo((squares - 50 * (i + 1)) / 50, 8)
    })
  })

  test('the band is the two-sided 90% pointwise χ² envelope', async () => {
    const points = (await collect(cumdevSeries(recordedSource(bytes, 256)))) as Point[]
    // independent closed forms: df 1 via the normal quantile, df 2 via −2 ln(1 − p)
    expect(points[0]?.band?.[1]).toBeCloseTo(3.8414588206941227 - 1, 10)
    expect(points[0]?.band?.[0]).toBeCloseTo(0.003932140000019528 - 1, 10)
    expect(points[1]?.band?.[1]).toBeCloseTo(5.991464547107982 - 2, 10)
    expect(points[1]?.band?.[0]).toBeCloseTo(0.10258658877510116 - 2, 10)
    // and negentropy's significanceEnvelope (upper p = 0.05, lower p = 0.95) at every step
    const upper = significanceEnvelope(1000, 0.05)
    const lower = significanceEnvelope(1000, 0.95)
    points.forEach((point, i) => {
      const [lo, hi] = point.band as readonly [number, number]
      expect(Math.abs(hi - (upper[i] as number))).toBeLessThan(1e-9 * (1 + (i + 1)))
      expect(Math.abs(lo - (lower[i] as number))).toBeLessThan(1e-9 * (1 + (i + 1)))
    })
  })

  test('source-driven pacing: points follow chunk arrival, with no sleep of their own', async () => {
    const started = performance.now()
    const it = cumdevSeries(recordedSource(bytes.subarray(0, 2500), 250, 5))
    const first = await it.next()
    expect(first.done).toBe(false)
    const rest = await collect({ [Symbol.asyncIterator]: () => it })
    expect(rest).toHaveLength(99) // 100 trials in 2 500 bytes, all delivered
    // 10 chunks × 5 ms of source pacing; the old demo slept 150 ms per trial (15 s here)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('histogramMatrix', () => {
  test('32 bins of width 8 with 0.9 decay per chunk; frames are independent copies', async () => {
    const frames = (await collect(
      histogramMatrix(fromItems(new Uint8Array([0, 7, 8, 255, 255]), new Uint8Array([255]))),
    )) as MatrixFrameInput[]
    expect(frames).toHaveLength(2)
    const [first, second] = frames as [MatrixFrameInput, MatrixFrameInput]
    expect([first.rows, first.cols]).toEqual([1, 32])
    expect([first.data[0], first.data[1], first.data[31]]).toEqual([2, 1, 2])
    expect(second.data[0]).toBeCloseTo(1.8, 5)
    expect(second.data[1]).toBeCloseTo(0.9, 5)
    expect(second.data[31]).toBeCloseTo(2.8, 5)
    expect(first.data[31]).toBe(2) // not aliased by the later frame
    expect(first.colLabels?.[0]).toBe('0')
    expect(first.colLabels?.[31]).toBe('248')
  })
})

describe('createErrorReporter', () => {
  test('prints the cause chain once, then shortens repeats of the same reason', () => {
    const lines: string[] = []
    const report = createErrorReporter((line) => lines.push(line))
    const failure = new Error('esp32 stream failed', { cause: new Error('ENOENT: no such device') })
    report('esp32 noise', failure)
    report('byte histogram', failure)
    report('rate card', new Error('other'))
    expect(lines).toEqual([
      "channel 'esp32 noise' failed: esp32 stream failed: ENOENT: no such device",
      "channel 'byte histogram' failed (same reason)",
      "channel 'rate card' failed: other",
    ])
  })
})

describe('startDemo', () => {
  const options = { port: 0, host: 'localhost', source: 'crypto', sourceOpts: {} }

  test('serves the five demo channels; the cumdev title states the band', async () => {
    const failures: unknown[] = []
    const session = startDemo(options, { onChannelError: (_c, e) => failures.push(e) })
    try {
      expect(session.providerName).toBe('crypto')
      const ws = await openSocket(`${session.dashboard.url.replace('http', 'ws')}ws`)
      const inbox = new WsInbox(ws)
      const first = await inbox.next()
      const dir = parseTextMessage(first as string) as DirectoryMessage
      expect(dir.channels.map((c) => c.name)).toEqual([
        'crypto noise',
        CHANNEL_LABELS.negentropy,
        CHANNEL_LABELS.cumdev,
        CHANNEL_LABELS.histogram,
        CHANNEL_LABELS.rateCard,
      ])
      expect(CHANNEL_LABELS.cumdev).toContain('two-sided 90% pointwise')
      const stat = parseTextMessage((await inbox.next()) as string)
      expect(stat).toMatchObject({ type: 'static', data: SAMPLE_RATE_CARD })
      const code = closed(ws)
      await session.stop()
      expect(await code).toBe(1000)
      expect(failures).toEqual([])
      expect(session.stop()).toBe(session.stop())
    } finally {
      await session.stop()
    }
  })

  test('an unknown source or a pre-aborted signal fails before binding', () => {
    expect(codeOf(() => startDemo({ ...options, source: 'nope' }))).toBe('invalid_options')
    const controller = new AbortController()
    controller.abort()
    expect(codeOf(() => startDemo(options, { signal: controller.signal }))).toBe('aborted')
  })

  test('aborting the runtime signal stops the dashboard', async () => {
    const controller = new AbortController()
    const session = startDemo(options, { signal: controller.signal })
    const ws = await openSocket(`${session.dashboard.url.replace('http', 'ws')}ws`)
    const code = closed(ws)
    controller.abort()
    expect(await code).toBe(1000)
    await session.stop()
  })
})
