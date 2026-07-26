import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'

describe('GematriaError', () => {
  test('carries a stable code, a name, and an optional cipher', () => {
    const err = new GematriaError('no_match', 'nothing found', { cipher: 'he-hechrachi' })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('GematriaError')
    expect(err.code).toBe('no_match')
    expect(err.cipher).toBe('he-hechrachi')
    expect(err.message).toBe('nothing found')
  })

  test('threads a cause when given', () => {
    const cause = new Error('root')
    const err = new GematriaError('invalid_input', 'bad', { cause })
    expect(err.cause).toBe(cause)
  })

  test('omits cause when not given', () => {
    const err = new GematriaError('unknown_cipher', 'x')
    expect(err.cause).toBeUndefined()
  })
})
