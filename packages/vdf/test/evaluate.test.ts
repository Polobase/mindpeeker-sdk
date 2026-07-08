import { describe, expect, test } from 'bun:test'
import { evaluate } from '../src/evaluate.js'
import { hashToGroup } from '../src/hash.js'
import { expectVdfError } from './helpers/expect.js'
import { fromHex, loadFixture } from './helpers/fixture.js'
import { shortcutPower, TEST_MODULUS } from './helpers/test-modulus.js'

const fixture = loadFixture()
const pulse = new TextEncoder().encode('pulse-1')
const T_VALUES = [1, 2, 3, 7, 8, 1000, 4096]

describe('evaluate', () => {
  test('matches the φ(n)-shortcut for odd/even/power-of-two/composite T', async () => {
    const x = await hashToGroup(pulse, TEST_MODULUS)
    for (const T of T_VALUES) {
      const result = await evaluate(pulse, T, { modulus: TEST_MODULUS })
      expect(result.x).toBe(x)
      expect(result.y).toBe(shortcutPower(x, T))
    }
  })

  test('matches the independent Python fixtures for every input and T', async () => {
    for (const { inputHex, T, y } of fixture.evaluate) {
      const result = await evaluate(fromHex(inputHex), T, { modulus: TEST_MODULUS })
      expect(result.y.toString()).toBe(y)
    }
  })

  test('is deterministic and freezes its result', async () => {
    const a = await evaluate(pulse, 8, { modulus: TEST_MODULUS })
    const b = await evaluate(pulse, 8, { modulus: TEST_MODULUS })
    expect(a.y).toBe(b.y)
    expect(Object.isFrozen(a)).toBe(true)
  })

  test('accepts ArrayLike<number> input', async () => {
    const viaArray = await evaluate(Array.from(pulse), 7, { modulus: TEST_MODULUS })
    const viaBytes = await evaluate(pulse, 7, { modulus: TEST_MODULUS })
    expect(viaArray.y).toBe(viaBytes.y)
  })

  test('reports progress every 1024 squarings and once at completion', async () => {
    const calls: [number, number][] = []
    await evaluate(pulse, 4096, {
      modulus: TEST_MODULUS,
      onProgress: (done, total) => calls.push([done, total]),
    })
    expect(calls).toEqual([
      [1024, 4096],
      [2048, 4096],
      [3072, 4096],
      [4096, 4096],
      [4096, 4096],
    ])
  })

  test('a pre-aborted signal throws VdfError(aborted)', async () => {
    const controller = new AbortController()
    controller.abort()
    await expectVdfError(
      evaluate(pulse, 8, { modulus: TEST_MODULUS, signal: controller.signal }),
      'aborted',
    )
  })

  test('an abort during evaluation lands at the next block boundary', async () => {
    const controller = new AbortController()
    let calls = 0
    await expectVdfError(
      evaluate(pulse, 4096, {
        modulus: TEST_MODULUS,
        signal: controller.signal,
        onProgress: () => {
          calls++
          controller.abort()
        },
      }),
      'aborted',
    )
    expect(calls).toBe(1)
  })

  test('rejects malformed T, input, and modulus', async () => {
    await expectVdfError(evaluate(pulse, 0, { modulus: TEST_MODULUS }), 'invalid_input')
    await expectVdfError(evaluate(pulse, 1.5, { modulus: TEST_MODULUS }), 'invalid_input')
    await expectVdfError(evaluate(pulse, -3, { modulus: TEST_MODULUS }), 'invalid_input')
    await expectVdfError(evaluate(pulse, 2 ** 32, { modulus: TEST_MODULUS }), 'invalid_input')
    await expectVdfError(
      evaluate(null as unknown as Uint8Array, 8, { modulus: TEST_MODULUS }),
      'invalid_input',
    )
    await expectVdfError(evaluate(pulse, 8, { modulus: { n: 12n } }), 'invalid_modulus')
  })
})
