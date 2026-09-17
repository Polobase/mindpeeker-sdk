import { describe, expect, test } from 'bun:test'
import { guessingCapacity, readFeedbackExpectation } from '../src/index.js'
import { expectClose, expectJudgingError, fixtures } from './helpers/fixtures.js'

describe('readFeedbackExpectation', () => {
  test("Read's optimal-feedback expectation for the Zener pack is 8.647 (Epstein)", () => {
    const r = readFeedbackExpectation([5, 5, 5, 5, 5])
    expect(r.expected).toBeCloseTo(8.647, 3)
    expect(r.withoutFeedback).toBe(5)
    expect(r.cards).toBe(25)
    expect(r.states).toBeGreaterThan(0)
    let total = 0
    for (const p of r.pmf) total += p
    expectClose(total, 1, 1e-14)
  })

  test('matches exact rational recursions (expectation, variance, pmf)', () => {
    for (const c of fixtures.feedback) {
      const r = readFeedbackExpectation(c.deck)
      expectClose(r.expected, c.expected, 1e-13)
      expectClose(r.variance, c.variance, 1e-11, 1e-15)
      expect(r.pmf.length).toBe(c.pmf.length)
      c.pmf.forEach((p, k) => {
        expectClose(r.pmf[k] as number, p, 1e-11, 1e-300)
      })
    }
  })

  test('small cases by hand', () => {
    // one symbol: every call hits
    expect(readFeedbackExpectation([7]).expected).toBe(7)
    // [1, 1]: first call hits with ½, the second always hits once the first card is seen
    expect(readFeedbackExpectation([1, 1]).expected).toBeCloseTo(1.5, 15)
    // zero counts are ignored
    expect(readFeedbackExpectation([0, 1, 1, 0]).expected).toBeCloseTo(1.5, 15)
  })

  test('validates', () => {
    expectJudgingError(() => readFeedbackExpectation([]), 'invalid_input')
    expectJudgingError(() => readFeedbackExpectation([0, 0]), 'invalid_input')
    expectJudgingError(() => readFeedbackExpectation([1.5]), 'invalid_input')
    expectJudgingError(() => readFeedbackExpectation(new Array<number>(10).fill(10)), 'too_large')
  })
})

describe('guessingCapacity', () => {
  test('Epstein: 6 and 7 Zener hits per 25 carry 0.0069 and 0.026 bits per call', () => {
    expect(guessingCapacity(6 / 25, 5)).toBeCloseTo(0.006888, 6)
    expect(guessingCapacity(7 / 25, 5)).toBeCloseTo(0.026477, 6)
  })

  test('matches mpmath, with 0 at chance and log2 k at certainty', () => {
    for (const c of fixtures.capacity) {
      expectClose(guessingCapacity(c.hitRate, c.choices), c.bits, 1e-12, 1e-15)
    }
    expect(guessingCapacity(0.2, 5)).toBeLessThan(1e-15)
    expect(guessingCapacity(1, 8)).toBe(3)
  })

  test('validates', () => {
    expectJudgingError(() => guessingCapacity(-0.1, 5), 'invalid_input')
    expectJudgingError(() => guessingCapacity(0.5, 1), 'invalid_options')
  })
})
