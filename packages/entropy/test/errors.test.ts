import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../src/errors.js'

describe('EntropyError', () => {
  test('is an Error with name, code and message', () => {
    const err = new EntropyError('network', 'connection refused')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.name).toBe('EntropyError')
    expect(err.code).toBe('network')
    expect(err.message).toBe('connection refused')
  })

  test('carries provider, retryAfterMs and cause when given', () => {
    const cause = new Error('HTTP 500')
    const err = new EntropyError('rate_limited', 'slow down', {
      provider: 'anu-legacy',
      retryAfterMs: 60_000,
      cause,
    })
    expect(err.provider).toBe('anu-legacy')
    expect(err.retryAfterMs).toBe(60_000)
    expect(err.cause).toBe(cause)
  })

  test('optional fields are undefined when omitted', () => {
    const err = new EntropyError('auth', 'missing key')
    expect(err.provider).toBeUndefined()
    expect(err.retryAfterMs).toBeUndefined()
    expect(err.cause).toBeUndefined()
  })

  test('supports the health_test code for failed source health checks', () => {
    const err = new EntropyError('health_test', 'RCT tripped at cutoff 21', { provider: 'camera' })
    expect(err.code).toBe('health_test')
    expect(err.provider).toBe('camera')
  })

  test('supports AggregateError as cause for strategy failures', () => {
    const inner = new AggregateError(
      [new EntropyError('timeout', 'a timed out'), new EntropyError('network', 'b unreachable')],
      'all providers failed',
    )
    const err = new EntropyError('insufficient_entropy', 'all providers failed', { cause: inner })
    expect(err.cause).toBeInstanceOf(AggregateError)
    expect((err.cause as AggregateError).errors).toHaveLength(2)
  })
})
