import { describe, expect, test } from 'bun:test'
import {
  assertCanonicalClaim,
  assertCheckpoints,
  MAX_T,
  MIN_MODULUS_BITS,
  toBytes,
} from '../../src/internal/validate.js'
import type { VdfCheckpoints } from '../../src/types.js'
import { expectVdfThrow } from '../helpers/expect.js'
import { TEST_MODULUS } from '../helpers/test-modulus.js'

const n = TEST_MODULUS.n

describe('toBytes', () => {
  test('always returns a private copy — including for Node Buffers, whose slice() aliases', () => {
    const view = new Uint8Array([1, 2, 3])
    const copy = toBytes(view, 'x')
    view[0] = 9
    expect(Array.from(copy)).toEqual([1, 2, 3])
    const buffer = Buffer.from('pulse-1')
    const fromBuffer = toBytes(buffer, 'x')
    buffer[0] = 0
    expect(fromBuffer[0]).toBe(112)
    expect(Object.getPrototypeOf(fromBuffer)).toBe(Uint8Array.prototype)
  })

  test('checks the declared length against maxLength before allocating', () => {
    expectVdfThrow(() => toBytes({ length: 2 ** 40 }, 'x', 100), 'invalid_input')
    expectVdfThrow(() => toBytes(new Uint8Array(101), 'x', 100), 'invalid_input')
    expect(toBytes(new Uint8Array(100), 'x', 100)).toHaveLength(100)
    expectVdfThrow(() => toBytes({ length: 2 ** 53 }, 'x'), 'invalid_input')
  })

  test('validates ArrayLike elements', () => {
    expect(Array.from(toBytes([0, 255], 'x'))).toEqual([0, 255])
    expectVdfThrow(() => toBytes([1.5], 'x'), 'invalid_input')
    expectVdfThrow(() => toBytes({ length: 1 }, 'x'), 'invalid_input')
    expectVdfThrow(() => toBytes('ab' as unknown as Uint8Array, 'x'), 'invalid_input')
  })
})

describe('constants and claims', () => {
  test('MAX_T is the u32 limit and MIN_MODULUS_BITS the test floor', () => {
    expect(MAX_T).toBe(2 ** 32 - 1)
    expect(MIN_MODULUS_BITS).toBe(64)
  })

  test('assertCanonicalClaim accepts exactly [1, (n − 1)/2]', () => {
    assertCanonicalClaim(1n, n)
    assertCanonicalClaim((n - 1n) / 2n, n)
    expectVdfThrow(() => assertCanonicalClaim(0n, n), 'invalid_input')
    expectVdfThrow(() => assertCanonicalClaim((n + 1n) / 2n, n), 'invalid_input')
  })
})

describe('assertCheckpoints', () => {
  const valid: VdfCheckpoints = { T: 10, interval: 4, powers: [2n, 3n, 4n] }

  test('accepts a well-formed object', () => {
    assertCheckpoints(valid, 10, n)
  })

  test('rejects every structural defect', () => {
    const bad: unknown[] = [
      null,
      { ...valid, T: 11 },
      { ...valid, interval: 0 },
      { ...valid, interval: 11 },
      { ...valid, interval: 2.5 },
      { ...valid, powers: [2n, 3n] },
      { ...valid, powers: [2n, 3n, 0n] },
      { ...valid, powers: [2n, 3n, n - 1n] },
      { ...valid, powers: [2n, 3n, 4] },
    ]
    for (const candidate of bad) {
      expectVdfThrow(() => assertCheckpoints(candidate as VdfCheckpoints, 10, n), 'invalid_input')
    }
  })
})
