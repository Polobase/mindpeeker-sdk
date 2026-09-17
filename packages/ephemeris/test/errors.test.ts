import { describe, expect, test } from 'bun:test'
import { EphemerisError, gmst, julianDay, lstWindowScan } from '../src/index.js'

describe('EphemerisError', () => {
  test('carries code, name and message', () => {
    const err = new EphemerisError('invalid_time', 'bad')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('EphemerisError')
    expect(err.code).toBe('invalid_time')
    expect(err.message).toBe('bad')
  })

  test('threads a cause when given and omits it otherwise', () => {
    const cause = new Error('root')
    expect(new EphemerisError('invalid_input', 'x', { cause }).cause).toBe(cause)
    expect(new EphemerisError('invalid_options', 'y').cause).toBeUndefined()
  })

  test('public functions throw EphemerisError, never a foreign error', () => {
    const cases: [() => unknown, string][] = [
      [() => gmst(Number.NaN), 'invalid_time'],
      [() => julianDay(new Date(Number.NaN)), 'invalid_time'],
      [() => lstWindowScan([]), 'insufficient_data'],
      [() => lstWindowScan([{ lstHours: 1, effect: Number.POSITIVE_INFINITY }]), 'invalid_input'],
      [() => lstWindowScan([{ lstHours: 1, effect: 0 }], { stepHours: 0.7 }), 'invalid_options'],
    ]
    for (const [run, code] of cases) {
      try {
        run()
        throw new Error('expected a throw')
      } catch (error) {
        expect(error).toBeInstanceOf(EphemerisError)
        expect((error as EphemerisError).code).toBe(code as EphemerisError['code'])
      }
    }
  })
})
