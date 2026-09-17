import { describe, expect, test } from 'bun:test'
import type { SerialPortLike } from '../../src/providers/serial.js'
import {
  ONERNG_COMMANDS,
  ONERNG_RAW_MIN_ENTROPY_PER_SAMPLE,
  onerng,
  TRUERNG_KNOCK_BAUD_RATES,
  TRUERNG_MODES,
  truerng,
} from '../../src/providers/serial-presets.js'
import { thrownEntropyError } from '../helpers/errors.js'

/** A serial port that serves PRNG bytes and records every open/close/write/setSignals. */
class RecordingPort implements SerialPortLike {
  events: string[] = []
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null

  constructor() {
    let state = 0x12345678
    this.readable = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        const chunk = new Uint8Array(256)
        for (let i = 0; i < chunk.length; i++) {
          state ^= state << 13
          state ^= state >>> 17
          state ^= state << 5
          state >>>= 0
          chunk[i] = state & 0xff
        }
        controller.enqueue(chunk)
      },
    })
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.events.push(`write ${new TextDecoder().decode(chunk)}`)
      },
    })
  }

  async open(options: { baudRate: number }): Promise<void> {
    this.events.push(`open ${options.baudRate}`)
  }

  async close(): Promise<void> {
    this.events.push('close')
  }

  async setSignals(signals: { dataTerminalReady?: boolean }): Promise<void> {
    this.events.push(`dtr ${signals.dataTerminalReady}`)
  }
}

describe('TRUERNG_MODES', () => {
  test('carries the vendor baud-rate table', () => {
    expect(
      Object.fromEntries(
        Object.entries(TRUERNG_MODES).map(([mode, info]) => [mode, info.baudRate]),
      ),
    ).toEqual({
      normal: 300,
      psuDebug: 1200,
      rngDebug: 2400,
      rng1: 4800,
      rng2: 9600,
      rawBinary: 19200,
      rawAscii: 38400,
    })
    expect(TRUERNG_KNOCK_BAUD_RATES).toEqual([110, 300, 110])
  })
})

describe('truerng', () => {
  test('knocks 110 → 300 → 110, opens at the mode baud rate and asserts DTR', async () => {
    const port = new RecordingPort()
    const p = truerng({ port, mode: 'rng2', conditioning: 'raw' })
    expect(p.name).toBe('truerng(rng2)(raw)')
    await p.getBytes(8)
    expect(port.events.slice(0, 8)).toEqual([
      'open 110',
      'close',
      'open 300',
      'close',
      'open 110',
      'close',
      'open 9600',
      'dtr true',
    ])
    expect(port.events.at(-1)).toBe('close')
  })

  test('defaults to normal mode named truerng', () => {
    expect(truerng({ port: new RecordingPort() }).name).toBe('truerng')
  })

  test('rejects non-byte-stream modes, unknown modes and a missing port', () => {
    for (const mode of ['rawBinary', 'rawAscii', 'psuDebug', 'turbo']) {
      thrownEntropyError(
        () => truerng({ port: new RecordingPort(), mode: mode as never }),
        'invalid_request',
      )
    }
    thrownEntropyError(() => truerng({} as never), 'invalid_request')
  })
})

describe('onerng', () => {
  test('selects the mode, flushes and switches the feed on after open; feed off before close', async () => {
    const port = new RecordingPort()
    const p = onerng({ port, mode: 'rfRaw', conditioning: 'raw' })
    expect(p.name).toBe('onerng(rfRaw)(raw)')
    await p.getBytes(8)
    expect(port.events[0]).toBe('open 921600')
    expect(port.events[1]).toBe(
      `write ${ONERNG_COMMANDS.rfRaw}${ONERNG_COMMANDS.flush}${ONERNG_COMMANDS.feedOn}`,
    )
    expect(port.events.slice(-2)).toEqual([`write ${ONERNG_COMMANDS.feedOff}`, 'close'])
  })

  test('commands follow the vendor table', () => {
    expect(ONERNG_COMMANDS).toEqual({
      avalanche: 'cmd0',
      avalancheRaw: 'cmd1',
      avalancheRf: 'cmd2',
      avalancheRfRaw: 'cmd3',
      noNoise: 'cmd4',
      rf: 'cmd6',
      rfRaw: 'cmd7',
      feedOn: 'cmdO',
      feedOff: 'cmdo',
      flush: 'cmdw',
    })
    expect(ONERNG_RAW_MIN_ENTROPY_PER_SAMPLE).toBe(4)
  })

  test('raw modes are credited conservatively: a bigger block per output than whitened modes', async () => {
    // Count raw bytes read for 40 conditioned 32-byte blocks (7 b/B: 74 B per block, 4 b/B: 128).
    async function rawBytesFor(mode: 'avalanche' | 'avalancheRaw'): Promise<number> {
      let consumed = 0
      const port = new RecordingPort()
      const readable = port.readable as ReadableStream<Uint8Array>
      const reader = readable.getReader()
      port.readable = new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          const { value } = await reader.read()
          if (value) {
            consumed += value.length
            controller.enqueue(value)
          }
        },
      })
      await onerng({ port, mode, warmupBytes: 0 }).getBytes(1280)
      return consumed
    }
    expect(await rawBytesFor('avalancheRaw')).toBeGreaterThan(await rawBytesFor('avalanche'))
  })

  test('rejects the no-noise command, unknown modes and a missing port', () => {
    for (const mode of ['noNoise', 'feedOn', 'loud']) {
      thrownEntropyError(
        () => onerng({ port: new RecordingPort(), mode: mode as never }),
        'invalid_request',
      )
    }
    thrownEntropyError(() => onerng({} as never), 'invalid_request')
  })
})
