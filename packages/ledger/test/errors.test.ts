import { describe, expect, test } from 'bun:test'
import { LedgerError } from '../src/errors.js'
import { LedgerError as FromIndex } from '../src/index.js'

describe('LedgerError', () => {
  test('carries code and name', () => {
    const err = new LedgerError('invalid_json', 'bad')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('LedgerError')
    expect(err.code).toBe('invalid_json')
    expect(err.message).toBe('bad')
  })

  test('threads a cause when given', () => {
    const cause = new Error('root')
    expect(new LedgerError('invalid_entry', 'x', { cause }).cause).toBe(cause)
  })

  test('omits cause when not given', () => {
    expect(new LedgerError('invalid_note', 'x').cause).toBeUndefined()
  })

  test('the index re-exports the same class', () => {
    expect(FromIndex).toBe(LedgerError)
  })
})
