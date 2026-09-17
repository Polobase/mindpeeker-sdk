import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import { MAX_NUMBER, numberProperties } from '../src/numbers.js'
import { analyze } from '../src/value.js'

describe('numberProperties', () => {
  test('666 — the 36th triangular number, 2 · 3² · 37', () => {
    const p = numberProperties(666)
    expect(p.value).toBe(666)
    expect(p.digitSum).toBe(18)
    expect(p.digitalRoot).toBe(9)
    expect(p.isPrime).toBe(false)
    expect(p.isTriangular).toBe(true)
    expect(p.triangularIndex).toBe(36)
    expect(p.isSquare).toBe(false)
    expect(p.isPerfect).toBe(false)
    expect(p.factorization).toEqual([
      { prime: 2, exponent: 1 },
      { prime: 3, exponent: 2 },
      { prime: 37, exponent: 1 },
    ])
  })

  test('primes, squares and perfect numbers', () => {
    expect(numberProperties(37).isPrime).toBe(true)
    expect(numberProperties(37).factorization).toEqual([{ prime: 37, exponent: 1 }])
    expect(numberProperties(144).isSquare).toBe(true)
    expect(numberProperties(28).isPerfect).toBe(true)
    expect(numberProperties(496).isPerfect).toBe(true)
    expect(numberProperties(100).isPerfect).toBe(false)
  })

  test('triangular index is omitted for non-triangular numbers', () => {
    const p = numberProperties(100)
    expect(p.isTriangular).toBe(false)
    expect(p.triangularIndex).toBeUndefined()
    expect(numberProperties(10).triangularIndex).toBe(4) // 1+2+3+4
  })

  test('edge cases: 0 and 1 have empty factorizations', () => {
    expect(numberProperties(0).factorization).toEqual([])
    expect(numberProperties(1).factorization).toEqual([])
    expect(numberProperties(0).isTriangular).toBe(true) // T(0) = 0
    expect(numberProperties(1).isPrime).toBe(false)
  })

  test('rejects negatives and non-integers', () => {
    expect(() => numberProperties(-1)).toThrow(GematriaError)
    expect(() => numberProperties(1.5)).toThrow(GematriaError)
  })

  test('rejects non-safe and oversized integers instead of returning wrong digit sums', () => {
    expect(MAX_NUMBER).toBe(2 ** 48)
    for (const n of [2 ** 48 + 1, 2 ** 53, 2 ** 60, 1e300, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => numberProperties(n)).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    }
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => numberProperties('5' as any)).toThrow(GematriaError)
  })

  test('2^48 is accepted: exact digit sum 73 (python: sum of the digits of 281474976710656)', () => {
    const p = numberProperties(2 ** 48)
    expect(p.digitSum).toBe(73)
    expect(p.digitalRoot).toBe(1)
    expect(p.factorization).toEqual([{ prime: 2, exponent: 48 }])
    expect(p.isSquare).toBe(true)
    expect(p.isPrime).toBe(false)
  })

  test('primality and factorization from one sweep', () => {
    expect(numberProperties(2).isPrime).toBe(true)
    expect(numberProperties(3).isPrime).toBe(true)
    expect(numberProperties(4).isPrime).toBe(false)
    expect(numberProperties(1024).factorization).toEqual([{ prime: 2, exponent: 10 }])
    expect(numberProperties(2 ** 31 - 1).isPrime).toBe(true)
    // largest prime below 2^40 (2^40 - 87), and a semiprime of the two largest primes below 2^20
    expect(numberProperties(1099511627689).isPrime).toBe(true)
    expect(numberProperties(1048573 * 1048571).factorization).toEqual([
      { prime: 1048571, exponent: 1 },
      { prime: 1048573, exponent: 1 },
    ])
    expect(numberProperties(9 * 25 * 49 * 121).factorization).toEqual([
      { prime: 3, exponent: 2 },
      { prime: 5, exponent: 2 },
      { prime: 7, exponent: 2 },
      { prime: 11, exponent: 2 },
    ])
  })

  test('the seven perfect numbers up to 2^48 are perfect, their neighbours are not', () => {
    const perfect = [6, 28, 496, 8128, 33550336, 8589869056, 137438691328]
    for (const n of perfect) {
      expect(numberProperties(n).isPerfect).toBe(true)
      expect(numberProperties(n - 1).isPerfect).toBe(false)
      expect(numberProperties(n + 1).isPerfect).toBe(false)
    }
    expect(numberProperties(0).isPerfect).toBe(false)
    expect(numberProperties(1).isPerfect).toBe(false)
    expect(numberProperties(12).isPerfect).toBe(false) // abundant: σ(12) = 28
  })
})

describe('analyze with numberProperties option', () => {
  test('attaches the number-lore portrait only when requested', () => {
    expect(analyze('χξϛ', 'gr-isopsephy').numbers).toBeUndefined()
    const r = analyze('χξϛ', 'gr-isopsephy', { numberProperties: true })
    expect(r.value).toBe(666)
    expect(r.numbers?.triangularIndex).toBe(36)
  })
})
