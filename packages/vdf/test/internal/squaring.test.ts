import { describe, expect, test } from 'bun:test'
import { modPow } from '../../src/internal/bigint.js'
import { sequentialSquare } from '../../src/internal/squaring.js'
import { Work } from '../../src/internal/work.js'
import { expectVdfError } from '../helpers/expect.js'
import { TEST_MODULUS } from '../helpers/test-modulus.js'

const n = TEST_MODULUS.n

describe('sequentialSquare', () => {
  test('count squarings equal x^(2^count) mod n', async () => {
    const x = 1_234_567_891_011n
    for (const count of [0, 1, 2, 5, 100, 5000]) {
      expect(await sequentialSquare(x, count, n)).toBe(modPow(x, 2n ** BigInt(count), n))
    }
  })

  test('progress fires at block boundaries and at the ragged tail', async () => {
    const steps: number[] = []
    await sequentialSquare(3n, 3000, n, new Work(3000, undefined, (done) => steps.push(done)))
    expect(steps).toEqual([1024, 2048, 3000])
  })

  test('a shared meter accumulates across calls', async () => {
    const steps: [number, number][] = []
    const work = new Work(2500, undefined, (done, total) => steps.push([done, total]))
    let y = 3n
    for (const count of [700, 700, 700, 400]) y = await sequentialSquare(y, count, n, work)
    expect(y).toBe(modPow(3n, 2n ** 2500n, n))
    // 700 (no report), 1400 (≥ 1024 since the last report), 2100 (only 700 more), 2500 (final).
    expect(steps).toEqual([
      [1400, 2500],
      [2500, 2500],
    ])
  })

  test('a pre-aborted signal throws before any work, even for zero squarings', async () => {
    const controller = new AbortController()
    controller.abort()
    await expectVdfError(sequentialSquare(3n, 10, n, new Work(10, controller.signal)), 'aborted')
    await expectVdfError(sequentialSquare(3n, 0, n, new Work(0, controller.signal)), 'aborted')
  })

  test('an abort requested inside the progress callback lands at the next block boundary', async () => {
    const controller = new AbortController()
    const steps: number[] = []
    await expectVdfError(
      sequentialSquare(
        3n,
        10_000,
        n,
        new Work(10_000, controller.signal, (done) => {
          steps.push(done)
          controller.abort()
        }),
      ),
      'aborted',
    )
    expect(steps).toEqual([1024])
  })
})
