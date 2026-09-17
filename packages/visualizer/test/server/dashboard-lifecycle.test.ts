import { afterEach, describe, expect, test } from 'bun:test'
import { VisualizerError } from '../../src/errors.js'
import { decodeFrame, parseTextMessage } from '../../src/protocol.js'
import { createDashboard } from '../../src/server/dashboard.js'
import type { Dashboard, DirectoryMessage, MatrixFrameInput, TextMessage } from '../../src/types.js'
import {
  closed,
  deferred,
  fromItems,
  gatedSource,
  openSocket,
  prngBytes,
  WsInbox,
} from '../helpers/streams.js'

const running: Dashboard[] = []
const reports: [string, unknown][] = []

function start(opts: Parameters<typeof createDashboard>[0] = {}): Dashboard {
  const dashboard = createDashboard({
    port: 0,
    onChannelError: (channel, error) => reports.push([channel, error]),
    ...opts,
  })
  running.push(dashboard)
  return dashboard
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.stop()
  reports.length = 0
})

const wsUrl = (dashboard: Dashboard) => `${dashboard.url.replace('http', 'ws')}ws`

async function nextText(inbox: WsInbox): Promise<TextMessage> {
  const msg = await inbox.next()
  if (typeof msg !== 'string') throw new Error('expected a text frame')
  return parseTextMessage(msg)
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

describe('attachStatic serializes up front', () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const unserializable: [string, unknown][] = [
    ['BigInt', { round: 1n }],
    ['cycle', cyclic],
    [
      'throwing toJSON',
      {
        toJSON: () => {
          throw new Error('nope')
        },
      },
    ],
    ['undefined', undefined],
    ['function', () => 1],
  ]

  for (const [label, doc] of unserializable) {
    test(`${label}: throws invalid_channel and registers nothing`, async () => {
      const dashboard = start()
      dashboard.attachByteStream('noise', fromItems(prngBytes(4)))
      try {
        dashboard.attachStatic('meta', doc)
        throw new Error('accepted an unserializable document')
      } catch (error) {
        expect(error).toBeInstanceOf(VisualizerError)
        expect((error as VisualizerError).code).toBe('invalid_channel')
        expect((error as VisualizerError).channel).toBe('meta')
      }
      // the name is still free and later clients are unaffected
      dashboard.attachStatic('meta', { ok: 1 })
      dashboard.attachStatic('after', { ok: true })
      const ws = await openSocket(wsUrl(dashboard))
      const inbox = new WsInbox(ws)
      const dir = (await nextText(inbox)) as DirectoryMessage
      expect(dir.channels.map((c) => c.name)).toEqual(['noise', 'meta', 'after'])
      expect(await nextText(inbox)).toEqual({
        type: 'static',
        id: 1,
        name: 'meta',
        data: { ok: 1 },
      })
      expect(await nextText(inbox)).toEqual({
        type: 'static',
        id: 2,
        name: 'after',
        data: { ok: true },
      })
      expect(inbox.closed).toBe(false)
      ws.close()
    })
  }

  test('late joiners get directory, then every static document, then retained frames', async () => {
    const dashboard = start()
    const chunk = prngBytes(8, 3)
    dashboard.attachByteStream('noise', fromItems(chunk))
    await new Promise((resolve) => setTimeout(resolve, 20)) // the pump retains the chunk
    // registered after the streaming channel, yet delivered before its frames
    dashboard.attachStatic('card', { type: 'rate-card', sectors: 4, rings: [1] })

    const inbox = new WsInbox(await openSocket(wsUrl(dashboard)))
    expect((await nextText(inbox)).type).toBe('directory')
    expect(await nextText(inbox)).toMatchObject({ type: 'static', name: 'card' })
    const frame = await inbox.next()
    if (typeof frame === 'string') throw new Error('expected the replayed binary frame')
    const decoded = decodeFrame(frame)
    if (decoded.kind !== 'bytes') throw new Error('wrong kind')
    expect(decoded.bytes).toEqual(chunk)
  })
})

describe('attach validation', () => {
  test('non-iterable sources and bad names throw invalid_channel without registering', () => {
    const dashboard = start()
    expect(codeOf(() => dashboard.attachByteStream('x', 42 as never))).toBe('invalid_channel')
    expect(codeOf(() => dashboard.attachSeries('x', {} as never))).toBe('invalid_channel')
    expect(codeOf(() => dashboard.attachMatrix(7 as never, fromItems()))).toBe('invalid_channel')
    dashboard.attachSeries('x', fromItems(1)) // the name was never taken
  })

  test('a sync iterable is accepted like for-await accepts it', async () => {
    const dashboard = start()
    const inbox = new WsInbox(await openSocket(wsUrl(dashboard)))
    await nextText(inbox)
    dashboard.attachSeries('arr', [4, 5] as unknown as AsyncIterable<number>)
    await nextText(inbox)
    const first = decodeFrame((await inbox.next()) as Uint8Array)
    if (first.kind !== 'series') throw new Error('wrong kind')
    expect(first.points[0]).toEqual({ t: 0, value: 4 })
  })
})

describe('matrix directory metadata', () => {
  test('range rides in the directory; a mutated reused label array is detected', async () => {
    const dashboard = start()
    const inbox = new WsInbox(await openSocket(wsUrl(dashboard)))
    await nextText(inbox)
    const labels = ['a', 'b']
    const frames = deferred()
    async function* producer(): AsyncGenerator<MatrixFrameInput> {
      yield { rows: 1, cols: 2, data: new Float32Array([1, 2]), colLabels: labels, range: [0, 10] }
      labels[1] = 'B' // same array object, new content
      yield { rows: 1, cols: 2, data: new Float32Array([3, 4]), colLabels: labels, range: [0, 10] }
      await frames.promise
    }
    dashboard.attachMatrix('bins', producer())
    await nextText(inbox) // attach
    const first = (await nextText(inbox)) as DirectoryMessage
    expect(first.channels[0]).toMatchObject({ colLabels: ['a', 'b'], range: [0, 10] })
    await inbox.next() // frame 1
    const second = (await nextText(inbox)) as DirectoryMessage
    expect(second.channels[0]?.colLabels).toEqual(['a', 'B'])
    frames.resolve()
  })

  test('an invalid range or non-string labels error the channel with a protocol reason', async () => {
    const dashboard = start()
    const inbox = new WsInbox(await openSocket(wsUrl(dashboard)))
    await nextText(inbox)
    const data = new Float32Array([1])
    dashboard.attachMatrix('r', fromItems({ rows: 1, cols: 1, data, range: [5, 5] as const }))
    await nextText(inbox)
    expect(((await nextText(inbox)) as DirectoryMessage).channels[0]?.error).toContain('range')
    dashboard.attachMatrix(
      'l',
      fromItems({ rows: 1, cols: 1, data, rowLabels: [1] as unknown as string[] }),
    )
    await nextText(inbox)
    expect(((await nextText(inbox)) as DirectoryMessage).channels[1]?.error).toContain('rowLabels')
    expect(reports.map(([, e]) => (e as VisualizerError).code)).toEqual(['protocol', 'protocol'])
  })
})

describe('stop()', () => {
  test('returns the consumed iterator eagerly, even while its next() is pending', async () => {
    const dashboard = start()
    const returned = deferred()
    const stuck: AsyncIterableIterator<Uint8Array> = {
      next: () => new Promise(() => {}),
      return: async () => {
        returned.resolve()
        return { done: true, value: undefined }
      },
      [Symbol.asyncIterator]: () => stuck,
    }
    dashboard.attachByteStream('stuck', stuck)
    const started = performance.now()
    await dashboard.stop()
    await returned.promise
    expect(performance.now() - started).toBeLessThan(1000)
    expect(reports).toHaveLength(0) // stopping is not a failure
  })

  test('a generator blocked in an await is released once the await settles; stop stays bounded', async () => {
    const dashboard = start()
    const gate = deferred()
    let finalized = false
    async function* device(): AsyncGenerator<Uint8Array> {
      try {
        yield prngBytes(4)
        await gate.promise // e.g. a device read that never returns
        yield prngBytes(4)
      } finally {
        finalized = true
      }
    }
    const inbox = new WsInbox(await openSocket(wsUrl(dashboard)))
    await nextText(inbox)
    dashboard.attachByteStream('device', device())
    await nextText(inbox)
    await inbox.next() // first chunk proves the pump is inside the generator
    const started = performance.now()
    await dashboard.stop()
    expect(performance.now() - started).toBeLessThan(1000)
    gate.resolve()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(finalized).toBe(true)
  })

  test('concurrent callers share one in-flight stop; clients get 1000', async () => {
    const dashboard = start()
    const ws = await openSocket(wsUrl(dashboard))
    const code = closed(ws)
    const a = dashboard.stop()
    const b = dashboard.stop()
    expect(a).toBe(b)
    await a
    expect(await code).toBe(1000)
  })

  test('removes the abort listener it added', async () => {
    const added: unknown[] = []
    const removed: unknown[] = []
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: unknown) => added.push(listener),
      removeEventListener: (_type: string, listener: unknown) => removed.push(listener),
    } as unknown as AbortSignal
    const dashboard = start({ signal })
    expect(added).toHaveLength(1)
    await dashboard.stop()
    expect(removed).toEqual(added)
  })

  test('aborting the signal stops the dashboard through the same promise', async () => {
    const controller = new AbortController()
    const dashboard = start({ signal: controller.signal })
    const ws = await openSocket(wsUrl(dashboard))
    const code = closed(ws)
    controller.abort()
    await dashboard.stop()
    expect(await code).toBe(1000)
    await expect(fetch(dashboard.url)).rejects.toThrow()
  })

  test('pumps stop pulling after stop()', async () => {
    const dashboard = start()
    const { src, release } = gatedSource([prngBytes(2)])
    let pulls = 0
    const counting: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => {
        const it = src[Symbol.asyncIterator]()
        return {
          next: () => {
            pulls++
            return it.next()
          },
          return: (value?: unknown) => it.return(value as undefined),
        }
      },
    }
    dashboard.attachByteStream('gated', counting)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const before = pulls
    const stopping = dashboard.stop()
    release()
    await stopping
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(pulls).toBe(before)
  })
})
