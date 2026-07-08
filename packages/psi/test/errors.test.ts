import { describe, expect, test } from 'bun:test'
import { PsiError } from '../src/errors.js'

describe('PsiError', () => {
  test('carries code, name, source, and cause', () => {
    const cause = new Error('boom')
    const error = new PsiError('bad_record', 'line 3 is not valid JSON', {
      source: 'anu',
      cause,
    })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PsiError')
    expect(error.code).toBe('bad_record')
    expect(error.source).toBe('anu')
    expect(error.cause).toBe(cause)
    expect(error.message).toBe('line 3 is not valid JSON')
  })

  test('omits cause when not given', () => {
    const error = new PsiError('aborted', 'stopped')
    expect(error.cause).toBeUndefined()
    expect(error.source).toBeUndefined()
  })
})
