import { describe, expect, test } from 'bun:test'
import { calibrate } from '../src/calibrate.js'
import { MAX_T } from '../src/internal/validate.js'
import { expectVdfError, expectVdfThrow } from './helpers/expect.js'
import { TEST_MODULUS } from './helpers/test-modulus.js'

describe('calibrate', () => {
  test('measures a sane positive squaring rate on the test modulus', async () => {
    const result = await calibrate(50, { modulus: TEST_MODULUS })
    expect(Number.isFinite(result.squaringsPerSecond)).toBe(true)
    expect(result.squaringsPerSecond).toBeGreaterThan(0)
    expect(Object.isFrozen(result)).toBe(true)
  })

  test('suggestT is proportional, clamped to [1, 2^32 − 1]', async () => {
    const result = await calibrate(50, { modulus: TEST_MODULUS })
    const oneSecond = result.suggestT(1000)
    expect(oneSecond).toBeGreaterThanOrEqual(1)
    expect(Number.isInteger(oneSecond)).toBe(true)
    expect(result.suggestT(2000)).toBeGreaterThanOrEqual(oneSecond)
    expect(result.suggestT(1e-9)).toBe(1)
    expect(result.suggestT(1e15)).toBe(MAX_T)
    // ~2× proportionality within measurement noise
    expect(result.suggestT(2000)).toBeGreaterThan(oneSecond)
  })

  test('rejects malformed arguments', async () => {
    await expectVdfError(calibrate(0, { modulus: TEST_MODULUS }), 'invalid_input')
    await expectVdfError(calibrate(-5, { modulus: TEST_MODULUS }), 'invalid_input')
    await expectVdfError(calibrate(Number.NaN, { modulus: TEST_MODULUS }), 'invalid_input')
    await expectVdfError(calibrate(50, { modulus: { n: 10n } }), 'invalid_modulus')
    const result = await calibrate(50, { modulus: TEST_MODULUS })
    expectVdfThrow(() => result.suggestT(0), 'invalid_input')
    expectVdfThrow(() => result.suggestT(Number.POSITIVE_INFINITY), 'invalid_input')
  })
})
