import { describe, expect, test } from 'bun:test'
import { evaluate } from '../src/evaluate.js'
import { pietrzakProve, pietrzakRounds } from '../src/prove.js'
import { expectVdfError, expectVdfThrow } from './helpers/expect.js'
import { fromHex, loadFixture } from './helpers/fixture.js'
import { TEST_MODULUS } from './helpers/test-modulus.js'

const fixture = loadFixture()
const pulse = new TextEncoder().encode('pulse-1')

describe('pietrzakRounds', () => {
  test('equals ceil(log2 T) via repeated ceiling-halving', () => {
    const expected: [number, number][] = [
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 2],
      [7, 3],
      [8, 3],
      [1000, 10],
      [4096, 12],
      [2 ** 20, 20],
      [0xffff_ffff, 32],
    ]
    for (const [T, rounds] of expected) expect(pietrzakRounds(T)).toBe(rounds)
  })

  test('rejects invalid T', () => {
    expectVdfThrow(() => pietrzakRounds(0), 'invalid_input')
    expectVdfThrow(() => pietrzakRounds(1.5), 'invalid_input')
  })
})

describe('pietrzakProve', () => {
  test('reproduces the independent Python proofs midpoint-for-midpoint', async () => {
    for (const { inputHex, T, y, mus } of fixture.proofs) {
      const proof = await pietrzakProve(fromHex(inputHex), T, BigInt(y), {
        modulus: TEST_MODULUS,
      })
      expect(proof.T).toBe(T)
      expect(proof.y.toString()).toBe(y)
      expect(proof.mus.map((mu) => mu.toString())).toEqual(mus)
    }
  })

  test('T=1 produces an empty midpoint list', async () => {
    const { y } = await evaluate(pulse, 1, { modulus: TEST_MODULUS })
    const proof = await pietrzakProve(pulse, 1, y, { modulus: TEST_MODULUS })
    expect(proof.mus).toHaveLength(0)
  })

  test('the proof and its midpoint list are frozen', async () => {
    const { y } = await evaluate(pulse, 8, { modulus: TEST_MODULUS })
    const proof = await pietrzakProve(pulse, 8, y, { modulus: TEST_MODULUS })
    expect(Object.isFrozen(proof)).toBe(true)
    expect(Object.isFrozen(proof.mus)).toBe(true)
  })

  test('progress covers the total midpoint squarings (≈ T) and completes', async () => {
    const { y } = await evaluate(pulse, 4096, { modulus: TEST_MODULUS })
    const calls: [number, number][] = []
    await pietrzakProve(pulse, 4096, y, {
      modulus: TEST_MODULUS,
      onProgress: (done, total) => calls.push([done, total]),
    })
    const last = calls[calls.length - 1] as [number, number]
    // Σ ceil(T_i / 2) for 4096 → 2048 → … → 1 is 4095.
    expect(last).toEqual([4095, 4095])
    for (const [done, total] of calls) {
      expect(total).toBe(4095)
      expect(done).toBeLessThanOrEqual(total)
    }
  })

  test('a pre-aborted signal throws VdfError(aborted)', async () => {
    const { y } = await evaluate(pulse, 8, { modulus: TEST_MODULUS })
    const controller = new AbortController()
    controller.abort()
    await expectVdfError(
      pietrzakProve(pulse, 8, y, { modulus: TEST_MODULUS, signal: controller.signal }),
      'aborted',
    )
  })

  test('rejects malformed y and T', async () => {
    const { y } = await evaluate(pulse, 8, { modulus: TEST_MODULUS })
    await expectVdfError(pietrzakProve(pulse, 8, 0n, { modulus: TEST_MODULUS }), 'invalid_input')
    await expectVdfError(
      pietrzakProve(pulse, 8, TEST_MODULUS.n, { modulus: TEST_MODULUS }),
      'invalid_input',
    )
    await expectVdfError(
      pietrzakProve(pulse, 8, '5' as unknown as bigint, { modulus: TEST_MODULUS }),
      'invalid_input',
    )
    await expectVdfError(pietrzakProve(pulse, 0, y, { modulus: TEST_MODULUS }), 'invalid_input')
  })
})
