import { describe, expect, test } from 'bun:test'
import { expectedCoincidences, probabilityAtLeastOne } from '../src/index.js'
import { expectInvalid } from './helpers/errors.js'
import { expectClose } from './helpers/exact.js'

describe('expectedCoincidences', () => {
  test("is N·p — Littlewood's miracle a month is this arithmetic", () => {
    const eventsIn35Days = 35 * 8 * 3600 // one per second, eight waking hours a day
    expect(eventsIn35Days).toBe(1_008_000)
    expectClose(expectedCoincidences(eventsIn35Days, 1e-6), 1.008, 1e-15)
    expect(expectedCoincidences(0, 0.3)).toBe(0)
  })

  test('validates', () => {
    expectInvalid(() => expectedCoincidences(-1, 0.5), 'opportunities')
    expectInvalid(() => expectedCoincidences(Number.POSITIVE_INFINITY, 0.5), 'opportunities')
    expectInvalid(() => expectedCoincidences(10, 1.5), 'pPerOpportunity')
    expectInvalid(() => expectedCoincidences(10, Number.NaN), 'pPerOpportunity')
  })
})

describe('probabilityAtLeastOne', () => {
  test('is 1 − (1 − p)^N with full precision for tiny p', () => {
    expectClose(probabilityAtLeastOne(2, 0.5), 0.75, 1e-15)
    expectClose(probabilityAtLeastOne(1e7, 1e-6), -Math.expm1(1e7 * Math.log1p(-1e-6)), 1e-15)
    expect(probabilityAtLeastOne(1e7, 1e-6)).toBeCloseTo(0.99995, 5)
    // 1000 chances at 1e-12 each: 1 − (1 − 1e-12)^1000 = 1e-9 − 4.995e-19 …
    expectClose(probabilityAtLeastOne(1000, 1e-12), 1e-9 - 4.995e-19, 1e-12)
    expect(probabilityAtLeastOne(0, 0.9)).toBe(0)
    expect(probabilityAtLeastOne(5, 1)).toBe(1)
    expect(Object.is(probabilityAtLeastOne(5, 0), 0)).toBe(true)
  })

  test('validates', () => {
    expectInvalid(() => probabilityAtLeastOne(-2, 0.1), 'opportunities')
    expectInvalid(() => probabilityAtLeastOne(2, -0.1), 'pPerOpportunity')
  })
})
