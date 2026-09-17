import { describe, expect, test } from 'bun:test'
import { calibrate } from '../src/calibrate.js'
import { MAX_T } from '../src/internal/validate.js'
import { expectVdfError, expectVdfThrow } from './helpers/expect.js'
import { TEST_MODULUS } from './helpers/test-modulus.js'

const opts = { modulus: TEST_MODULUS }

describe('calibrate', () => {
  test('reports the median of the per-window rates', async () => {
    const result = await calibrate(60, { ...opts, samples: 3 })
    expect(result.samples).toHaveLength(3)
    for (const rate of result.samples) {
      expect(Number.isFinite(rate)).toBe(true)
      expect(rate).toBeGreaterThan(0)
    }
    const sorted = result.samples.slice().sort((a, b) => a - b)
    expect(result.squaringsPerSecond).toBe(sorted[1] as number)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.samples)).toBe(true)
  })

  test('an even number of samples reports the midpoint of the middle two', async () => {
    const result = await calibrate(40, { ...opts, samples: 4 })
    const sorted = result.samples.slice().sort((a, b) => a - b)
    expect(result.squaringsPerSecond).toBeCloseTo(
      ((sorted[1] as number) + (sorted[2] as number)) / 2,
      6,
    )
  })

  test('suggestT is exactly round(sps · speedup · wallMs / 1000), clamped to [1, 2^32 − 1]', async () => {
    const result = await calibrate(20, { ...opts, samples: 1 })
    const sps = result.squaringsPerSecond
    for (const wallMs of [1, 250, 1000, 2000, 12_345]) {
      expect(result.suggestT(wallMs)).toBe(Math.max(1, Math.round((sps * wallMs) / 1000)))
      expect(result.suggestT(wallMs, { adversarySpeedup: 1000 })).toBe(
        Math.min(MAX_T, Math.max(1, Math.round((sps * 1000 * wallMs) / 1000))),
      )
    }
    // Rounding boundary: a wall time worth exactly 0.5 squarings rounds up to 1 … and 1.5 to 2.
    expect(result.suggestT(500 / sps)).toBe(1)
    expect(result.suggestT(1500 / sps)).toBe(2)
    expect(result.suggestT(1e-9)).toBe(1)
    expect(result.suggestT(1e15)).toBe(MAX_T)
  })

  test('honours a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expectVdfError(calibrate(20, { ...opts, signal: controller.signal }), 'aborted')
  })

  test('rejects malformed arguments', async () => {
    await expectVdfError(calibrate(0, opts), 'invalid_input')
    await expectVdfError(calibrate(-5, opts), 'invalid_input')
    await expectVdfError(calibrate(Number.NaN, opts), 'invalid_input')
    await expectVdfError(calibrate(50, { modulus: { n: 10n } }), 'invalid_modulus')
    await expectVdfError(calibrate(50, { ...opts, samples: 0 }), 'invalid_input')
    await expectVdfError(calibrate(50, { ...opts, samples: 1.5 }), 'invalid_input')
    const result = await calibrate(10, { ...opts, samples: 1 })
    expectVdfThrow(() => result.suggestT(0), 'invalid_input')
    expectVdfThrow(() => result.suggestT(Number.POSITIVE_INFINITY), 'invalid_input')
    expectVdfThrow(() => result.suggestT(1000, { adversarySpeedup: 0.5 }), 'invalid_input')
    expectVdfThrow(() => result.suggestT(1000, { adversarySpeedup: Number.NaN }), 'invalid_input')
  })
})
