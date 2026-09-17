import { describe, expect, test } from 'bun:test'
import { meanObliquity, moonPosition, nutation } from '../src/index.js'
import fixture from './fixtures/moon.json' with { type: 'json' }

const wrap = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180

describe('nutation (Meeus ch. 22, four-term series)', () => {
  test('Example 22.a: 1987 April 10, 0h TD, within the stated 0.5″ / 0.1″', () => {
    const n = nutation(2446895.5)
    expect(Math.abs(n.longitude * 3600 - -3.788)).toBeLessThan(0.5)
    expect(Math.abs(n.obliquity * 3600 - 9.443)).toBeLessThan(0.1)
    expect(n.meanObliquity).toBeCloseTo(23 + 26 / 60 + 27.407 / 3600, 6)
    expect(n.trueObliquity).toBeCloseTo(23 + 26 / 60 + 36.85 / 3600, 4)
    expect(meanObliquity(2451545)).toBeCloseTo(23 + 26 / 60 + 21.448 / 3600, 12)
  })
})

describe('moonPosition (Meeus ch. 47)', () => {
  test('Example 47.a: 1992 April 12, 0h TD', () => {
    const moon = moonPosition(2448724.5)
    expect(moon.meanEquinoxLongitude).toBeCloseTo(133.162655, 6)
    expect(moon.latitude).toBeCloseTo(-3.229126, 6)
    expect(moon.distanceKm).toBeCloseTo(368409.7, 1)
    expect(moon.horizontalParallax).toBeCloseTo(0.99199, 5)
    // Meeus adds the full nutation (Δψ = +0.004610°); the four-term series is within 0.5″.
    expect(Math.abs(moon.longitude - 133.167265) * 3600).toBeLessThan(0.5)
    expect(Math.abs(moon.rightAscension - 134.68847) * 3600).toBeLessThan(0.5)
    expect(Math.abs(moon.declination - 13.768368) * 3600).toBeLessThan(0.5)
  })

  test('agrees with ERFA moon98 (an independent transcription of the same tables)', () => {
    // moon98 starts from Simon et al.'s L′ (218.31665436°), 0.74″ from Meeus' light-time-inclusive
    // constant, and we add the four-term Δψ (0.5″): hence 2″ in longitude.
    for (const c of fixture.cases) {
      const moon = moonPosition(c.jde)
      const geometric = moon.meanEquinoxLongitude + nutation(c.jde).longitude
      expect(Math.abs(wrap(geometric - c.moon98.longitude)) * 3600).toBeLessThan(2)
      expect(Math.abs(moon.latitude - c.moon98.latitude) * 3600).toBeLessThan(0.01)
      expect(Math.abs(moon.distanceKm - c.moon98.distanceKm)).toBeLessThan(0.001)
    }
  })

  test('accuracy against JPL DE440s, 1900–2100: < 11″ longitude, < 4″ latitude, < 8 km', () => {
    let sumSq = 0
    for (const c of fixture.cases) {
      const moon = moonPosition(c.jde)
      const dLon = wrap(moon.longitude - c.de440s.longitude) * 3600
      sumSq += dLon * dLon
      expect(Math.abs(dLon)).toBeLessThan(11)
      expect(Math.abs(moon.latitude - c.de440s.latitude) * 3600).toBeLessThan(4)
      expect(Math.abs(moon.distanceKm - c.de440s.distanceKm)).toBeLessThan(8)
      expect(Math.abs(wrap(moon.rightAscension - c.de440s.rightAscension)) * 3600).toBeLessThan(10)
      expect(Math.abs(moon.declination - c.de440s.declination) * 3600).toBeLessThan(5)
    }
    expect(Math.sqrt(sumSq / fixture.cases.length)).toBeLessThan(3.5)
  })
})
