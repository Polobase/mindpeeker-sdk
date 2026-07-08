import { describe, expect, test } from 'bun:test'
import { cardGeometry, cardSvg } from '../src/card.js'
import { RateError } from '../src/errors.js'

describe('cardGeometry', () => {
  test('one ring per digit, angles from the digits', () => {
    const geo = cardGeometry({ digits: [0, 22], base: 44 })
    expect(geo.rings.length).toBe(2)
    expect(geo.rings[0]?.angleRad).toBeCloseTo(0, 15)
    expect(geo.rings[1]?.angleRad).toBeCloseTo(Math.PI, 15)
    expect(geo.base).toBe(44)
  })

  test('default even spread runs inner -> outer', () => {
    const geo = cardGeometry({ digits: [1, 2, 3], base: 44 }, { innerRadius: 0.2, outerRadius: 1 })
    expect(geo.rings[0]?.radius).toBeCloseTo(0.2, 15)
    expect(geo.rings[1]?.radius).toBeCloseTo(0.6, 15)
    expect(geo.rings[2]?.radius).toBeCloseTo(1, 15)
  })

  test('a single-digit rate sits on the outer radius', () => {
    const geo = cardGeometry({ digits: [7], base: 44 }, { outerRadius: 2 })
    expect(geo.rings[0]?.radius).toBe(2)
  })

  test('ringGap spaces rings by a fixed step with a shared rim', () => {
    const geo = cardGeometry({ digits: [0, 0, 0], base: 44 }, { outerRadius: 1, ringGap: 0.25 })
    expect(geo.rings.map((r) => r.radius)).toEqual([0.5, 0.75, 1])
  })

  test('labels pass through onto the geometry', () => {
    const geo = cardGeometry({ digits: [0], base: 44 }, { labels: ['crown'] })
    expect(geo.labels).toEqual(['crown'])
  })

  test('rejects an empty rate and bad radii', () => {
    expect(() => cardGeometry({ digits: [], base: 44 })).toThrow(RateError)
    expect(() => cardGeometry({ digits: [1], base: 44 }, { innerRadius: -1 })).toThrow(RateError)
    expect(() =>
      cardGeometry({ digits: [1], base: 44 }, { innerRadius: 2, outerRadius: 1 }),
    ).toThrow(RateError)
  })
})

describe('cardSvg', () => {
  test('deterministic exact string for a single-digit card', () => {
    const geo = cardGeometry({ digits: [0], base: 44 })
    const svg = cardSvg(geo, { size: 100 })
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" ' +
        'viewBox="0 0 100 100">' +
        '<g fill="none" stroke="#222" stroke-width="1" stroke-linecap="round">' +
        '<circle cx="50.000" cy="50.000" r="49.000"/>' +
        '<line x1="50.000" y1="50.000" x2="50.000" y2="1.000"/>' +
        '</g></svg>',
    )
  })

  test('angle 0 points up (12 o clock)', () => {
    const geo = cardGeometry({ digits: [0], base: 44 })
    const svg = cardSvg(geo, { size: 100 })
    // radial line endpoint is directly above the centre (same x, smaller y).
    expect(svg).toContain('x2="50.000" y2="1.000"')
  })

  test('quarter turn (digit 11, base 44) points right', () => {
    const geo = cardGeometry({ digits: [11], base: 44 })
    const svg = cardSvg(geo, { size: 100 })
    // theta = pi/2 -> x = c + r, y = c.
    expect(svg).toContain('x2="99.000" y2="50.000"')
  })

  test('background rect is emitted when requested', () => {
    const geo = cardGeometry({ digits: [3, 5], base: 44 })
    const svg = cardSvg(geo, { size: 64, background: '#fff' })
    expect(svg).toContain('<rect width="64" height="64" fill="#fff"/>')
  })

  test('one circle and one line per ring', () => {
    const geo = cardGeometry({ digits: [1, 2, 3, 4, 5], base: 44 })
    const svg = cardSvg(geo)
    expect(svg.match(/<circle /g)?.length).toBe(5)
    expect(svg.match(/<line /g)?.length).toBe(5)
  })

  test('ringGap too large for the digit count throws invalid_rate (regression)', () => {
    // 6 rings at gap 0.25 from outer 1 would put the innermost at -0.25.
    expect(() =>
      cardGeometry({ digits: [1, 2, 3, 4, 5, 6], base: 44 }, { outerRadius: 1, ringGap: 0.25 }),
    ).toThrow(RateError)
    expect(() => cardGeometry({ digits: [1, 2], base: 44 }, { ringGap: 0 })).toThrow(RateError)
    // A gap that clears zero for the given count is fine and yields positive radii.
    const ok = cardGeometry({ digits: [1, 2, 3], base: 44 }, { outerRadius: 1, ringGap: 0.25 })
    expect(ok.rings.every((r) => r.radius > 0)).toBe(true)
  })
})
