import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  arcFractionInDisk,
  arcFractionInRect,
  borderDistance,
  circleRectArea,
  lensArea,
  translationOverlap,
} from '../src/internal/geometry.js'

interface GeometryFixture {
  geometry: {
    circleRect: Array<{ cx: number; cy: number; r: number; area: number }>
    arcRect: Array<{ x: number; y: number; r: number; fraction: number }>
    lens: Array<{ rho: number; r: number; area: number }>
    arcDisk: Array<{ rho: number; r: number; fraction: number }>
  }
}
const { geometry } = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'stats.json'), 'utf8'),
) as GeometryFixture

function closeRel(actual: number, expected: number, rel: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.abs(expected) + 1e-15)
}

describe('closed-form edge geometry (vs scipy quadrature and root finding)', () => {
  test('disk ∩ rectangle area', () => {
    for (const c of geometry.circleRect)
      closeRel(circleRectArea(c.cx, c.cy, c.r, 10, 8), c.area, 1e-11)
    expect(circleRectArea(5, 4, 1, 10, 8)).toBe(Math.PI)
    expect(circleRectArea(-5, 4, 1, 10, 8)).toBe(0)
    expect(circleRectArea(5, 4, 100, 10, 8)).toBe(80)
  })

  test('circumference fraction inside a rectangle (Ripley isotropic weight)', () => {
    for (const c of geometry.arcRect) {
      closeRel(arcFractionInRect(c.x, c.y, c.r, 10, 8), c.fraction, 1e-11)
    }
    expect(arcFractionInRect(0, 0, 1, 10, 8)).toBeCloseTo(0.25, 14) // corner
    expect(arcFractionInRect(0, 4, 1, 10, 8)).toBeCloseTo(0.5, 14) // edge
  })

  test('lens area of two disks', () => {
    for (const c of geometry.lens) closeRel(lensArea(c.rho, c.r, 5), c.area, 1e-11)
    expect(lensArea(0, 2, 5)).toBe(4 * Math.PI)
    expect(lensArea(20, 2, 5)).toBe(0)
  })

  test('circumference fraction inside a disk', () => {
    for (const c of geometry.arcDisk) {
      expect(Math.abs(arcFractionInDisk(c.rho, c.r, 5) - c.fraction)).toBeLessThan(1e-12)
    }
  })

  test('translation overlap and border distance', () => {
    expect(translationOverlap(3, -2, { kind: 'rect', width: 10, height: 8 })).toBe(42)
    expect(translationOverlap(0, 0, { kind: 'disk', radius: 2 })).toBeCloseTo(4 * Math.PI, 12)
    expect(borderDistance({ x: 3, y: 7 }, { kind: 'rect', width: 10, height: 8 })).toBe(1)
    expect(borderDistance({ x: 3, y: 4 }, { kind: 'disk', radius: 6 })).toBe(1)
    expect(borderDistance({ x: 10.000001, y: 4 }, { kind: 'rect', width: 10, height: 8 })).toBe(0)
  })
})
