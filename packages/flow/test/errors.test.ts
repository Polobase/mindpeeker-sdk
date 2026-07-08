import { describe, expect, test } from 'bun:test'
import { FlowError } from '../src/errors.js'

describe('FlowError', () => {
  test('carries code, name, and message', () => {
    const err = new FlowError('invalid_input', 'bad symbols')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('FlowError')
    expect(err.code).toBe('invalid_input')
    expect(err.message).toBe('bad symbols')
    expect(err.cause).toBeUndefined()
  })

  test('propagates a cause when given', () => {
    const cause = new Error('inner')
    const err = new FlowError('aborted', 'outer', { cause })
    expect(err.cause).toBe(cause)
  })

  test('every code constructs', () => {
    for (const code of [
      'invalid_input',
      'insufficient_data',
      'alphabet_overflow',
      'aborted',
    ] as const) {
      expect(new FlowError(code, code).code).toBe(code)
    }
  })
})
