import { describe, expect, test } from 'bun:test'
import { OracleError } from '@mindpeeker/oracle'
import { PsiError } from '@mindpeeker/psi'
import { ScanError } from '../../src/errors.js'
import { toScanError } from '../../src/internal/rethrow.js'
import { codedError } from '../helpers/byte-sources.js'

function mapped(error: unknown): ScanError {
  const out = toScanError(error, 'esp32', 'scan')
  expect(out).toBeInstanceOf(ScanError)
  return out as ScanError
}

describe('toScanError — one mapping for every entry point', () => {
  test('oracle codes', () => {
    expect(mapped(new OracleError('aborted', 'x')).code).toBe('aborted')
    expect(mapped(new OracleError('closed', 'x')).code).toBe('aborted')
    expect(mapped(new OracleError('insufficient_entropy', 'x')).code).toBe('insufficient_entropy')
    expect(mapped(new OracleError('invalid_input', 'non-byte chunk')).code).toBe('source_error')
  })

  test('a provider failure wrapped by oracle keeps the provider error as cause', () => {
    const health = codedError('EntropyError', 'health_test', 'RCT failed')
    const out = mapped(new OracleError('source_error', 'wrapped', { cause: health }))
    expect(out.code).toBe('source_error')
    expect(out.cause).toBe(health)
    expect(out.source).toBe('esp32')
    const io = new Error('EIO')
    expect(mapped(new OracleError('source_error', 'wrapped', { cause: io })).cause).toBe(io)
  })

  test('negentropy source_failed unwraps through oracle to the real meaning', () => {
    const starved = codedError('NegentropyError', 'source_failed', 'x') as Error & {
      cause?: unknown
    }
    Object.defineProperty(starved, 'cause', {
      value: new OracleError('insufficient_entropy', 'dry'),
    })
    expect(mapped(starved).code).toBe('insufficient_entropy')
    const failed = codedError('NegentropyError', 'source_failed', 'x')
    const health = codedError('EntropyError', 'health_test', 'APT')
    Object.defineProperty(failed, 'cause', {
      value: new OracleError('source_error', 'w', { cause: health }),
    })
    const out = mapped(failed)
    expect(out.code).toBe('source_error')
    expect(out.cause).toBe(health)
  })

  test('psi codes', () => {
    expect(mapped(new PsiError('aborted', 'x')).code).toBe('aborted')
    expect(mapped(new PsiError('insufficient_data', 'x')).code).toBe('insufficient_entropy')
    expect(mapped(new PsiError('invalid_plan', 'x')).code).toBe('invalid_options')
    expect(mapped(new PsiError('plan_mismatch', 'x')).code).toBe('invalid_options')
  })

  test('ScanError passes through; unknown errors are returned unchanged', () => {
    const own = new ScanError('invalid_catalog', 'x')
    expect(toScanError(own, 's', 'scan')).toBe(own)
    const callback = new TypeError('now() exploded')
    expect(toScanError(callback, 's', 'scan')).toBe(callback)
    const foreign = codedError('EntropyError', 'health_test', 'unwrapped')
    expect(toScanError(foreign, 's', 'scan')).toBe(foreign)
  })
})
