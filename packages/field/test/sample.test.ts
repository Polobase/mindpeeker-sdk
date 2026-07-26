import { describe, expect, test } from 'bun:test'
import { FieldError } from '../src/errors.js'
import { sampleField } from '../src/field/sample.js'
import type { FieldRegion, Point } from '../src/types.js'
import { prngBytes, prngSource } from './helpers/byte-sources.js'

const RECT: FieldRegion = { kind: 'rect', width: 100, height: 80 }
const DISK: FieldRegion = { kind: 'disk', radius: 50 }

describe('sampleField', () => {
  test('is deterministic and returns the requested count with a receipt', async () => {
    const bytes = prngBytes(4000, 0x1234)
    const a = await sampleField(bytes, 100, RECT)
    const b = await sampleField(bytes, 100, RECT)
    expect(a.points.length).toBe(100)
    expect(a.points).toEqual(b.points)
    expect(a.accounting.bytesConsumed).toBeGreaterThan(0)
    expect(a.accounting.bitsUsed).toBe(100 * 2 * 32) // 2 coords × 32 bits each
  })

  test('rect points land inside the region', async () => {
    const { points } = await sampleField(prngSource('u', 1), 2000, RECT)
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThan(RECT.kind === 'rect' ? RECT.width : 0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThan(RECT.kind === 'rect' ? RECT.height : 0)
    }
  })

  test('disk points land inside the disk and fill it area-uniformly', async () => {
    const { points } = await sampleField(prngSource('u', 2), 4000, DISK)
    const radius = DISK.kind === 'disk' ? DISK.radius : 0
    let innerHalf = 0 // fraction within r/√2 should be ≈ ½ for area-uniform sampling
    for (const p of points) {
      const d = Math.hypot(p.x, p.y)
      expect(d).toBeLessThanOrEqual(radius + 1e-9)
      if (d <= radius / Math.SQRT2) innerHalf++
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

  test('validation and entropy exhaustion', async () => {
    expect(sampleField(prngBytes(100), 0, RECT)).rejects.toMatchObject({ code: 'invalid_config' })
    expect(
      sampleField(prngBytes(100), 5, { kind: 'rect', width: 0, height: 10 } as FieldRegion),
    ).rejects.toMatchObject({ code: 'invalid_config' })
    // a finite buffer too small for the field → insufficient_data (re-mapped from oracle)
    expect(sampleField(prngBytes(8), 100, RECT)).rejects.toMatchObject({
      code: 'insufficient_data',
    })
  })

  test('aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const points: Point[] = []
    expect(
      sampleField(prngSource('u', 9), 100, RECT, { signal: controller.signal }),
    ).rejects.toThrow(FieldError)
    expect(points.length).toBe(0)
  })
})
