import { afterEach, describe, expect, test } from 'bun:test'
import { VisualizerError } from '../../src/errors.js'
import { decodeFrame, FRAME_KIND, parseTextMessage } from '../../src/protocol.js'
import { createDashboard } from '../../src/server/dashboard.js'
import type { Dashboard, DirectoryMessage, SeriesSample } from '../../src/types.js'
import {
  deferred,
  gatedSource,
  openInbox,
  openSocket,
  prngBytes,
  type WsInbox,
} from '../helpers/streams.js'

const running: Dashboard[] = []

function start(opts: Parameters<typeof createDashboard>[0] = {}): Dashboard {
  const dashboard = createDashboard({ port: 0, onChannelError: () => {}, ...opts })
  running.push(dashboard)
  return dashboard
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.stop()
})

const wsUrl = (dashboard: Dashboard, query = '') =>
  `${dashboard.url.replace('http', 'ws')}ws${query}`

async function nextDirectory(inbox: WsInbox): Promise<DirectoryMessage> {
  const msg = await inbox.next()
  if (typeof msg !== 'string') throw new Error('expected a text frame')
  const parsed = parseTextMessage(msg)
  if (parsed.type !== 'directory') throw new Error('expected a directory')
  return parsed
}

async function nextBinary(inbox: WsInbox): Promise<Uint8Array> {
  const msg = await inbox.next()
  if (typeof msg === 'string') throw new Error(`expected a binary frame, got ${msg}`)
  return msg
}

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(VisualizerError)
    return (error as VisualizerError).code
  }
  throw new Error('expected a throw')
}

const banded: SeriesSample = {
  t: 1,
  value: 0.5,
  bands: [
    { lo: -1, hi: 2, label: 'two-sided 90% pointwise' },
    { lo: Number.NEGATIVE_INFINITY, hi: 9.92, label: 'anytime-valid (α = 0.05)' },
  ],
}

describe('protocol negotiation', () => {
  test('a v=2 client gets kind-4 frames and band labels; a legacy client gets protocol 1', async () => {
    const dashboard = start()
    const modern = await openInbox(wsUrl(dashboard, '?v=2'))
    const legacy = await openInbox(wsUrl(dashboard))
    expect((await nextDirectory(modern)).version).toBe(2)
    expect((await nextDirectory(legacy)).version).toBe(1)

    const gate = deferred()
    async function* producer(): AsyncGenerator<SeriesSample> {
      yield banded
      await gate.promise
    }
    dashboard.attachSeries('cumdev', producer())
    await nextDirectory(modern) // attach
    await nextDirectory(legacy)
    const labeled = await nextDirectory(modern)
    expect(labeled.channels[0]?.bandLabels).toEqual([
      'two-sided 90% pointwise',
      'anytime-valid (α = 0.05)',
    ])
    const legacyMeta = await nextDirectory(legacy)
    expect(legacyMeta.version).toBe(1)
    expect(legacyMeta.channels[0]?.bandLabels).toBeUndefined()

    const v2 = await nextBinary(modern)
    expect([v2[0], v2[1]]).toEqual([2, FRAME_KIND.bands])
    const decoded2 = decodeFrame(v2)
    if (decoded2.kind !== 'series') throw new Error('wrong kind')
    expect(decoded2.points[0]?.bands).toEqual([
      { lo: -1, hi: 2 },
      { lo: Number.NEGATIVE_INFINITY, hi: 9.92 },
    ])
    const v1 = await nextBinary(legacy)
    expect([v1[0], v1[1]]).toEqual([1, FRAME_KIND.series])
    expect(decodeFrame(v1)).toEqual({
      kind: 'series',
      channelId: 0,
      points: [{ t: 1, value: 0.5, band: [-1, 2] }],
    })

    // late joiners get the rendition of their own version from the ring
    const lateModern = await openInbox(wsUrl(dashboard, '?v=9'))
    expect((await nextDirectory(lateModern)).channels[0]?.bandLabels).toHaveLength(2)
    expect((await nextBinary(lateModern))[1]).toBe(FRAME_KIND.bands)
    const lateLegacy = await openInbox(wsUrl(dashboard, '?v=1'))
    await nextDirectory(lateLegacy)
    expect((await nextBinary(lateLegacy))[1]).toBe(FRAME_KIND.series)
    gate.resolve()
  })

  test('a malformed version request is refused with HTTP 400', async () => {
    const dashboard = start()
    for (const query of ['?v=0', '?v=two', '?v=1&v=2']) {
      const res = await fetch(`${dashboard.url}ws${query}`, {
        headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
      })
      expect(res.status).toBe(400)
      expect(await res.text()).toContain('protocol version')
    }
    await expect(openSocket(wsUrl(dashboard, '?v=abc'))).rejects.toThrow()
  })

  test('changed band labels are republished; samples without bands keep them', async () => {
    const dashboard = start()
    const inbox = await openInbox(wsUrl(dashboard, '?v=2'))
    await nextDirectory(inbox)
    const gate = deferred()
    async function* producer(): AsyncGenerator<SeriesSample> {
      yield { value: 1, bands: [{ lo: 0, hi: 1, label: 'a' }] }
      yield { value: 2, bands: [{ lo: 0, hi: 1, label: 'a' }] }
      yield 3
      yield { value: 4, bands: [{ lo: 0, hi: 1 }] }
      await gate.promise
    }
    dashboard.attachSeries('s', producer())
    await nextDirectory(inbox) // attach
    expect((await nextDirectory(inbox)).channels[0]?.bandLabels).toEqual(['a'])
    await nextBinary(inbox)
    await nextBinary(inbox) // same labels: no directory in between
    await nextBinary(inbox) // a bare number keeps the labels
    expect((await nextDirectory(inbox)).channels[0]?.bandLabels).toEqual([''])
    await nextBinary(inbox)
    gate.resolve()
  })

  test('malformed bands error the channel with a protocol reason', async () => {
    const reports: unknown[] = []
    const dashboard = start({ onChannelError: (_c, e) => reports.push(e) })
    const inbox = await openInbox(wsUrl(dashboard, '?v=2'))
    await nextDirectory(inbox)
    async function* producer(): AsyncGenerator<SeriesSample> {
      yield { value: 1, band: [0, 1], bands: [{ lo: 0, hi: 1 }] }
    }
    dashboard.attachSeries('bad', producer())
    await nextDirectory(inbox)
    const errored = await nextDirectory(inbox)
    expect(errored.channels[0]?.error).toContain('both band and bands')
    expect(
      reports.map((e) => [(e as VisualizerError).code, (e as VisualizerError).channel]),
    ).toEqual([['protocol', 'bad']])
  })
})

describe('setNote', () => {
  test('notes are coalesced into one directory update and replayed to late joiners', async () => {
    const dashboard = start()
    const inbox = await openInbox(wsUrl(dashboard, '?v=2'))
    await nextDirectory(inbox)
    dashboard.attachStatic('card', { type: 'rate-card', sectors: 4, rings: [1] })
    await nextDirectory(inbox)
    await inbox.next() // static document
    dashboard.setNote('card', 'anytime p = 1.00')
    dashboard.setNote('card', 'anytime p = 0.41')
    const started = performance.now()
    const update = await nextDirectory(inbox)
    expect(update.channels[0]?.note).toBe('anytime p = 0.41')
    expect(performance.now() - started).toBeLessThan(1000)
    await expect(inbox.next(250)).rejects.toThrow('timed out') // exactly one update

    const legacy = await openInbox(wsUrl(dashboard))
    expect((await nextDirectory(legacy)).channels[0]?.note).toBe('anytime p = 0.41')

    dashboard.setNote('card', undefined)
    expect((await nextDirectory(inbox)).channels[0]?.note).toBeUndefined()
    dashboard.setNote('card', 'x'.repeat(500))
    const long = (await nextDirectory(inbox)).channels[0]?.note as string
    expect(long).toHaveLength(200)
    expect(long.endsWith('…')).toBe(true)
  })

  test('unknown channels, non-string notes and a stopped dashboard throw', async () => {
    const dashboard = start()
    dashboard.attachStatic('card', {})
    expect(codeOf(() => dashboard.setNote('nope', 'x'))).toBe('invalid_channel')
    expect(codeOf(() => dashboard.setNote('card', 42 as unknown as string))).toBe('invalid_channel')
    await dashboard.stop()
    expect(codeOf(() => dashboard.setNote('card', 'x'))).toBe('server')
  })
})

describe('late-joiner replay budget', () => {
  test('a retained history over 4 MiB replays only the newest frames that fit', async () => {
    const dashboard = start({ ringCapacity: 64 })
    const chunks = Array.from({ length: 64 }, (_, i) => prngBytes(128 * 1024, i + 1))
    const { src, release } = gatedSource(chunks)
    const consumed = deferred()
    let pulls = 0
    const counting: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (++pulls === chunks.length + 1) consumed.resolve()
          return src.next()
        },
        return: (value?: unknown) => src.return(value as undefined),
      }),
    }
    dashboard.attachByteStream('big', counting)
    await consumed.promise // all 64 frames are in the ring

    const inbox = await openInbox(wsUrl(dashboard, '?v=2'))
    await nextDirectory(inbox)
    // 31 × (131 072 + 4) = 4 063 356 ≤ 4 MiB < 32 × 131 076
    const received: Uint8Array[] = []
    for (let i = 0; i < 31; i++) {
      const decoded = decodeFrame(await nextBinary(inbox))
      if (decoded.kind !== 'bytes') throw new Error('wrong kind')
      received.push(decoded.bytes)
    }
    expect(received).toEqual(chunks.slice(64 - 31))
    await expect(inbox.next(300)).rejects.toThrow('timed out')
    release()
  })
})
