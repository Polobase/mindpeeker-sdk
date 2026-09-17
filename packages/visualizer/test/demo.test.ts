import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordSession, verifyChain } from '@mindpeeker/psi'
import {
  BAND_LABELS,
  CHANNEL_LABELS,
  createErrorReporter,
  type DemoSession,
  histogramMatrix,
  parseArgs,
  SAMPLE_RATE_CARD,
  sourceListing,
  startDemo,
  startReplay,
} from '../src/demo.js'
import { VisualizerError } from '../src/errors.js'
import { decodeFrame, FRAME_KIND, parseTextMessage } from '../src/protocol.js'
import type { DirectoryMessage, MatrixFrameInput } from '../src/types.js'
import {
  closed,
  fromItems,
  openInbox,
  openSocket,
  prngBytes,
  until,
  type WsInbox,
} from './helpers/streams.js'

const dir = mkdtempSync(join(tmpdir(), 'mindpeeker-viz-demo-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

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

  test('--record rides along with a live run; --replay replaces the live source', () => {
    expect(parseArgs(['--source', 'esp32', '--record', 'run.jsonl'])).toEqual({
      command: 'run',
      options: { port: 0, host: 'localhost', source: 'esp32', sourceOpts: {}, record: 'run.jsonl' },
    })
    expect(parseArgs(['--replay', 'run.jsonl', '--port', '8080'])).toEqual({
      command: 'replay',
      options: { port: 8080, host: 'localhost', replay: 'run.jsonl' },
    })
    for (const argv of [
      ['--replay', 'a.jsonl', '--record', 'b.jsonl'],
      ['--source', 'esp32', '--replay', 'a.jsonl'],
      ['--replay', 'a.jsonl', '--raw'],
      ['--replay'],
      ['--record', '--raw'],
    ]) {
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

const wsUrl = (session: DemoSession, query = '') =>
  `${session.dashboard.url.replace('http', 'ws')}ws${query}`

async function nextDirectory(inbox: WsInbox): Promise<DirectoryMessage> {
  for (;;) {
    const msg = await inbox.next()
    if (typeof msg !== 'string') continue
    const parsed = parseTextMessage(msg)
    if (parsed.type === 'directory') return parsed
  }
}

async function codeOfAsync(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(VisualizerError)
    return (error as VisualizerError).code
  }
  throw new Error('expected a VisualizerError')
}

describe('startDemo', () => {
  const options = { port: 0, host: 'localhost', source: 'crypto', sourceOpts: {} }

  test('serves the six demo channels; envelopes are labeled and the netvar note appears', async () => {
    const failures: unknown[] = []
    const session = await startDemo(options, { onChannelError: (_c, e) => failures.push(e) })
    try {
      expect(session.providerName).toBe('crypto')
      const inbox = await openInbox(wsUrl(session, '?v=2'))
      const dir = parseTextMessage((await inbox.next()) as string) as DirectoryMessage
      expect(dir.version).toBe(2)
      expect(dir.channels.map((c) => c.name)).toEqual([
        'crypto noise',
        CHANNEL_LABELS.negentropy,
        CHANNEL_LABELS.cumdev,
        CHANNEL_LABELS.netvar,
        CHANNEL_LABELS.histogram,
        CHANNEL_LABELS.rateCard,
      ])
      expect(dir.channels[0]?.note).toBeUndefined() // the CSPRNG is not health-tested
      const stat = parseTextMessage((await inbox.next()) as string)
      expect(stat).toMatchObject({ type: 'static', data: SAMPLE_RATE_CARD })

      let latest = dir
      const deadline = Date.now() + 5000
      while (
        (latest.channels[2]?.bandLabels === undefined || latest.channels[3]?.note === undefined) &&
        Date.now() < deadline
      ) {
        latest = await nextDirectory(inbox)
      }
      expect(latest.channels[2]?.bandLabels).toEqual([BAND_LABELS.pointwise, BAND_LABELS.anytime])
      expect(latest.channels[3]?.bandLabels).toEqual([BAND_LABELS.pointwise])
      expect(latest.channels[3]?.note).toMatch(/^anytime p = /)

      const code = closed(inbox.ws)
      await session.stop()
      expect(await code).toBe(1000)
      expect(failures).toEqual([])
      expect(session.stop()).toBe(session.stop())
    } finally {
      await session.stop()
    }
  })

  test('a health-tested source announces its health tests on the noise channel', async () => {
    const session = await startDemo({ ...options, source: 'jitter' })
    try {
      const inbox = await openInbox(wsUrl(session))
      const dir = await nextDirectory(inbox)
      expect(dir.channels[0]).toMatchObject({
        name: `${session.providerName} noise`,
        note: 'SP 800-90B health tests: no failures',
      })
    } finally {
      await session.stop()
    }
  })

  test('an unknown source, a pre-aborted signal or an existing --record file fails', async () => {
    expect(await codeOfAsync(startDemo({ ...options, source: 'nope' }))).toBe('invalid_options')
    const controller = new AbortController()
    controller.abort()
    expect(await codeOfAsync(startDemo(options, { signal: controller.signal }))).toBe('aborted')
    const existing = join(dir, 'existing.jsonl')
    writeFileSync(existing, 'keep me\n')
    expect(await codeOfAsync(startDemo({ ...options, record: existing }))).toBe('invalid_options')
    expect(readFileSync(existing, 'utf8')).toBe('keep me\n')
  })

  test('aborting the runtime signal stops the dashboard', async () => {
    const controller = new AbortController()
    const session = await startDemo(options, { signal: controller.signal })
    const ws = await openSocket(wsUrl(session))
    const code = closed(ws)
    controller.abort()
    expect(await code).toBe(1000)
    await session.stop()
  })
})

describe('--record and --replay', () => {
  test('a recorded live session verifies and replays through the trial channels', async () => {
    const path = join(dir, 'live.jsonl')
    const live = await startDemo(
      { port: 0, host: 'localhost', source: 'crypto', sourceOpts: {}, record: path },
      { now: () => 1_700_000_000_000 },
    )
    try {
      const inbox = await openInbox(wsUrl(live, '?v=2'))
      const dir = await nextDirectory(inbox)
      expect(dir.channels[2]?.note).toBe('recording → live.jsonl')
      await until(() => readFileSync(path, 'utf8').split('\n').length > 60, 5000)
    } finally {
      await live.stop()
    }
    const text = readFileSync(path, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    const verification = await verifyChain(text)
    expect(verification.ok).toBe(true)

    const replay = await startReplay({ port: 0, host: 'localhost', replay: path }, { pace: false })
    try {
      expect(replay.providerName).toBe('replay')
      expect(replay.note).toContain(verification.head as string)
      const inbox = await openInbox(wsUrl(replay, '?v=2'))
      const first = await nextDirectory(inbox)
      expect(first.channels.map((c) => c.name)).toEqual([
        CHANNEL_LABELS.cumdev,
        CHANNEL_LABELS.netvar,
      ])
      expect(first.channels[0]?.note).toContain('chain ok')
      let frame: Uint8Array | undefined
      while (frame === undefined) {
        const msg = await inbox.next()
        if (typeof msg !== 'string') frame = msg
      }
      expect(frame[1]).toBe(FRAME_KIND.bands)
      const decoded = decodeFrame(frame)
      if (decoded.kind !== 'series') throw new Error('wrong kind')
      expect(decoded.points[0]?.bands).toHaveLength(decoded.channelId === 0 ? 2 : 1)
    } finally {
      await replay.stop()
    }
  })

  test('a broken chain is refused before anything is served', async () => {
    const source = { name: 'a', stream: () => fromItems(prngBytes(25 * 4, 3)) }
    const lines: string[] = []
    for await (const line of recordSession([source], { chain: true, now: () => 0 })) {
      lines.push(line)
    }
    // swap two trial lines: every record stays well-formed, the links do not
    ;[lines[2], lines[3]] = [lines[3] as string, lines[2] as string]
    const broken = join(dir, 'broken.jsonl')
    writeFileSync(broken, lines.join('\n'))
    try {
      await startReplay({ port: 0, host: 'localhost', replay: broken })
      throw new Error('replayed a broken chain')
    } catch (error) {
      expect(error).toBeInstanceOf(VisualizerError)
      expect((error as VisualizerError).code).toBe('invalid_options')
      expect((error as VisualizerError).message).toContain('refusing to replay')
      expect((error as VisualizerError).message).toContain('hash chain broken at record 3')
    }
  })
})
