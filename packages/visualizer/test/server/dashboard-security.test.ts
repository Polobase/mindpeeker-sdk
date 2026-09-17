import { afterEach, describe, expect, test } from 'bun:test'
import type { VisualizerError } from '../../src/errors.js'
import { createDashboard } from '../../src/server/dashboard.js'
import type { Dashboard } from '../../src/types.js'
import { closed, openSocket, WsInbox } from '../helpers/streams.js'

const running: Dashboard[] = []

function start(opts: Parameters<typeof createDashboard>[0] = {}): Dashboard {
  const dashboard = createDashboard({ port: 0, ...opts })
  running.push(dashboard)
  return dashboard
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.stop()
})

const wsUrl = (dashboard: Dashboard) => `${dashboard.url.replace('http', 'ws')}ws`

/** 'open' when the handshake succeeds, 'refused' when the server rejects it. */
async function handshake(
  url: string,
  headers: Record<string, string>,
): Promise<'open' | 'refused'> {
  try {
    const ws = await openSocket(url, headers)
    ws.close()
    return 'open'
  } catch {
    return 'refused'
  }
}

describe('WebSocket handshake policy', () => {
  test('a cross-site Origin is refused with 403; same-host and header-less clients connect', async () => {
    const dashboard = start()
    const url = wsUrl(dashboard)
    expect(await handshake(url, { Origin: 'https://evil.example' })).toBe('refused')
    expect(await handshake(url, { Origin: `http://localhost:${dashboard.port}` })).toBe('open')
    expect(await handshake(url, {})).toBe('open')
    const res = await fetch(url.replace('ws', 'http'), {
      headers: { Origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
  })

  test('allowedOrigins admits a listed origin', async () => {
    const dashboard = start({ allowedOrigins: ['https://lab.example'] })
    expect(await handshake(wsUrl(dashboard), { Origin: 'https://lab.example' })).toBe('open')
    expect(await handshake(wsUrl(dashboard), { Origin: 'https://other.example' })).toBe('refused')
  })

  test('a DNS-rebinding Host on the loopback bind is refused', async () => {
    const dashboard = start()
    const host = `evil.example:${dashboard.port}`
    expect(await handshake(wsUrl(dashboard), { Host: host, Origin: `http://${host}` })).toBe(
      'refused',
    )
  })

  test('the socket is send-only: an inbound message closes it with 1003', async () => {
    const dashboard = start()
    const ws = await openSocket(wsUrl(dashboard))
    const inbox = new WsInbox(ws)
    await inbox.next() // directory
    const code = closed(ws)
    ws.send('hello')
    expect(await code).toBe(1003)
  })

  test('an inbound message above 1 KiB is refused by the runtime', async () => {
    const dashboard = start()
    const ws = await openSocket(wsUrl(dashboard))
    const code = closed(ws)
    ws.send('x'.repeat(4096))
    expect(await code).not.toBe(1000)
    // the server itself keeps serving
    expect(await handshake(wsUrl(dashboard), {})).toBe('open')
  })
})

describe('client assets', () => {
  test('index.html and the bundle are served with Cache-Control: no-cache', async () => {
    const dashboard = start()
    const index = await fetch(dashboard.url)
    expect(index.status).toBe(200)
    expect(index.headers.get('cache-control')).toBe('no-cache')
    for (const path of ['app.js', 'app.js.map']) {
      const res = await fetch(`${dashboard.url}${path}`)
      expect(res.headers.get('cache-control')).toBe('no-cache')
      // 200 once `bun run build` produced the bundle; 404 'not built' before — never 'not found'
      expect([200, 404]).toContain(res.status)
      if (res.status === 404) expect(await res.text()).toBe('not built')
      else await res.arrayBuffer()
    }
  })

  test('the source map is JSON when the bundle is built', async () => {
    const dashboard = start()
    const res = await fetch(`${dashboard.url}app.js.map`)
    if (res.status !== 200) return // not built in this checkout
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()) as { version: number }).toMatchObject({ version: 3 })
  })
})

describe('IPv6 hosts', () => {
  test('Dashboard.url brackets an IPv6 literal', async () => {
    let dashboard: Dashboard
    try {
      dashboard = start({ host: '::1' })
    } catch (error) {
      // a runner without IPv6 loopback cannot bind; the formatting is covered by security.test.ts
      expect((error as VisualizerError).code).toBe('server')
      return
    }
    expect(dashboard.url).toBe(`http://[::1]:${dashboard.port}/`)
    expect((await fetch(dashboard.url)).status).toBe(200)
  })
})
