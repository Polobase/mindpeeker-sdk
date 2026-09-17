import { describe, expect, test } from 'bun:test'
import type { NodeSerialStream } from '@mindpeeker/entropy/node'
import { VisualizerError } from '../src/errors.js'
import {
  resolveSource,
  type SerialOpener,
  SOURCE_NAMES,
  serialProvider,
  sourceDescriptions,
} from '../src/sources.js'
import { prngBytes } from './helpers/streams.js'

describe('resolveSource', () => {
  test('lists every hardware and software source', () => {
    expect([...SOURCE_NAMES].sort()).toEqual(
      ['camera', 'crypto', 'esp32', 'hwrng', 'jitter', 'mic', 'serial'].sort(),
    )
  })

  test('crypto resolves and actually streams bytes', async () => {
    const { provider, note } = resolveSource('crypto')
    expect(provider.name).toBe('crypto')
    expect(note.length).toBeGreaterThan(0)
    const iterator = provider.stream({ chunkBytes: 32 })[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.done).toBe(false)
    expect(first.value).toBeInstanceOf(Uint8Array)
    expect((first.value as Uint8Array).length).toBe(32)
    await iterator.return?.(undefined)
  })

  test('esp32 and serial resolve lazily without opening a device', () => {
    // Building the provider must NOT touch hardware — only .stream() iteration does.
    const esp32 = resolveSource('esp32')
    expect(esp32.provider.name).toBe('esp32')
    expect(typeof esp32.provider.stream).toBe('function')
    expect(esp32.note).toContain('921600')

    const serial = resolveSource('serial', { serialPath: '/dev/ttyUSB7', baudRate: 115_200 })
    expect(serial.provider.name).toBe('serial')
    expect(serial.note).toContain('/dev/ttyUSB7')
    expect(serial.note).toContain('115200')
  })

  test('camera, mic, hwrng resolve to lazy providers', () => {
    for (const name of ['camera', 'mic', 'hwrng']) {
      const { provider, note } = resolveSource(name)
      expect(typeof provider.name).toBe('string')
      expect(provider.name.length).toBeGreaterThan(0)
      expect(typeof provider.stream).toBe('function')
      expect(note.length).toBeGreaterThan(0)
    }
  })

  test('microphone and csprng are accepted aliases', () => {
    expect(resolveSource('microphone').provider.name).toBe(resolveSource('mic').provider.name)
    expect(resolveSource('csprng').provider.name).toBe('crypto')
  })

  const optionsError = (fn: () => unknown): VisualizerError => {
    try {
      fn()
    } catch (error) {
      expect(error).toBeInstanceOf(VisualizerError)
      expect((error as VisualizerError).code).toBe('invalid_options')
      return error as VisualizerError
    }
    throw new Error('expected VisualizerError(invalid_options)')
  }

  test('an unknown source throws invalid_options naming the valid choices', () => {
    const error = optionsError(() => resolveSource('quantum-unicorn'))
    expect(error.message).toContain('crypto')
    expect(error.message).toContain('esp32')
    // prototype keys are not sources
    for (const name of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) {
      optionsError(() => resolveSource(name))
    }
  })

  test('malformed source options throw invalid_options', () => {
    for (const baudRate of [0, -9600, Number.NaN, 1.5, 2 ** 60]) {
      expect(optionsError(() => resolveSource('esp32', { baudRate })).message).toContain('baud')
    }
    optionsError(() => resolveSource('serial', { serialPath: '' }))
    optionsError(() => resolveSource('camera', { cameraDevice: 7 as unknown as string }))
    optionsError(() => resolveSource('crypto', { raw: 'yes' as unknown as boolean }))
  })

  test('the raw option is accepted for every source', () => {
    for (const name of SOURCE_NAMES) {
      expect(() => resolveSource(name, { raw: true })).not.toThrow()
    }
  })

  test('sourceDescriptions covers every source name', () => {
    const described = sourceDescriptions()
    expect(described.map((d) => d.name).sort()).toEqual([...SOURCE_NAMES].sort())
    for (const { describe } of described) expect(describe.length).toBeGreaterThan(0)
  })
})

describe('serialProvider', () => {
  /** A fake serial device: endless PRNG chunks (or a failure), counting close() calls. */
  function fakeDevice(failAfter?: number): { open: SerialOpener; closes: () => number } {
    let closes = 0
    const open: SerialOpener = async () => {
      async function* chunks(): AsyncGenerator<Uint8Array> {
        for (let i = 1; ; i++) {
          if (failAfter !== undefined && i > failAfter) throw new Error('device unplugged')
          yield prngBytes(512, i)
        }
      }
      const stream: NodeSerialStream = {
        [Symbol.asyncIterator]: () => chunks(),
        close: () => {
          closes++
        },
      }
      return stream
    }
    return { open, closes: () => closes }
  }

  test('closing the session with return() closes the device exactly once', async () => {
    const device = fakeDevice()
    const provider = serialProvider({ raw: true }, 'esp32', device.open)
    const iterator = provider.stream({ chunkBytes: 32 })[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.done).toBe(false)
    expect(device.closes()).toBe(0)
    await iterator.return?.(undefined)
    expect(device.closes()).toBe(1)
  })

  test('a failing device read still closes the device', async () => {
    const device = fakeDevice(2)
    const provider = serialProvider({ raw: true }, 'esp32', device.open)
    let failed = false
    try {
      for await (const _chunk of provider.stream({ chunkBytes: 32 })) {
        // drain until the fake device fails
      }
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
    expect(device.closes()).toBe(1)
  })

  test('each stream() session opens (and closes) its own device handle', async () => {
    const device = fakeDevice()
    const provider = serialProvider({ raw: true }, 'serial', device.open)
    for (let session = 0; session < 2; session++) {
      const iterator = provider.stream({ chunkBytes: 16 })[Symbol.asyncIterator]()
      await iterator.next()
      await iterator.return?.(undefined)
    }
    expect(device.closes()).toBe(2)
  })
})
