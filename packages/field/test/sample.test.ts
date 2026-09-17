import { describe, expect, test } from 'bun:test'
import { bitReader, byteReader, OracleError } from '@mindpeeker/oracle'
import { FieldError, toFieldError } from '../src/errors.js'
import { sampleField, samplePoint } from '../src/field/sample.js'
import type { FieldRegion } from '../src/types.js'
import { prngBytes, prngSource, trackedSource } from './helpers/byte-sources.js'

const RECT: FieldRegion = { kind: 'rect', width: 100, height: 80 }
const DISK: FieldRegion = { kind: 'disk', radius: 50 }

describe('sampleField', () => {
  test('is deterministic and returns the requested count with a receipt', async () => {
    const bytes = prngBytes(4000, 0x1234)
    const a = await sampleField(bytes, 100, RECT)
    const b = await sampleField(bytes, 100, RECT)
    expect(a.points.length).toBe(100)
    expect(a.points).toEqual(b.points)
    expect(a.accounting.bytesConsumed).toBe(800)
    expect(a.accounting.bitsUsed).toBe(100 * 2 * 32) // 2 coords × 32 bits each
    expect(a.accounting.bytesFetched).toBe(800)
  })

  test('coordinates are the big-endian 32-bit fractions of the input bytes', async () => {
    const bytes = new Uint8Array([0x80, 0, 0, 0, 0x40, 0, 0, 1])
    const { points } = await sampleField(bytes, 1, { kind: 'rect', width: 2, height: 4 })
    expect(points[0]).toEqual({ x: 1, y: 4 * (0x40000001 / 2 ** 32) })
    // samplePoint over a bit reader gives the same point
    const viaBits = await samplePoint(bitReader(byteReader(bytes)), {
      kind: 'rect',
      width: 2,
      height: 4,
    })
    expect(viaBits).toEqual(points[0] as { x: number; y: number })
  })

  test('rect points land inside the region', async () => {
    const { points } = await sampleField(prngSource('u', 1), 2000, RECT)
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThan(100)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThan(80)
    }
  })

  test('disk points land inside the disk and fill it area-uniformly', async () => {
    const { points } = await sampleField(prngSource('u', 2), 4000, DISK)
    let innerHalf = 0 // fraction within r/√2 should be ≈ ½ for area-uniform sampling
    for (const p of points) {
      const d = Math.hypot(p.x, p.y)
      expect(d).toBeLessThanOrEqual(50 + 1e-9)
      if (d <= 50 / Math.SQRT2) innerHalf++
    }
    expect(innerHalf / points.length).toBeGreaterThan(0.45)
    expect(innerHalf / points.length).toBeLessThan(0.55)
  })

  test('is marginally uniform (mean ≈ centre)', async () => {
    const { points } = await sampleField(prngSource('u', 3), 5000, RECT)
    const mx = points.reduce((a, p) => a + p.x, 0) / points.length
    const my = points.reduce((a, p) => a + p.y, 0) / points.length
    expect(Math.abs(mx - 50)).toBeLessThan(2)
    expect(Math.abs(my - 40)).toBeLessThan(2)
  })

  test('a shared ByteReader advances across calls and stays open', async () => {
    const reader = byteReader(prngBytes(1600, 9))
    const a = await sampleField(reader, 100, RECT)
    const b = await sampleField(reader, 100, RECT)
    expect(reader.bytesConsumed).toBe(1600)
    expect(a.points).not.toEqual(b.points)
    await expect(reader.next()).rejects.toMatchObject({ code: 'insufficient_entropy' })
  })

  test('closes the stream it opened (resolve and reject paths)', async () => {
    const ok = trackedSource()
    await sampleField(ok, 10, RECT)
    expect(ok.streams).toBe(1)
    expect(ok.released).toBe(1)
    const failing = trackedSource()
    const controller = new AbortController()
    const run = sampleField(failing, 1_000_000, RECT, { signal: controller.signal })
    controller.abort()
    await expect(run).rejects.toMatchObject({ code: 'aborted' })
    expect(failing.released).toBe(failing.streams)
  })

  test('validation and entropy exhaustion', async () => {
    await expect(sampleField(prngBytes(100), 0, RECT)).rejects.toMatchObject({
      code: 'invalid_config',
    })
    await expect(
      sampleField(prngBytes(100), 5, { kind: 'rect', width: 0, height: 10 } as FieldRegion),
    ).rejects.toMatchObject({ code: 'invalid_config' })
    await expect(
      sampleField(prngBytes(100), 5, { kind: 'ring' } as unknown as FieldRegion),
    ).rejects.toMatchObject({ code: 'invalid_config' })
    // a finite buffer too small for the field keeps the oracle's code
    await expect(sampleField(prngBytes(8), 100, RECT)).rejects.toMatchObject({
      code: 'insufficient_entropy',
    })
  })

  test('non-byte inputs map to invalid_config, never a raw OracleError', async () => {
    const bad: unknown[] = [
      new Float32Array(1000).fill(0.5),
      [1, 2, 300, 4, 5, 6, 7, 8],
      42,
      {
        name: 'bad',
        async *stream() {
          yield [1, 2, 3]
        },
      },
    ]
    for (const input of bad) {
      const error = await sampleField(input as Uint8Array, 1, RECT).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(FieldError)
      expect((error as FieldError).code).toBe('invalid_config')
      expect((error as FieldError).cause).toBeInstanceOf(OracleError)
    }
  })

  test('a failing source is source_error with the original cause', async () => {
    const boom = new Error('device unplugged')
    const source = {
      name: 'broken',
      // biome-ignore lint/correctness/useYield: the source fails before producing bytes
      async *stream(): AsyncGenerator<Uint8Array> {
        throw boom
      },
    }
    const error = await sampleField(source, 1, RECT).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FieldError)
    expect((error as FieldError).code).toBe('source_error')
  })

  test('aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await sampleField(prngSource('u', 9), 100, RECT, {
      signal: controller.signal,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FieldError)
    expect((error as FieldError).code).toBe('aborted')
  })
})

describe('toFieldError', () => {
  test('maps every oracle code and wraps foreign errors', () => {
    const map: Array<[string, string]> = [
      ['aborted', 'aborted'],
      ['insufficient_entropy', 'insufficient_entropy'],
      ['invalid_input', 'invalid_config'],
      ['source_error', 'source_error'],
      ['closed', 'source_error'],
    ]
    for (const [oracle, field] of map) {
      const mapped = toFieldError(new OracleError(oracle as 'aborted', 'x'))
      expect(mapped.code as string).toBe(field)
    }
    const own = new FieldError('invalid_config', 'mine')
    expect(toFieldError(own)).toBe(own)
    expect(toFieldError(new TypeError('boom')).code).toBe('source_error')
  })
})
