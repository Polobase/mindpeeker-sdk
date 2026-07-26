import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import { numberProperties } from '../src/numbers.js'
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
})

describe('analyze with numberProperties option', () => {
  test('attaches the number-lore portrait only when requested', () => {
    expect(analyze('χξϛ', 'gr-isopsephy').numbers).toBeUndefined()
    const r = analyze('χξϛ', 'gr-isopsephy', { numberProperties: true })
    expect(r.value).toBe(666)
    expect(r.numbers?.triangularIndex).toBe(36)
  })
})
