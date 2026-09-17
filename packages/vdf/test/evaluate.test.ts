import { describe, expect, test } from 'bun:test'
import { evaluate } from '../src/evaluate.js'
import { hashToGroup } from '../src/hash.js'
import { expectVdfError } from './helpers/expect.js'
import { fromHex, loadFixture } from './helpers/fixture.js'
import { canonical, shortcutPower, TEST_MODULUS } from './helpers/test-modulus.js'

const fixture = loadFixture()
const pulse = new TextEncoder().encode('pulse-1')
const opts = { modulus: TEST_MODULUS }
const T_VALUES = [1, 2, 3, 7, 8, 1000, 4096]

describe('evaluate', () => {
  test('matches the canonical φ(n)-shortcut for odd/even/power-of-two/composite T', async () => {
    const x = await hashToGroup(pulse, TEST_MODULUS)
    for (const T of T_VALUES) {
      const result = await evaluate(pulse, T, opts)
      expect(result.x).toBe(x)
      expect(result.y).toBe(canonical(shortcutPower(x, T)))
      expect(result.checkpoints).toBeUndefined()
    }
  })

  test('matches the independent Python fixtures for every input and T', async () => {
    for (const { inputHex, T, y } of fixture.evaluate) {
      const result = await evaluate(fromHex(inputHex), T, opts)
      expect(result.y.toString()).toBe(y)
    }
  })

  test('outputs are canonical: y ≤ (n − 1)/2', async () => {
    for (const T of T_VALUES) {
      const { y } = await evaluate(pulse, T, opts)
      expect(y >= 1n && y <= (TEST_MODULUS.n - 1n) / 2n).toBe(true)
    }
  })

  test('is deterministic and freezes its result', async () => {
    const a = await evaluate(pulse, 8, opts)
    const b = await evaluate(pulse, 8, opts)
    expect(a.y).toBe(b.y)
    expect(Object.isFrozen(a)).toBe(true)
  })

  test('accepts ArrayLike<number> input', async () => {
    const viaArray = await evaluate(Array.from(pulse), 7, opts)
    const viaBytes = await evaluate(pulse, 7, opts)
    expect(viaArray.y).toBe(viaBytes.y)
  })

  test('reports progress every 1024 squarings with exactly one completion event', async () => {
    const calls: [number, number][] = []
    await evaluate(pulse, 4096, { ...opts, onProgress: (done, total) => calls.push([done, total]) })
    expect(calls).toEqual([
      [1024, 4096],
      [2048, 4096],
      [3072, 4096],
      [4096, 4096],
    ])
    const small: [number, number][] = []
    await evaluate(pulse, 8, { ...opts, onProgress: (done, total) => small.push([done, total]) })
    expect(small).toEqual([[8, 8]])
  })

  test('a pre-aborted signal throws VdfError(aborted)', async () => {
    const controller = new AbortController()
    controller.abort()
    await expectVdfError(evaluate(pulse, 8, { ...opts, signal: controller.signal }), 'aborted')
  })

  test('an abort during evaluation lands at the next block boundary', async () => {
    const controller = new AbortController()
    let calls = 0
    await expectVdfError(
      evaluate(pulse, 4096, {
        ...opts,
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

  test('an abort fired from a timer is observed thanks to the cooperative yield', async () => {
    const controller = new AbortController()
    const T = 5_000_000 // seconds of work — must be cut short
    let lastDone = 0
    setTimeout(() => controller.abort(), 20)
    await expectVdfError(
      evaluate(pulse, T, {
        ...opts,
        signal: controller.signal,
        onProgress: (done) => {
          lastDone = done
        },
      }),
      'aborted',
    )
    expect(lastDone).toBeGreaterThan(0)
    expect(lastDone).toBeLessThan(T)
  })

  test('rejects malformed T, input, modulus, and checkpoints', async () => {
    await expectVdfError(evaluate(pulse, 0, opts), 'invalid_input')
    await expectVdfError(evaluate(pulse, 1.5, opts), 'invalid_input')
    await expectVdfError(evaluate(pulse, -3, opts), 'invalid_input')
    await expectVdfError(evaluate(pulse, 2 ** 32, opts), 'invalid_input')
    await expectVdfError(evaluate(null as unknown as Uint8Array, 8, opts), 'invalid_input')
    await expectVdfError(evaluate(pulse, 8, { modulus: { n: 12n } }), 'invalid_modulus')
    await expectVdfError(evaluate(pulse, 8, { ...opts, checkpoints: 0 }), 'invalid_input')
    await expectVdfError(evaluate(pulse, 8, { ...opts, checkpoints: 9 }), 'invalid_input')
    await expectVdfError(evaluate(pulse, 8, { ...opts, checkpoints: 2.5 }), 'invalid_input')
  })
})

describe('evaluate with checkpoints', () => {
  test('stores |x^(2^(j·⌈T/k⌉))| for j = 0 … ⌊T/interval⌋ and leaves y unchanged', async () => {
    const x = await hashToGroup(pulse, TEST_MODULUS)
    for (const [T, k] of [
      [1, 1],
      [10, 4],
      [1000, 32],
      [1000, 1000],
      [4096, 64],
      [4097, 64],
    ] as const) {
      const plain = await evaluate(pulse, T, opts)
      const result = await evaluate(pulse, T, { ...opts, checkpoints: k })
      expect(result.y).toBe(plain.y)
      const cp = result.checkpoints
      if (cp === undefined) throw new Error('checkpoints missing')
      expect(cp.T).toBe(T)
      expect(cp.interval).toBe(Math.ceil(T / k))
      expect(cp.powers).toHaveLength(Math.floor(T / cp.interval) + 1)
      cp.powers.forEach((power, j) => {
        expect(power).toBe(canonical(shortcutPower(x, j * cp.interval)))
      })
      expect(Object.isFrozen(cp)).toBe(true)
      expect(Object.isFrozen(cp.powers)).toBe(true)
    }
  })

  test('checkpoints do not change progress reporting', async () => {
    const calls: [number, number][] = []
    await evaluate(pulse, 3000, {
      ...opts,
      checkpoints: 55,
      onProgress: (done, total) => calls.push([done, total]),
    })
    const completions = calls.filter(([done, total]) => done === total)
    expect(completions).toEqual([[3000, 3000]])
    for (let i = 1; i < calls.length; i++) {
      expect((calls[i] as [number, number])[0]).toBeGreaterThan(
        (calls[i - 1] as [number, number])[0],
      )
    }
  })
})
