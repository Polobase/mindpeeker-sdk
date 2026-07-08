import { describe, expect, test } from 'bun:test'
import { modPow } from '../../src/internal/bigint.js'
import { sequentialSquare } from '../../src/internal/squaring.js'
import { expectVdfError } from '../helpers/expect.js'
import { TEST_MODULUS } from '../helpers/test-modulus.js'

const n = TEST_MODULUS.n

describe('sequentialSquare', () => {
  test('count squarings equal x^(2^count) mod n', async () => {
    const x = 1_234_567_891_011n
    for (const count of [0, 1, 2, 5, 100]) {
      expect(await sequentialSquare(x, count, n)).toBe(modPow(x, 2n ** BigInt(count), n))
    }
  })

  test('onStep fires at block boundaries and at the ragged tail', async () => {
    const steps: number[] = []
    await sequentialSquare(3n, 3000, n, { onStep: (done) => steps.push(done) })
    expect(steps).toEqual([1024, 2048, 3000])
  })

  test('a pre-aborted signal throws before any work', async () => {
    const controller = new AbortController()
    controller.abort()
    await expectVdfError(sequentialSquare(3n, 10, n, { signal: controller.signal }), 'aborted')
  })

  test('an abort requested inside onStep lands at the next block boundary', async () => {
    const controller = new AbortController()
    const steps: number[] = []
    await expectVdfError(
      sequentialSquare(3n, 10_000, n, {
        signal: controller.signal,
        onStep: (done) => {
          steps.push(done)
          controller.abort()
        },
      }),
      'aborted',
    )
    expect(steps).toEqual([1024])
  })
})
