import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../src/errors.js'

describe('NegentropyError', () => {
  test('carries code, name, and message', () => {
    const err = new NegentropyError('insufficient_data', 'need at least 500 trials')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('NegentropyError')
    expect(err.code).toBe('insufficient_data')
    expect(err.message).toBe('need at least 500 trials')
    expect(err.source).toBeUndefined()
    expect(err.cause).toBeUndefined()
  })

  test('attributes a source and preserves the cause', () => {
    const inner = new Error('socket closed')
    const err = new NegentropyError('source_failed', 'drand stream failed', {
      source: 'drand',
      cause: inner,
    })
    expect(err.source).toBe('drand')
    expect(err.cause).toBe(inner)
  })
})
