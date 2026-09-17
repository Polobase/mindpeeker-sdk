import { describe, expect, test } from 'bun:test'
import {
  EphemerisError,
  julianDay,
  moonIllumination,
  moonPhases,
  moonPhaseTime,
  nextMoonPhase,
} from '../src/index.js'
import moonFixture from './fixtures/moon.json' with { type: 'json' }
import phaseFixture from './fixtures/phases.json' with { type: 'json' }

describe('moonIllumination (Meeus ch. 48)', () => {
  test('Example 48.a: 1992 April 12, 0h TD', () => {
    const illum = moonIllumination(2448724.5)
    expect(illum.phaseAngle).toBeCloseTo(69.0756, 3)
    expect(illum.illuminatedFraction).toBeCloseTo(0.6786, 4)
    expect(illum.brightLimbAngle).toBeCloseTo(285.0, 1)
    expect(illum.waxing).toBe(true)
    expect(illum.elongation + illum.phaseAngle).toBeCloseTo(180, 0)
  })

  test('within 0.015° phase angle and 0.0002 illuminated fraction of JPL DE440s', () => {
    for (const c of moonFixture.cases) {
      const illum = moonIllumination(c.jde)
      expect(Math.abs(illum.phaseAngle - c.de440s.phaseAngle)).toBeLessThan(0.015)
      expect(Math.abs(illum.illuminatedFraction - c.de440s.illuminatedFraction)).toBeLessThan(2e-4)
    }
  })

  test('new moon is dark and full moon is lit', () => {
    const newMoon = moonIllumination(moonPhaseTime(0))
    expect(newMoon.illuminatedFraction).toBeLessThan(0.01)
    expect(Math.min(newMoon.longitudeFromSun, 360 - newMoon.longitudeFromSun)).toBeLessThan(0.01)
    const full = moonIllumination(moonPhaseTime(0.5))
    expect(full.illuminatedFraction).toBeGreaterThan(0.99)
    expect(full.longitudeFromSun).toBeCloseTo(180, 1)
  })
})

describe('moonPhaseTime (Meeus ch. 49)', () => {
  test('Example 49.a: new moon of 1977 February, k = −283', () => {
    expect(moonPhaseTime(-283)).toBeCloseTo(2443192.65118, 5)
  })

  test('Example 49.b: last quarter of 2044 January, k = 544.75', () => {
    expect(moonPhaseTime(544.75)).toBeCloseTo(2467636.49186, 5)
  })

  test('identical to PyMeeus (independent transcription) within 1 ms', () => {
    for (const c of phaseFixture.cases) {
      expect(Math.abs(moonPhaseTime(c.k) - c.pymeeusJde) * 86400).toBeLessThan(0.001)
    }
  })

  test('within 15 s of the JPL DE440s phase instants, 1950–2050', () => {
    const withTruth = phaseFixture.cases.filter((c) => c.de440sJde !== undefined)
    expect(withTruth.length).toBeGreaterThan(20)
    for (const c of withTruth) {
      expect(Math.abs(moonPhaseTime(c.k) - (c.de440sJde as number)) * 86400).toBeLessThan(15)
    }
  })

  test('rejects k that is not a multiple of 0.25', () => {
    expect(() => moonPhaseTime(0.3)).toThrow(EphemerisError)
    expect(() => moonPhaseTime(Number.NaN)).toThrow(EphemerisError)
  })
})

describe('nextMoonPhase and moonPhases', () => {
  test('the next phase is at or after the start and its predecessor is before it', () => {
    for (let jde = 2440000.5; jde < 2470000; jde += 1234.567) {
      const next = nextMoonPhase(jde)
      expect(next.jde).toBeGreaterThanOrEqual(jde)
      expect(moonPhaseTime(next.k - 0.25)).toBeLessThan(jde)
      const full = nextMoonPhase(jde, 'full')
      expect(full.phase).toBe('full')
      expect(full.k - Math.floor(full.k)).toBe(0.5)
      expect(moonPhaseTime(full.k - 1)).toBeLessThan(jde)
    }
  })

  test('phases cycle in order, 6–9 days apart', () => {
    const start = julianDay({ year: 2024, month: 1, day: 1 })
    const end = julianDay({ year: 2025, month: 1, day: 1 })
    const events = moonPhases(start, end)
    const order = ['new', 'firstQuarter', 'full', 'lastQuarter']
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1] as (typeof events)[number]
      const cur = events[i] as (typeof events)[number]
      expect(cur.k - prev.k).toBe(0.25)
      expect(order.indexOf(cur.phase)).toBe((order.indexOf(prev.phase) + 1) % 4)
      expect(cur.jde - prev.jde).toBeGreaterThan(6)
      expect(cur.jde - prev.jde).toBeLessThan(9)
    }
    // 2024 had two new moons in December (Dec 1 and Dec 30): thirteen in the year.
    expect(moonPhases(start, end, 'new')).toHaveLength(13)
    expect(moonPhases(start, start)).toEqual([])
  })

  test('validation', () => {
    expect(() => nextMoonPhase(2451545, 'blue' as 'full')).toThrow(EphemerisError)
    expect(() => moonPhases(2451545, 2451544)).toThrow(EphemerisError)
    expect(() => moonPhases(2451545, 2451545 + 4e6)).toThrow(EphemerisError)
  })
})
