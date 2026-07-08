import { describe, expect, test } from 'bun:test'
import { RateError } from '../src/errors.js'
import { formatRate, parseRate } from '../src/parse.js'

describe('parseRate', () => {
  test('parses dash form', () => {
    expect(parseRate('12-33-7')).toEqual({ digits: [12, 33, 7], base: 44 })
  })

  test('parses dot form identically', () => {
    expect(parseRate('12.33.7')).toEqual({ digits: [12, 33, 7], base: 44 })
  })

  test('parses a single bare digit', () => {
    expect(parseRate('7')).toEqual({ digits: [7], base: 44 })
  })

  test('accepts edge digits 0 and 43 (base 44)', () => {
    expect(parseRate('0-43')).toEqual({ digits: [0, 43], base: 44 })
    expect(parseRate('00-43')).toEqual({ digits: [0, 43], base: 44 })
  })

  test('honours an explicit base', () => {
    expect(parseRate('1.2.3', { base: 10 })).toEqual({ digits: [1, 2, 3], base: 10 })
  })

  test('oneBased maps Rae book labels 1..44 to 0..43', () => {
    expect(parseRate('01-44', { oneBased: true })).toEqual({ digits: [0, 43], base: 44 })
  })

  test('rejects out-of-range digits', () => {
    expect(() => parseRate('44')).toThrow(RateError)
    expect(() => parseRate('12-99')).toThrow(RateError)
  })

  test('rejects mixed separators', () => {
    expect(() => parseRate('12-33.7')).toThrow(RateError)
  })

  test('rejects empty and malformed input', () => {
    expect(() => parseRate('')).toThrow(RateError)
    expect(() => parseRate('12--7')).toThrow(RateError)
    expect(() => parseRate('-5')).toThrow(RateError)
    expect(() => parseRate('1-2-')).toThrow(RateError)
    expect(() => parseRate('1-a-3')).toThrow(RateError)
    expect(() => parseRate('1.2.-3')).toThrow(RateError)
  })

  test('a dotted pair is two digits, not a decimal', () => {
    // '3.5' is the rate (3, 5), never the number three-point-five.
    expect(parseRate('3.5')).toEqual({ digits: [3, 5], base: 44 })
  })

  test('a signed or float-looking group is rejected', () => {
    expect(() => parseRate('1-+2')).toThrow(RateError)
    expect(() => parseRate('1-2e1')).toThrow(RateError)
  })

  test('reports the invalid_rate code and echoes input', () => {
    try {
      parseRate('12-99')
    } catch (err) {
      expect((err as RateError).code).toBe('invalid_rate')
      expect((err as RateError).input).toBe('12-99')
    }
  })
})

describe('formatRate', () => {
  test('default dash form', () => {
    expect(formatRate({ digits: [12, 33, 7], base: 44 })).toBe('12-33-7')
  })

  test('round-trips through parseRate (dash)', () => {
    for (const s of ['12-33-7', '0-43', '1', '5-5-5-5', '43-0-21']) {
      expect(formatRate(parseRate(s))).toBe(s)
    }
  })

  test('round-trips through parseRate (dot)', () => {
    for (const s of ['12.33.7', '0.43.21']) {
      expect(formatRate(parseRate(s), { separator: '.' })).toBe(s)
    }
  })

  test('pad zero-fills to base width', () => {
    expect(formatRate({ digits: [0, 42], base: 44 }, { pad: true, separator: ' ' })).toBe('00 42')
    expect(formatRate({ digits: [7], base: 44 }, { pad: true })).toBe('07')
  })

  test('oneBased round-trips with parseRate oneBased', () => {
    const s = '1-44'
    const rate = parseRate(s, { oneBased: true })
    expect(rate.digits).toEqual([0, 43])
    expect(formatRate(rate, { oneBased: true })).toBe(s)
  })

  test('emulates a real Combe base-44 book rate', () => {
    // "T-Lymphocytes" = 01 04 19 27 28 (one-based labels)
    const rate = parseRate('01-04-19-27-28', { oneBased: true })
    expect(rate.digits).toEqual([0, 3, 18, 26, 27])
    expect(formatRate(rate, { oneBased: true, pad: true, separator: ' ' })).toBe('01 04 19 27 28')
  })

  test('oneBased pad width covers the label base, not base-1 (regression)', () => {
    // base 10 oneBased emits labels 1..10; pad must be width 2 for all of them.
    expect(formatRate({ digits: [0, 9], base: 10 }, { oneBased: true, pad: true })).toBe('01-10')
    // base 100 oneBased emits up to 100 (width 3).
    expect(formatRate({ digits: [5, 99], base: 100 }, { oneBased: true, pad: true })).toBe(
      '006-100',
    )
    // canonical base 44 unaffected.
    expect(formatRate({ digits: [0, 43], base: 44 }, { oneBased: true, pad: true })).toBe('01-44')
  })
})
