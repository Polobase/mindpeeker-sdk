import { describe, expect, test } from 'bun:test'
import {
  autoRange,
  bandStrip,
  fitColumns,
  gridColumns,
  linearScale,
  MIN_PANEL_WIDTH,
  matrixScale,
  niceTicks,
  normalizeMatrix,
  seriesPath,
  tessellateDial,
  VIRIDIS_STOPS,
  viridisLut,
} from '../../client/math.js'
import type { RateCardGeometry } from '../../src/types.js'

describe('linearScale', () => {
  test('maps the domain affinely onto the range', () => {
    const scale = linearScale(0, 10, -1, 1)
    expect(scale(0)).toBe(-1)
    expect(scale(10)).toBe(1)
    expect(scale(5)).toBe(0)
    expect(scale(-5)).toBe(-2) // no clamping — callers clip in GL
  })

  test('inverted ranges work', () => {
    const scale = linearScale(0, 1, 100, 0)
    expect(scale(0.25)).toBe(75)
  })

  test('a degenerate domain maps to the range midpoint', () => {
    const scale = linearScale(3, 3, 0, 10)
    expect(scale(3)).toBe(5)
    expect(scale(-100)).toBe(5)
  })
})

describe('niceTicks', () => {
  test('produces 1/2/5 × 10^k steps covering the range', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })

  test('handles negative and asymmetric ranges', () => {
    const ticks = niceTicks(-7, 13, 4)
    expect(ticks[0] as number).toBeGreaterThanOrEqual(-7)
    expect(ticks[ticks.length - 1] as number).toBeLessThanOrEqual(13)
    expect(ticks).toContain(0)
  })

  test('degenerate and invalid inputs yield safe outputs', () => {
    expect(niceTicks(5, 5)).toEqual([5])
    expect(niceTicks(Number.NaN, 1)).toEqual([])
    expect(niceTicks(0, Number.POSITIVE_INFINITY)).toEqual([])
  })

  test('ticks ascend and are evenly spaced', () => {
    const ticks = niceTicks(0.001, 0.017, 6)
    for (let i = 1; i < ticks.length; i++) {
      expect((ticks[i] as number) > (ticks[i - 1] as number)).toBe(true)
    }
  })
})

describe('autoRange', () => {
  test('pads the min/max span symmetrically', () => {
    const [lo, hi] = autoRange([0, 10], 0.1)
    expect(lo).toBeCloseTo(-1)
    expect(hi).toBeCloseTo(11)
  })

  test('ignores NaN and infinities', () => {
    const [lo, hi] = autoRange([Number.NaN, 1, Number.POSITIVE_INFINITY, 3], 0)
    expect(lo).toBe(1)
    expect(hi).toBe(3)
  })

  test('empty input yields the unit range', () => {
    expect(autoRange([])).toEqual([0, 1])
  })

  test('constant input yields a non-degenerate range', () => {
    const [lo, hi] = autoRange([42, 42])
    expect(lo).toBeLessThan(42)
    expect(hi).toBeGreaterThan(42)
  })
})

describe('viridisLut', () => {
  test('has n RGBA entries with opaque alpha', () => {
    const lut = viridisLut(256)
    expect(lut.length).toBe(1024)
    for (let i = 0; i < 256; i++) expect(lut[i * 4 + 3]).toBe(255)
  })

  test('endpoints equal the frozen anchor stops', () => {
    const lut = viridisLut(64)
    const first = VIRIDIS_STOPS[0] as readonly [number, number, number]
    const last = VIRIDIS_STOPS[VIRIDIS_STOPS.length - 1] as readonly [number, number, number]
    expect([lut[0], lut[1], lut[2]]).toEqual([...first])
    expect([lut[63 * 4], lut[63 * 4 + 1], lut[63 * 4 + 2]]).toEqual([...last])
  })

  test('red and green channels grow (viridis luminance is monotone)', () => {
    const lut = viridisLut(128)
    // green strictly climbs from deep purple to yellow along viridis
    for (let i = 4; i < 128 * 4; i += 4) {
      expect((lut[i + 1] as number) >= (lut[i - 4 + 1] as number)).toBe(true)
    }
  })

  test('the stop table is frozen', () => {
    expect(Object.isFrozen(VIRIDIS_STOPS)).toBe(true)
    expect(Object.isFrozen(VIRIDIS_STOPS[0])).toBe(true)
  })

  test('rejects sizes below 2', () => {
    expect(() => viridisLut(1)).toThrow(RangeError)
  })
})

describe('seriesPath / bandStrip', () => {
  const points = [
    { t: 0, value: 1 },
    { t: 1, value: Number.NaN },
    { t: 2, value: 3, band: [2, 4] as const },
    { t: 3, value: 5, band: [Number.NaN, 6] as const },
  ]
  const id = (x: number) => x

  test('seriesPath drops non-finite values and interleaves x,y', () => {
    const verts = seriesPath(points, id, id)
    expect(verts).toEqual(new Float32Array([0, 1, 2, 3, 3, 5]))
  })

  test('bandStrip emits (x,lo),(x,hi) pairs only for finite bands', () => {
    const verts = bandStrip(points, id, id)
    expect(verts).toEqual(new Float32Array([2, 2, 2, 4]))
  })
})

describe('tessellateDial', () => {
  const card: RateCardGeometry = {
    type: 'rate-card',
    sectors: 44,
    rings: [0.3, 0.5, 0.7, 0.9],
    pointerSector: 17,
  }

  test('vertex counts match rings×segments + sectors', () => {
    const segments = 64
    const { grid, pointer } = tessellateDial(card, segments)
    // each ring: segments line segments × 2 verts × 2 floats; sectors: 2 verts × 2 floats
    expect(grid.length).toBe((4 * segments * 2 + 44 * 2) * 2)
    expect(pointer.length).toBe(4)
  })

  test('ring vertices lie on their circles', () => {
    const { grid } = tessellateDial(card, 32)
    // first ring occupies the first 32×2 vertices, radius 0.3
    for (let v = 0; v < 32 * 2; v++) {
      const x = grid[v * 2] as number
      const y = grid[v * 2 + 1] as number
      expect(Math.hypot(x, y)).toBeCloseTo(0.3, 6)
    }
  })

  test('radial lines span innermost to outermost ring', () => {
    const segments = 16
    const { grid } = tessellateDial(card, segments)
    const radialStart = 4 * segments * 2 * 2
    const x0 = grid[radialStart] as number
    const y0 = grid[radialStart + 1] as number
    const x1 = grid[radialStart + 2] as number
    const y1 = grid[radialStart + 3] as number
    expect(Math.hypot(x0, y0)).toBeCloseTo(0.3, 6)
    expect(Math.hypot(x1, y1)).toBeCloseTo(0.9, 6)
    // sector 0 points straight up (12 o'clock)
    expect(x0).toBeCloseTo(0, 6)
    expect(y0).toBeCloseTo(0.3, 6)
  })

  test('pointer marks its sector clockwise from 12 o’clock', () => {
    const quarter: RateCardGeometry = { ...card, sectors: 4, pointerSector: 1 }
    const { pointer } = tessellateDial(quarter, 16)
    // sector 1 of 4 → 3 o'clock → (outer, 0)
    expect(pointer[2]).toBeCloseTo(0.9, 6)
    expect(pointer[3]).toBeCloseTo(0, 6)
  })

  test('no pointer yields an empty pointer array', () => {
    const { pointer } = tessellateDial({ type: 'rate-card', sectors: 8, rings: [1] }, 8)
    expect(pointer.length).toBe(0)
  })

  test('one ring: sector lines run from the centre to that ring (never zero-length)', () => {
    const segments = 8
    const { grid } = tessellateDial({ type: 'rate-card', sectors: 4, rings: [0.8] }, segments)
    const radialStart = segments * 2 * 2
    for (let k = 0; k < 4; k++) {
      const o = radialStart + k * 4
      expect(Math.hypot(grid[o] as number, grid[o + 1] as number)).toBeCloseTo(0, 12)
      expect(Math.hypot(grid[o + 2] as number, grid[o + 3] as number)).toBeCloseTo(0.8, 6)
    }
  })

  test('no rings: spokes span centre to radius 1; equal radii behave like one ring', () => {
    const none = tessellateDial({ type: 'rate-card', sectors: 2, rings: [] }, 8).grid
    expect(Math.hypot(none[0] as number, none[1] as number)).toBeCloseTo(0, 12)
    expect(Math.hypot(none[2] as number, none[3] as number)).toBeCloseTo(1, 6)
    const equal = tessellateDial({ type: 'rate-card', sectors: 2, rings: [0.5, 0.5] }, 8).grid
    const o = 2 * 8 * 2 * 2
    expect(Math.hypot(equal[o] as number, equal[o + 1] as number)).toBeCloseTo(0, 12)
  })

  test('pointerSector must be an integer in [0, sectors)', () => {
    for (const pointerSector of [44, -3, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => tessellateDial({ ...card, pointerSector })).toThrow(RangeError)
    }
    expect(tessellateDial({ ...card, pointerSector: 0 }).pointer.length).toBe(4)
    expect(tessellateDial({ ...card, pointerSector: 43 }).pointer.length).toBe(4)
  })

  test('rejects invalid geometry', () => {
    expect(() => tessellateDial({ type: 'rate-card', sectors: 0, rings: [1] })).toThrow(RangeError)
    expect(() => tessellateDial({ type: 'rate-card', sectors: 4, rings: [1.5] })).toThrow(
      RangeError,
    )
    expect(() => tessellateDial(card, 2)).toThrow(RangeError)
  })
})

describe('matrixScale / normalizeMatrix', () => {
  test('bars keep a zero baseline: a flat histogram renders as near-equal bars', () => {
    const data = new Float32Array([78, 80, 82, 80])
    const scale = matrixScale(data, 1)
    expect(scale).toEqual({ lo: 0, hi: 82, baseline: 0, bars: true, fixed: false })
    const heights = normalizeMatrix(data, scale)
    expect(Math.min(...heights)).toBeCloseTo(78 / 82, 6)
    expect(heights[2]).toBe(1)
  })

  test('mixed-sign bars put the baseline at the normalized zero', () => {
    const scale = matrixScale([-1, 3], 1)
    expect(scale.lo).toBe(-1)
    expect(scale.hi).toBe(3)
    expect(scale.baseline).toBeCloseTo(0.25, 12)
    const all = matrixScale([-4, -2], 1)
    expect([all.lo, all.hi, all.baseline]).toEqual([-4, 0, 1])
  })

  test('heatmaps stay min-max normalized', () => {
    const scale = matrixScale([2, 4, 6, 10], 2)
    expect([scale.lo, scale.hi, scale.bars]).toEqual([2, 10, false])
    expect([...normalizeMatrix([2, 4, 6, 10], scale)]).toEqual([0, 0.25, 0.5, 1])
  })

  test('a producer range is used as-is and values are clamped', () => {
    const scale = matrixScale([-5, 50, 500], 1, [0, 100])
    expect(scale).toMatchObject({ lo: 0, hi: 100, fixed: true })
    expect([...normalizeMatrix([-5, 50, 500], scale)]).toEqual([0, 0.5, 1])
    // an invalid range falls back to data-driven scaling
    expect(matrixScale([1, 2], 1, [3, 3]).fixed).toBe(false)
  })

  test('degenerate and non-finite inputs stay usable', () => {
    expect(matrixScale([0, 0], 1)).toMatchObject({ lo: 0, hi: 1 })
    expect(matrixScale([7, 7], 3)).toMatchObject({ lo: 7, hi: 8 })
    expect(matrixScale([Number.NaN], 1)).toMatchObject({ lo: 0, hi: 1 })
    const bars = matrixScale([-1, 1], 1)
    expect(normalizeMatrix([Number.NaN], bars)[0]).toBe(0.5)
    expect(normalizeMatrix([Number.NaN], matrixScale([1, 2], 2))[0]).toBe(0)
  })
})

describe('fitColumns', () => {
  test('caps the preferred count by the container width', () => {
    expect(fitColumns(5, 1400)).toBe(3)
    expect(fitColumns(5, 700)).toBe(2)
    expect(fitColumns(5, 390)).toBe(1)
    expect(fitColumns(5, MIN_PANEL_WIDTH - 1)).toBe(1)
    expect(fitColumns(16, 4000)).toBe(4)
  })

  test('an unknown width keeps the preferred count', () => {
    expect(fitColumns(5, 0)).toBe(gridColumns(5))
    expect(fitColumns(5, Number.NaN)).toBe(gridColumns(5))
  })
})

describe('gridColumns', () => {
  test('near-square layout capped at 4', () => {
    expect(gridColumns(1)).toBe(1)
    expect(gridColumns(2)).toBe(2)
    expect(gridColumns(4)).toBe(2)
    expect(gridColumns(5)).toBe(3)
    expect(gridColumns(9)).toBe(3)
    expect(gridColumns(10)).toBe(4)
    expect(gridColumns(100)).toBe(4)
  })
})
