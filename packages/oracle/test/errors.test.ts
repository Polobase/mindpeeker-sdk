import { describe, expect, test } from 'bun:test'
import { OracleError } from '../src/errors.js'

describe('OracleError', () => {
  test('carries code, name, and message', () => {
    const err = new OracleError('invalid_input', 'bad n')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('OracleError')
    expect(err.code).toBe('invalid_input')
    expect(err.message).toBe('bad n')
    expect(err.source).toBeUndefined()
    expect(err.cause).toBeUndefined()
  })

  test('carries source and cause when given', () => {
    const cause = new Error('socket closed')
    const err = new OracleError('insufficient_entropy', 'stream ended', { source: 'anu', cause })
    expect(err.source).toBe('anu')
    expect(err.cause).toBe(cause)
  })
})
