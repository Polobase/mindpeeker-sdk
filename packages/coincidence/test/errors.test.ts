import { describe, expect, test } from 'bun:test'
import { CoincidenceError } from '../src/errors.js'

describe('CoincidenceError', () => {
  test('carries code, name, message and argument', () => {
    const err = new CoincidenceError('invalid_input', 'n must be …', { argument: 'n' })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('CoincidenceError')
    expect(err.code).toBe('invalid_input')
    expect(err.message).toBe('n must be …')
    expect(err.argument).toBe('n')
    expect(err.cause).toBeUndefined()
  })

  test('threads a cause; omits argument when not given', () => {
    const cause = new Error('inner')
    const err = new CoincidenceError('too_large', 'outer', { cause })
    expect(err.cause).toBe(cause)
    expect('argument' in err).toBe(false)
  })

  test('every code constructs', () => {
    for (const code of ['invalid_input', 'too_large'] as const) {
      expect(new CoincidenceError(code, code).code).toBe(code)
    }
  })
})
