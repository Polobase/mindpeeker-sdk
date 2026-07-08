import { describe, expect, test } from 'bun:test'
import { RateError } from '../src/errors.js'

describe('RateError', () => {
  test('carries code, name, and input', () => {
    const err = new RateError('invalid_rate', 'bad', { input: '99' })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('RateError')
    expect(err.code).toBe('invalid_rate')
    expect(err.input).toBe('99')
  })

  test('threads a cause when given', () => {
    const cause = new Error('root')
    const err = new RateError('aborted', 'stopped', { cause })
    expect(err.cause).toBe(cause)
  })

  test('omits cause when not given', () => {
    const err = new RateError('invalid_base', 'nope')
    expect(err.cause).toBeUndefined()
  })
})
