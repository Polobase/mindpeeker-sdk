import { describe, expect, test } from 'bun:test'
import { evaluate } from '../src/evaluate.js'
import { pietrzakProve, pietrzakProveCost, pietrzakRounds } from '../src/prove.js'
import { pietrzakVerify } from '../src/verify.js'
import { expectVdfError, expectVdfThrow } from './helpers/expect.js'
import { fromHex, loadFixture } from './helpers/fixture.js'
import { TEST_MODULUS } from './helpers/test-modulus.js'

const fixture = loadFixture()
const pulse = new TextEncoder().encode('pulse-1')
const opts = { modulus: TEST_MODULUS }

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

describe('pietrzakProveCost', () => {
  test('without checkpoints: Σ ceil(T_i / 2) over the halving chain', () => {
    for (const T of [1, 2, 3, 7, 1000, 4096, 0xffff_ffff]) {
      let t = T
      let sum = 0
      while (t > 1) {
        t = Math.ceil(t / 2)
        sum += t
      }
      expect(pietrzakProveCost(T)).toBe(sum)
    }
  })

  test('√T checkpoints cut the proving squarings by orders of magnitude', () => {
    for (const T of [2 ** 20, 1_000_003, 0xffff_ffff]) {
      const interval = Math.ceil(T / Math.ceil(Math.sqrt(T)))
      expect(pietrzakProveCost(T, interval)).toBeLessThan(pietrzakProveCost(T) / 10)
    }
    expect(pietrzakProveCost(1000, 1000)).toBeLessThanOrEqual(pietrzakProveCost(1000))
  })

  test('rejects an invalid interval', () => {
    expectVdfThrow(() => pietrzakProveCost(100, 0), 'invalid_input')
    expectVdfThrow(() => pietrzakProveCost(100, 101), 'invalid_input')
    expectVdfThrow(() => pietrzakProveCost(100, 1.5), 'invalid_input')
  })
})

describe('pietrzakProve', () => {
  test('reproduces the independent Python proofs midpoint-for-midpoint', async () => {
    for (const { inputHex, T, y, mus } of fixture.proofs) {
      const proof = await pietrzakProve(fromHex(inputHex), T, BigInt(y), opts)
      expect(proof.T).toBe(T)
      expect(proof.y.toString()).toBe(y)
      expect(proof.mus.map((mu) => mu.toString())).toEqual(mus)
    }
  })

  test('reproduces Python on RSA-2048 (T=64) and a 522-bit modulus (T=100)', async () => {
    const rsa = fixture.rsa2048.proof
    const got = await pietrzakProve(fromHex(rsa.inputHex), rsa.T, BigInt(rsa.y))
    expect(got.mus.map(String)).toEqual(rsa.mus)
    const odd = fixture.oddWidth.proof
    const oddModulus = { n: BigInt(fixture.oddWidth.n) }
    const oddProof = await pietrzakProve(fromHex(odd.inputHex), odd.T, BigInt(odd.y), {
      modulus: oddModulus,
    })
    expect(oddProof.mus.map(String)).toEqual(odd.mus)
    expect(
      await pietrzakVerify(fromHex(odd.inputHex), odd.T, BigInt(odd.y), oddProof, {
        modulus: oddModulus,
      }),
    ).toBe(true)
  })

  test('T=1 produces an empty midpoint list and a single (0, 0) completion event', async () => {
    const { y } = await evaluate(pulse, 1, opts)
    const calls: [number, number][] = []
    const proof = await pietrzakProve(pulse, 1, y, {
      ...opts,
      onProgress: (done, total) => calls.push([done, total]),
    })
    expect(proof.mus).toHaveLength(0)
    expect(calls).toEqual([[0, 0]])
  })

  test('the proof and its midpoint list are frozen', async () => {
    const { y } = await evaluate(pulse, 8, opts)
    const proof = await pietrzakProve(pulse, 8, y, opts)
    expect(Object.isFrozen(proof)).toBe(true)
    expect(Object.isFrozen(proof.mus)).toBe(true)
  })

  test('progress is monotone over pietrzakProveCost(T) with exactly one completion', async () => {
    const { y } = await evaluate(pulse, 4096, opts)
    const calls: [number, number][] = []
    await pietrzakProve(pulse, 4096, y, { ...opts, onProgress: (d, t) => calls.push([d, t]) })
    expect(calls.at(-1)).toEqual([4095, 4095])
    expect(calls.filter(([d, t]) => d === t)).toHaveLength(1)
    for (const [done, total] of calls) {
      expect(total).toBe(pietrzakProveCost(4096))
      expect(done).toBeLessThanOrEqual(total)
    }
  })

  test('a pre-aborted signal throws VdfError(aborted)', async () => {
    const { y } = await evaluate(pulse, 8, opts)
    const controller = new AbortController()
    controller.abort()
    await expectVdfError(
      pietrzakProve(pulse, 8, y, { ...opts, signal: controller.signal }),
      'aborted',
    )
  })

  test('an abort during a midpoint chain throws VdfError(aborted)', async () => {
    const { y } = await evaluate(pulse, 5000, opts)
    const controller = new AbortController()
    await expectVdfError(
      pietrzakProve(pulse, 5000, y, {
        ...opts,
        signal: controller.signal,
        onProgress: (done) => {
          if (done >= 2048) controller.abort()
        },
      }),
      'aborted',
    )
  })

  test('rejects malformed y and T, including non-canonical claims', async () => {
    const { y } = await evaluate(pulse, 8, opts)
    const n = TEST_MODULUS.n
    await expectVdfError(pietrzakProve(pulse, 8, 0n, opts), 'invalid_input')
    await expectVdfError(pietrzakProve(pulse, 8, n, opts), 'invalid_input')
    await expectVdfError(pietrzakProve(pulse, 8, (n + 1n) / 2n, opts), 'invalid_input')
    await expectVdfError(pietrzakProve(pulse, 8, n - y, opts), 'invalid_input')
    await expectVdfError(pietrzakProve(pulse, 8, '5' as unknown as bigint, opts), 'invalid_input')
    await expectVdfError(pietrzakProve(pulse, 0, y, opts), 'invalid_input')
  })
})

describe('pietrzakProve with checkpoints', () => {
  const cases: [number, number][] = [
    [2, 2],
    [3, 1],
    [5, 2],
    [8, 8],
    [17, 4],
    [1000, 32],
    [1024, 32],
    [4097, 64],
    [5000, 71],
  ]
  for (const [T, k] of cases) {
    test(`T=${T}, k=${k}: identical proof, progress totals pietrzakProveCost`, async () => {
      const plain = await evaluate(pulse, T, opts)
      const baseline = await pietrzakProve(pulse, T, plain.y, opts)
      const withCp = await evaluate(pulse, T, { ...opts, checkpoints: k })
      const calls: [number, number][] = []
      const proof = await pietrzakProve(pulse, T, withCp.y, {
        ...opts,
        checkpoints: withCp.checkpoints,
        onProgress: (d, t) => calls.push([d, t]),
      })
      expect(proof.mus).toEqual(baseline.mus as bigint[])
      const cost = pietrzakProveCost(T, Math.ceil(T / k))
      expect(calls.at(-1)).toEqual([cost, cost])
      expect(calls.filter(([d, t]) => d === t)).toHaveLength(1)
    })
  }

  test('rejects checkpoints from another T, input, or with a broken shape', async () => {
    const a = await evaluate(pulse, 100, { ...opts, checkpoints: 10 })
    const other = await evaluate(new TextEncoder().encode('other'), 100, {
      ...opts,
      checkpoints: 10,
    })
    const cp = a.checkpoints
    if (cp === undefined) throw new Error('checkpoints missing')
    await expectVdfError(
      pietrzakProve(pulse, 99, a.y, { ...opts, checkpoints: cp }),
      'invalid_input',
    )
    await expectVdfError(
      pietrzakProve(pulse, 100, a.y, { ...opts, checkpoints: other.checkpoints }),
      'invalid_input',
    )
    await expectVdfError(
      pietrzakProve(pulse, 100, a.y, {
        ...opts,
        checkpoints: { ...cp, powers: cp.powers.slice(1) },
      }),
      'invalid_input',
    )
    await expectVdfError(
      pietrzakProve(pulse, 100, a.y, { ...opts, checkpoints: { ...cp, interval: 0 } }),
      'invalid_input',
    )
  })
})
