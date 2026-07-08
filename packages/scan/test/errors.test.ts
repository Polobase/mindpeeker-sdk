import { describe, expect, test } from 'bun:test'
import { ScanError } from '../src/errors.js'

describe('ScanError', () => {
  test('carries a stable code and the human message', () => {
    const err = new ScanError('invalid_catalog', 'no items')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ScanError')
    expect(err.code).toBe('invalid_catalog')
    expect(err.message).toBe('no items')
  })

  test('threads source and cause through', () => {
    const cause = new Error('root')
    const err = new ScanError('insufficient_entropy', 'dry', { source: 'anu', cause })
    expect(err.source).toBe('anu')
    expect(err.cause).toBe(cause)
  })

  test('omitting cause leaves it undefined', () => {
    const err = new ScanError('aborted', 'stopped')
    expect(err.cause).toBeUndefined()
    expect(err.source).toBeUndefined()
  })
})
