import { afterEach, describe, expect, test } from 'bun:test'
import { VisualizerError } from '../../src/errors.js'
import { decodeFrame, parseTextMessage } from '../../src/protocol.js'
import { createDashboard } from '../../src/server/dashboard.js'
import type { Dashboard, DirectoryMessage, SeriesSample, StaticMessage } from '../../src/types.js'
import { fromItems, gatedSource, openSocket, prngBytes, WsInbox } from '../helpers/streams.js'

const running: Dashboard[] = []

function start(opts: Parameters<typeof createDashboard>[0] = {}): Dashboard {
  const dashboard = createDashboard({ port: 0, ...opts })
  running.push(dashboard)
  return dashboard
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.stop()
})

async function nextText(inbox: WsInbox): Promise<DirectoryMessage | StaticMessage> {
  const msg = await inbox.next()
  if (typeof msg !== 'string') throw new Error('expected a text frame')
  return parseTextMessage(msg)
}

async function nextBinary(inbox: WsInbox): Promise<Uint8Array> {
  const msg = await inbox.next()
  if (typeof msg === 'string') throw new Error(`expected a binary frame, got: ${msg}`)
  return msg
}

describe('createDashboard', () => {
  test('binds a real port and serves the index page', async () => {
    const dashboard = start()
    expect(dashboard.port).toBeGreaterThan(0)
    expect(dashboard.url).toBe(`http://localhost:${dashboard.port}/`)
    const res = await fetch(dashboard.url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect((await res.text()).toLowerCase()).toContain('visualizer')
  })

  test('unknown paths 404', async () => {
    const dashboard = start()
    expect((await fetch(`${dashboard.url}nope`)).status).toBe(404)
  })

  test('sends the directory on connect, updates it on attach', async () => {
    const dashboard = start()
    const ws = await openSocket(`${dashboard.url.replace('http', 'ws')}ws`)
    const inbox = new WsInbox(ws)

    const empty = await nextText(inbox)
    expect(empty).toEqual({ type: 'directory', version: 1, channels: [] })

    dashboard.attachStatic('meta', { hello: 1 })
    const updated = (await nextText(inbox)) as DirectoryMessage
    expect(updated.type).toBe('directory')
    expect(updated.channels).toHaveLength(1)
    expect(updated.channels[0]).toMatchObject({ name: 'meta', kind: 'static', status: 'live' })

    const stat = (await nextText(inbox)) as StaticMessage
    expect(stat).toMatchObject({ type: 'static', name: 'meta', data: { hello: 1 } })
    ws.close()
  })

  test('streams byte frames that decode to the source chunks, then marks ended', async () => {
    const dashboard = start()
    const ws = await openSocket(`${dashboard.url.replace('http', 'ws')}ws`)
    const inbox = new WsInbox(ws)
    await nextText(inbox) // empty directory

    const chunkA = prngBytes(64, 1)
    const chunkB = prngBytes(32, 2)
    dashboard.attachByteStream('noise', fromItems(chunkA, chunkB))

    const dir = (await nextText(inbox)) as DirectoryMessage
    const id = dir.channels[0]?.id as number
    expect(dir.channels[0]?.kind).toBe('bytes')

    const first = decodeFrame(await nextBinary(inbox))
    if (first.kind !== 'bytes') throw new Error('wrong kind')
    expect(first.channelId).toBe(id)
    expect(first.bytes).toEqual(chunkA)
    const second = decodeFrame(await nextBinary(inbox))
    if (second.kind !== 'bytes') throw new Error('wrong kind')
    expect(second.bytes).toEqual(chunkB)

    const ended = (await nextText(inbox)) as DirectoryMessage
    expect(ended.channels[0]?.status).toBe('ended')
    ws.close()
  })

  test('series samples normalize to points (auto-t for bare numbers)', async () => {
    const dashboard = start()
    const ws = await openSocket(`${dashboard.url.replace('http', 'ws')}ws`)
    const inbox = new WsInbox(ws)
    await nextText(inbox)

    dashboard.attachSeries('z', fromItems<SeriesSample>(1.5, { t: 9, value: 2, band: [1, 3] }))
    await nextText(inbox) // directory update

    const p0 = decodeFrame(await nextBinary(inbox))
    if (p0.kind !== 'series') throw new Error('wrong kind')
    expect(p0.points[0]).toEqual({ t: 0, value: 1.5 })
    const p1 = decodeFrame(await nextBinary(inbox))
    if (p1.kind !== 'series') throw new Error('wrong kind')
    expect(p1.points[0]).toEqual({ t: 9, value: 2, band: [1, 3] })
    ws.close()
  })

  test('matrix frames carry data; labels ride in the directory', async () => {
    const dashboard = start()
    const ws = await openSocket(`${dashboard.url.replace('http', 'ws')}ws`)
    const inbox = new WsInbox(ws)
    await nextText(inbox)

    const data = new Float32Array([1, 2, 3])
    dashboard.attachMatrix(
      'bins',
      fromItems({ rows: 1, cols: 3, data, colLabels: ['a', 'b', 'c'] }),
    )
    await nextText(inbox) // attach directory
    const labeled = (await nextText(inbox)) as DirectoryMessage // labels update
    expect(labeled.channels[0]?.colLabels).toEqual(['a', 'b', 'c'])

    const frame = decodeFrame(await nextBinary(inbox))
    if (frame.kind !== 'matrix') throw new Error('wrong kind')
    expect(frame.rows).toBe(1)
    expect(frame.cols).toBe(3)
    expect(frame.data).toEqual(data)
    ws.close()
  })

  test('replays the ring buffer to late joiners, oldest first', async () => {
    const dashboard = start({ ringCapacity: 2 })
    const chunks = [prngBytes(8, 1), prngBytes(8, 2), prngBytes(8, 3)]
    const { src, release } = gatedSource(chunks)
    dashboard.attachByteStream('noise', src)

    // First client observes all three frames, proving the producer ran.
    const ws1 = await openSocket(`${dashboard.url.replace('http', 'ws')}ws`)
    const inbox1 = new WsInbox(ws1)
    await nextText(inbox1)
    // ring capacity 2 → replay is the last ≤2 frames; drain what arrives live
    const seen: Uint8Array[] = []
    for (let i = 0; i < 2; i++) {
      const decoded = decodeFrame(await nextBinary(inbox1))
      if (decoded.kind !== 'bytes') throw new Error('wrong kind')
      seen.push(decoded.bytes)
    }
    expect(seen).toEqual([chunks[1], chunks[2]] as Uint8Array[])

    // Late joiner: gets directory then exactly the retained 2 frames.
    const ws2 = await openSocket(`${dashboard.url.replace('http', 'ws')}ws`)
    const inbox2 = new WsInbox(ws2)
    await nextText(inbox2)
    const replay0 = decodeFrame(await nextBinary(inbox2))
    const replay1 = decodeFrame(await nextBinary(inbox2))
    if (replay0.kind !== 'bytes' || replay1.kind !== 'bytes') throw new Error('wrong kind')
    expect(replay0.bytes).toEqual(chunks[1] as Uint8Array)
    expect(replay1.bytes).toEqual(chunks[2] as Uint8Array)

    release()
    ws1.close()
    ws2.close()
  })

  test('rejects duplicate and empty channel names', () => {
    const dashboard = start()
    dashboard.attachStatic('meta', {})
    expect(() => dashboard.attachStatic('meta', {})).toThrow(VisualizerError)
    try {
      dashboard.attachStatic('meta', {})
    } catch (error) {
      expect((error as VisualizerError).code).toBe('invalid_channel')
    }
    expect(() => dashboard.attachStatic('', {})).toThrow(VisualizerError)
  })

  test('rejects invalid ring capacities', () => {
    expect(() => createDashboard({ port: 0, ringCapacity: 0 })).toThrow(VisualizerError)
  })

  test('stop() closes sockets cleanly and refuses further attaches', async () => {
    const dashboard = start()
    const ws = await openSocket(`${dashboard.url.replace('http', 'ws')}ws`)
    const inbox = new WsInbox(ws)
    await nextText(inbox)

    const closed = new Promise<number>((resolve) => {
      ws.addEventListener('close', (event) => resolve((event as CloseEvent).code))
    })
    await dashboard.stop()
    expect(await closed).toBe(1000)

    expect(() => dashboard.attachStatic('late', {})).toThrow(VisualizerError)
    try {
      dashboard.attachStatic('late', {})
    } catch (error) {
      expect((error as VisualizerError).code).toBe('server')
    }
    expect(fetch(dashboard.url)).rejects.toThrow()
    await dashboard.stop() // idempotent
  })

  test('an aborted signal stops the dashboard', async () => {
    const controller = new AbortController()
    const dashboard = start({ signal: controller.signal })
    const res = await fetch(dashboard.url)
    expect(res.status).toBe(200)
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetch(dashboard.url)).rejects.toThrow()
  })

  test('a pre-aborted signal refuses to start', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => createDashboard({ port: 0, signal: controller.signal })).toThrow(VisualizerError)
  })

  test('a throwing source marks its channel errored, not the server', async () => {
    const dashboard = start()
    const ws = await openSocket(`${dashboard.url.replace('http', 'ws')}ws`)
    const inbox = new WsInbox(ws)
    await nextText(inbox)

    async function* failing(): AsyncGenerator<Uint8Array> {
      yield prngBytes(4)
      throw new Error('source exploded')
    }
    dashboard.attachByteStream('flaky', failing())
    await nextText(inbox) // attach directory
    await nextBinary(inbox) // the one good frame
    const errored = (await nextText(inbox)) as DirectoryMessage
    expect(errored.channels[0]?.status).toBe('error')

    // server still healthy
    expect((await fetch(dashboard.url)).status).toBe(200)
    ws.close()
  })
})
