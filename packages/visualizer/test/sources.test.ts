import { describe, expect, test } from 'bun:test'
import { resolveSource, SOURCE_NAMES, sourceDescriptions } from '../src/sources.js'

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

  test('an unknown source throws RangeError naming the valid choices', () => {
    expect(() => resolveSource('quantum-unicorn')).toThrow(RangeError)
    try {
      resolveSource('quantum-unicorn')
    } catch (err) {
      expect((err as Error).message).toContain('crypto')
      expect((err as Error).message).toContain('esp32')
    }
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
