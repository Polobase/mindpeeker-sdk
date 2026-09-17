import { afterEach, describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { superRand } from '../../src/providers/superrand.js'
import { superRandErrorCode } from '../../src/providers/superrand-ws.js'
import { rejectedEntropyError, thrownEntropyError } from '../helpers/errors.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { echoScript, MockWebSocket } from '../helpers/mock-websocket.js'
import { providerContract } from '../helpers/provider-contract.js'

// Wire format live-verified 2026-07-07: request {request:'integer',min,max,count}
// (strict schema, count ≤ 256, no extra fields); REST response {res: number|number[], ...};
// WS response {status:'success',data:{res,...},signature} | {status:'error',error:{...}}, FIFO.

function superRandRestMock() {
  return mockFetch((req) => {
    const body = JSON.parse(req.body ?? '{}') as { count: number }
    return jsonResponse({
      res: Array.from({ length: body.count }, (_, i) => (i * 17) % 256),
      jobType: 'integer',
      attempts: 0,
      length: body.count,
    })
  })
}

function autoOpen() {
  // sockets created by the provider open on the next tick
  const timer = setInterval(() => {
    for (const socket of MockWebSocket.instances) {
      if (!socket.closed && socket.onopen) {
        const open = socket.onopen
        socket.onopen = null
        open()
      }
    }
  }, 1)
  return () => clearInterval(timer)
}

afterEach(() => MockWebSocket.reset())

providerContract(
  'superRand (REST getBytes / WS stream)',
  () => {
    echoScript()
    return superRand({
      apiKey: 'k',
      fetch: superRandRestMock().fetch,
      WebSocketCtor: MockWebSocket,
    })
  },
  { kind: 'trng', privacy: 'private', lengths: [1, 16, 600] },
)

describe('superRand REST', () => {
  test('requires a valid apiKey: missing, non-string, blank, control or non-ASCII values throw invalid_request', () => {
    const invalid: unknown[] = [
      undefined,
      '',
      42,
      '   ',
      'SECRET-TOKEN\n',
      'SECRET TOKEN',
      `SECRET${String.fromCodePoint(0x43a, 0x43b)}`,
      `SECRET${String.fromCodePoint(0)}`,
    ]
    for (const apiKey of invalid) {
      const error = thrownEntropyError(() => superRand({ apiKey } as never), 'invalid_request')
      expect(error.message).not.toContain('SECRET')
    }
    thrownEntropyError(() => superRand(undefined as never), 'invalid_request')
    // any printable-ASCII token is accepted
    expect(superRand({ apiKey: 'Ab-3_x.Z~9+/=' }).name).toBe('superrand')
  })

  test('POSTs an integer request with the key in the query string', async () => {
    const { fetch, calls } = superRandRestMock()
    const { bytes } = await superRand({ apiKey: 'secret', fetch }).getBytes(3)
    expect(bytes).toEqual(new Uint8Array([0, 17, 34]))
    const call = calls[0]
    expect(call?.url).toBe('https://api.super-rand.io/v1/?key=secret')
    expect(call?.method).toBe('POST')
    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      request: 'integer',
      min: 0,
      max: 255,
      count: 3,
    })
  })

  test('chunks across the 256-count cap', async () => {
    const { fetch, calls } = superRandRestMock()
    const { bytes } = await superRand({ apiKey: 'k', fetch }).getBytes(600)
    expect(bytes.length).toBe(600)
    expect(calls.map((c) => (JSON.parse(c.body ?? '{}') as { count: number }).count)).toEqual([
      256, 256, 88,
    ])
  })

  test('normalizes a scalar res (count 1 returns a bare number)', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ res: 42, jobType: 'integer', length: 1 }))
    const { bytes } = await superRand({ apiKey: 'k', fetch }).getBytes(1)
    expect(bytes).toEqual(new Uint8Array([42]))
  })

  test('maps a malformed res to bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ res: 'nope' }))
    const err = (await superRand({ apiKey: 'k', fetch })
      .getBytes(2)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })
})

describe('superRand WebSocket stream', () => {
  test('is lazy: no socket before the first pull', async () => {
    echoScript()
    const stop = autoOpen()
    try {
      const p = superRand({ apiKey: 'k', WebSocketCtor: MockWebSocket })
      const stream = p.stream({ chunkBytes: 4 })
      expect(MockWebSocket.instances).toHaveLength(0)
      const iter = stream[Symbol.asyncIterator]()
      const { value } = await iter.next()
      expect(MockWebSocket.instances).toHaveLength(1)
      expect(value).toEqual(new Uint8Array(4).fill(7))
      await iter.return?.()
    } finally {
      stop()
    }
  })

  test('reuses one connection, one FIFO request per pull', async () => {
    echoScript()
    const stop = autoOpen()
    try {
      const p = superRand({ apiKey: 'k', WebSocketCtor: MockWebSocket })
      const chunks: Uint8Array[] = []
      for await (const chunk of p.stream({ chunkBytes: 2 })) {
        chunks.push(chunk)
        if (chunks.length === 3) break
      }
      expect(MockWebSocket.instances).toHaveLength(1)
      const socket = MockWebSocket.latest()
      expect(socket.sent).toHaveLength(3)
      for (const sent of socket.sent) {
        expect(JSON.parse(sent)).toEqual({ request: 'integer', min: 0, max: 255, count: 2 })
      }
      expect(socket.url).toBe('wss://api.super-rand.io/v1/?key=k')
    } finally {
      stop()
    }
  })

  test('ignores unparseable frames and frames with no pending request', async () => {
    MockWebSocket.reset((socket, sent) => {
      const req = JSON.parse(sent) as { count: number }
      queueMicrotask(() => {
        socket.message('this is not json')
        socket.message({
          status: 'success',
          data: { res: new Array(req.count).fill(3), jobType: 'integer' },
        })
        // late frame with nothing pending anymore — must be ignored
        socket.message({ status: 'success', data: { res: [255, 255] } })
      })
    })
    MockWebSocket.autoOpen = true
    const p = superRand({ apiKey: 'k', WebSocketCtor: MockWebSocket })
    const iter = p.stream({ chunkBytes: 2 })[Symbol.asyncIterator]()
    const { value } = await iter.next()
    expect(value).toEqual(new Uint8Array([3, 3]))
    await iter.return?.()
  })

  test('a status:error frame fails the pull with bad_response', async () => {
    MockWebSocket.reset((socket) => {
      queueMicrotask(() =>
        socket.message({
          status: 'error',
          error: { code: 'INVALID_SCHEMA', message: 'Invalid Schema' },
        }),
      )
    })
    MockWebSocket.autoOpen = true
    const p = superRand({ apiKey: 'k', WebSocketCtor: MockWebSocket })
    const iter = p.stream({ chunkBytes: 2 })[Symbol.asyncIterator]()
    const err = (await iter.next().catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('bad_response')
    expect(err.message).toContain('INVALID_SCHEMA')
  })

  test('reconnects after an unclean drop and continues', async () => {
    let dropped = false
    MockWebSocket.reset((socket, sent) => {
      const req = JSON.parse(sent) as { count: number }
      queueMicrotask(() => {
        if (!dropped) {
          dropped = true
          socket.fail()
          return
        }
        socket.message({ status: 'success', data: { res: new Array(req.count).fill(9) } })
      })
    })
    MockWebSocket.autoOpen = true
    const stop = autoOpen()
    try {
      const p = superRand({ apiKey: 'k', WebSocketCtor: MockWebSocket, reconnectBaseDelayMs: 1 })
      const chunks: Uint8Array[] = []
      for await (const chunk of p.stream({ chunkBytes: 2 })) {
        chunks.push(chunk)
        if (chunks.length === 2) break
      }
      expect(chunks).toEqual([new Uint8Array([9, 9]), new Uint8Array([9, 9])])
      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2)
    } finally {
      stop()
    }
  })

  test('gives up after repeated connection failures', async () => {
    MockWebSocket.reset()
    // never open: every socket drops immediately
    const timer = setInterval(() => {
      for (const socket of MockWebSocket.instances) {
        if (!socket.closed) socket.fail()
      }
    }, 1)
    try {
      const p = superRand({ apiKey: 'k', WebSocketCtor: MockWebSocket, reconnectBaseDelayMs: 1 })
      const iter = p.stream({ chunkBytes: 2 })[Symbol.asyncIterator]()
      const err = (await iter.next().catch((e) => e)) as EntropyError
      expect(err).toBeInstanceOf(EntropyError)
      expect(err.code).toBe('network')
      expect(MockWebSocket.instances.length).toBe(4) // initial + 3 retries
    } finally {
      clearInterval(timer)
    }
  })

  test('closes the socket on consumer break', async () => {
    echoScript()
    const stop = autoOpen()
    try {
      const p = superRand({ apiKey: 'k', WebSocketCtor: MockWebSocket })
      for await (const _chunk of p.stream({ chunkBytes: 2 })) {
        break
      }
      expect(MockWebSocket.latest().closed).toBe(true)
    } finally {
      stop()
    }
  })

  test('an abort while the socket is CONNECTING ends the pull at once and closes the socket', async () => {
    MockWebSocket.reset() // sockets never open on their own
    const controller = new AbortController()
    const p = superRand({ apiKey: 'k', WebSocketCtor: MockWebSocket })
    const iter = p.stream({ chunkBytes: 2, signal: controller.signal })[Symbol.asyncIterator]()
    const pending = iter.next()
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    const started = Date.now()
    await rejectedEntropyError(pending, 'aborted')
    expect(Date.now() - started).toBeLessThan(500)
    expect(MockWebSocket.latest().closed).toBe(true)
  })

  test('a connect that never completes times out and is retried, then fails as network', async () => {
    MockWebSocket.reset()
    const p = superRand({
      apiKey: 'k',
      WebSocketCtor: MockWebSocket,
      connectTimeoutMs: 10,
      reconnectBaseDelayMs: 1,
    })
    const iter = p.stream({ chunkBytes: 2 })[Symbol.asyncIterator]()
    const err = await rejectedEntropyError(iter.next(), 'network')
    expect((err.cause as { code?: string }).code).toBe('timeout')
    expect(MockWebSocket.instances).toHaveLength(4)
    expect(MockWebSocket.instances.every((socket) => socket.closed)).toBe(true)
  })

  test('an abort during reconnect backoff surfaces as EntropyError aborted', async () => {
    MockWebSocket.reset()
    const timer = setInterval(() => {
      for (const socket of MockWebSocket.instances) if (!socket.closed) socket.fail()
    }, 1)
    try {
      const controller = new AbortController()
      const p = superRand({ apiKey: 'k', WebSocketCtor: MockWebSocket, reconnectBaseDelayMs: 5000 })
      const pending = p.stream({ signal: controller.signal })[Symbol.asyncIterator]().next()
      await new Promise((resolve) => setTimeout(resolve, 30))
      controller.abort()
      await rejectedEntropyError(pending, 'aborted')
    } finally {
      clearInterval(timer)
    }
  })

  test('no WebSocket implementation fails the first pull at once with invalid_request', async () => {
    const g = globalThis as { WebSocket?: unknown }
    const saved = g.WebSocket
    let p: ReturnType<typeof superRand>
    try {
      g.WebSocket = undefined
      p = superRand({ apiKey: 'k' })
    } finally {
      g.WebSocket = saved
    }
    const started = Date.now()
    await rejectedEntropyError(p.stream()[Symbol.asyncIterator]().next(), 'invalid_request')
    expect(Date.now() - started).toBeLessThan(200)
  })

  test('error frames map quota and key codes; they end the stream without reconnecting', async () => {
    for (const [code, expected] of [
      ['QUOTA_EXCEEDED', 'rate_limited'],
      ['INVALID_API_KEY', 'auth'],
      ['INVALID_COUNT_RANGE', 'bad_response'],
    ] as const) {
      MockWebSocket.reset((socket) => {
        queueMicrotask(() => socket.message({ status: 'error', error: { code, message: 'no' } }))
      })
      MockWebSocket.autoOpen = true
      const p = superRand({ apiKey: 'k', WebSocketCtor: MockWebSocket })
      await rejectedEntropyError(p.stream()[Symbol.asyncIterator]().next(), expected)
      expect(MockWebSocket.instances).toHaveLength(1)
    }
  })
})

describe('superRand error mapping and key redaction', () => {
  test('superRandErrorCode', () => {
    expect(superRandErrorCode('DAILY_QUOTA_EXCEEDED')).toBe('rate_limited')
    expect(superRandErrorCode('RATE_LIMITED')).toBe('rate_limited')
    expect(superRandErrorCode('INVALID_API_KEY')).toBe('auth')
    expect(superRandErrorCode('UNAUTHORIZED')).toBe('auth')
    expect(superRandErrorCode('INVALID_SCHEMA')).toBe('bad_response')
    expect(superRandErrorCode(undefined)).toBe('bad_response')
  })

  test('REST error bodies map by SuperRand code', async () => {
    const forbidden = mockFetch(
      () =>
        new Response(JSON.stringify({ status: 'error', error: { code: 'INVALID_API_KEY' } }), {
          status: 403,
        }),
    )
    await rejectedEntropyError(
      superRand({ apiKey: 'k', fetch: forbidden.fetch }).getBytes(2),
      'auth',
    )
    const quota = mockFetch(() =>
      jsonResponse({ status: 'error', error: { code: 'QUOTA_EXCEEDED', message: 'daily' } }),
    )
    await rejectedEntropyError(
      superRand({ apiKey: 'k', fetch: quota.fetch }).getBytes(2),
      'rate_limited',
    )
  })

  test('the query-string key never appears in network or parse error messages', async () => {
    const key = 'SECRET-KEY-123'
    const failing = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch
    const network = await rejectedEntropyError(
      superRand({ apiKey: key, fetch: failing }).getBytes(4),
      'network',
    )
    expect(network.message).not.toContain(key)
    expect(network.message).toContain('https://api.super-rand.io/v1/?…')
    const html = mockFetch(() => new Response('<html>cloudflare</html>', { status: 200 }))
    const parse = await rejectedEntropyError(
      superRand({ apiKey: key, fetch: html.fetch }).getBytes(4),
      'bad_response',
    )
    expect(parse.message).not.toContain(key)
    const echoed = mockFetch(() => new Response(`bad key ${key}`, { status: 500 }))
    const status = await rejectedEntropyError(
      superRand({ apiKey: key, fetch: echoed.fetch }).getBytes(4),
      'network',
    )
    expect(status.message).not.toContain(key)
  })
})
