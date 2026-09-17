import { describe, expect, test } from 'bun:test'
import { JudgingError } from '../src/errors.js'
import { directHits, JudgingError as FromIndex } from '../src/index.js'

describe('JudgingError', () => {
  test('carries code, name and argument', () => {
    const err = new JudgingError('invalid_input', 'bad', { argument: 'hits' })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('JudgingError')
    expect(err.code).toBe('invalid_input')
    expect(err.argument).toBe('hits')
    expect(err.message).toBe('bad')
  })

  test('threads a cause when given', () => {
    const cause = new Error('root')
    expect(new JudgingError('numerical', 'x', { cause }).cause).toBe(cause)
  })

  test('omits cause and argument when not given', () => {
    const err = new JudgingError('too_large', 'x')
    expect(err.cause).toBeUndefined()
    expect(err.argument).toBeUndefined()
  })

  test('the index re-exports the same class', () => {
    expect(FromIndex).toBe(JudgingError)
  })

  test('public functions throw JudgingError with a stable code', () => {
    try {
      directHits(3, 2, 4)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(JudgingError)
      expect((error as JudgingError).code).toBe('invalid_input')
      expect((error as JudgingError).argument).toBe('hits')
    }
  })
})
