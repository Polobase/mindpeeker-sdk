import { describe, expect, test } from 'bun:test'
import { VdfError } from '../src/errors.js'

describe('VdfError', () => {
  test('carries code, name, and message', () => {
    const err = new VdfError('invalid_input', 'T must be an integer in [1, 4294967295]')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('VdfError')
    expect(err.code).toBe('invalid_input')
    expect(err.message).toBe('T must be an integer in [1, 4294967295]')
    expect(err.cause).toBeUndefined()
  })

  test('preserves the cause', () => {
    const inner = new Error('subtle digest failed')
    const err = new VdfError('aborted', 'evaluation aborted', { cause: inner })
    expect(err.code).toBe('aborted')
    expect(err.cause).toBe(inner)
  })
})
