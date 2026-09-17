import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { type SerialPortLike, serialEntropy } from '../../src/providers/serial.js'
import { providerContract } from '../helpers/provider-contract.js'

/** Endless deterministic byte counter, as chunks of `size` (default 64). */
async function* countingBytes(size = 64): AsyncGenerator<Uint8Array> {
  let counter = 0
  while (true) {
    const chunk = new Uint8Array(size)
    for (let i = 0; i < chunk.length; i++) chunk[i] = counter++ & 0xff
    yield chunk
  }
}

/** PRNG chunks for contract runs (counting bytes would be too regular for stats). */
async function* prngBytes(): AsyncGenerator<Uint8Array> {
  let state = 0xcafebabe
  while (true) {
    const chunk = new Uint8Array(64)
    for (let i = 0; i < chunk.length; i++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      chunk[i] = state & 0xff
    }
    yield chunk
  }
}

class MockSerialPort implements SerialPortLike {
  openedWith: { baudRate: number } | undefined
  closed = false
  written: Uint8Array[] = []
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null

  constructor(generator: () => AsyncGenerator<Uint8Array> = prngBytes) {
    const iter = generator()
    this.readable = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const { value } = await iter.next()
        if (value) controller.enqueue(value)
      },
    })
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.written.push(chunk)
      },
    })
  }

  async open(options: { baudRate: number }): Promise<void> {
    this.openedWith = options
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

providerContract('serialEntropy (injected source)', () => serialEntropy({ source: prngBytes() }), {
  kind: 'trng',
  privacy: 'private',
  lengths: [1, 16, 100],
})

describe('serialEntropy', () => {
  test('requires exactly one of port | source (invalid_request)', () => {
    expect(() => serialEntropy({} as never)).toThrow(EntropyError)
    expect(() => serialEntropy({ port: new MockSerialPort(), source: prngBytes() })).toThrow(
      EntropyError,
    )
  })

  test('init requires a port', () => {
    expect(() => serialEntropy({ source: prngBytes(), init: new Uint8Array([1]) })).toThrow(
      EntropyError,
    )
  })

  test('validates baudRate, warmupBytes, name and conditioning options', () => {
    const bad: Record<string, unknown>[] = [
      { baudRate: 0 },
      { baudRate: 9600.5 },
      { warmupBytes: -1 },
      { name: '' },
      { safetyFactor: 0 },
      { minEntropyPerSample: Number.POSITIVE_INFINITY },
      { maxHealthFailures: 0 },
    ]
    for (const opts of bad) {
      expect(() => serialEntropy({ source: prngBytes(), ...opts })).toThrow(EntropyError)
    }
  })

  test('defaults: name serial, kind trng, ESP32 baud rate', async () => {
    const port = new MockSerialPort()
    const p = serialEntropy({ port })
    expect(p.name).toBe('serial')
    expect(p.kind).toBe('trng')
    await p.getBytes(16)
    expect(port.openedWith).toEqual({ baudRate: 921_600 })
  })

  test('opens, optionally writes init, and closes the port per session', async () => {
    const port = new MockSerialPort()
    const init = new Uint8Array([0x63, 0x6d, 0x64]) // e.g. a OneRNG-style command
    await serialEntropy({ port, init, baudRate: 115_200 }).getBytes(16)
    expect(port.openedWith).toEqual({ baudRate: 115_200 })
    expect(port.written).toEqual([init])
    expect(port.closed).toBe(true)
  })

  test('raw mode discards warmup bytes then passes device bytes through', async () => {
    const p = serialEntropy({
      source: countingBytes(),
      name: 'esp32',
      conditioning: 'raw',
      warmupBytes: 256,
    })
    expect(p.name).toBe('esp32(raw)')
    const { bytes, sources } = await p.getBytes(8)
    // counting sequence: after 256 warmup bytes, values continue at 256 & 0xff = 0
    expect(bytes).toEqual(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))
    expect(sources[0]?.name).toBe('esp32(raw)')
  })

  test('warmupBytes can span multiple chunks and be zero', async () => {
    const zero = serialEntropy({ source: countingBytes(), conditioning: 'raw', warmupBytes: 0 })
    expect((await zero.getBytes(2)).bytes).toEqual(new Uint8Array([0, 1]))

    const spanning = serialEntropy({
      source: countingBytes(),
      conditioning: 'raw',
      warmupBytes: 100,
    })
    expect((await spanning.getBytes(2)).bytes).toEqual(new Uint8Array([100, 101]))
  })

  test('an injected source survives multiple getBytes calls', async () => {
    const p = serialEntropy({ source: countingBytes(60), conditioning: 'raw', warmupBytes: 0 })
    expect((await p.getBytes(2)).bytes).toEqual(new Uint8Array([0, 1]))
    // each session health-tests 1024 samples before releasing any: 18 chunks
    // of 60 (1080 bytes) are consumed, the unread rest is discarded, and the
    // next session continues with the following device chunk
    expect((await p.getBytes(2)).bytes).toEqual(new Uint8Array([1080 & 0xff, 1081 & 0xff]))
  })

  test('warmup applies once for a persistent injected source', async () => {
    const p = serialEntropy({ source: countingBytes(60), conditioning: 'raw', warmupBytes: 60 })
    expect((await p.getBytes(2)).bytes).toEqual(new Uint8Array([60, 61]))
    expect((await p.getBytes(2)).bytes).toEqual(new Uint8Array([1140 & 0xff, 1141 & 0xff]))
  })

  test('a mid-stream device error surfaces as network with the original cause', async () => {
    const eio = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' })
    async function* unplugged(): AsyncGenerator<Uint8Array> {
      yield* (async function* () {
        let n = 0
        for await (const chunk of prngBytes()) {
          yield chunk
          if (++n === 4) break
        }
      })()
      throw eio
    }
    const err = (await serialEntropy({ source: unplugged(), warmupBytes: 0 })
      .getBytes(32)
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('network')
    expect(err.cause).toBe(eio)
  })

  test('name option labels attribution for conditioned mode too', async () => {
    const p = serialEntropy({ source: prngBytes(), name: 'truerng' })
    const { sources } = await p.getBytes(8)
    expect(sources[0]?.name).toBe('truerng')
  })
})
