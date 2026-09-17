import { describe, expect, test } from 'bun:test'
import { binomialLogBayesFactor } from '../../src/bayes/binomial.js'
import { CoinEProcess, type CoinObservation, coinEProcess } from '../../src/bayes/eprocess.js'
import { Xoshiro128 } from '../../src/internal/prng.js'

const code = (c: string) =>
  expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error

const Z_975 = 1.959963984540054

/**
 * Exact probability that a fair coin's path ever satisfies `crosses(k, n)` for
 * some n ≤ N — dynamic programming over the unabsorbed mass of k (no sampling).
 * Valid for rules whose crossing set at each n is the complement of an interval
 * of k (true for |z| ≥ c and for {BF10 ≥ c}: BF10 is log-convex in k), so only
 * the two edges of the surviving support need checking.
 */
function exactCrossingProbability(N: number, crosses: (k: number, n: number) => boolean): number {
  const mass = new Float64Array(N + 2)
  mass[0] = 1
  let lo = 0
  let hi = 0
  let crossed = 0
  for (let n = 1; n <= N; n++) {
    for (let k = hi + 1; k >= lo; k--) {
      mass[k] = 0.5 * ((mass[k] as number) + (k > 0 ? (mass[k - 1] as number) : 0))
    }
    hi++
    while (lo <= hi && crosses(lo, n)) {
      crossed += mass[lo] as number
      mass[lo] = 0
      lo++
    }
    while (hi >= lo && crosses(hi, n)) {
      crossed += mass[hi] as number
      mass[hi] = 0
      hi--
    }
  }
  return crossed
}

describe('CoinEProcess', () => {
  test('tracks the running Bayes factor, its maximum, and the anytime p', () => {
    const process = new CoinEProcess({ a: 2, b: 2 })
    expect(process.current).toMatchObject({ k: 0, n: 0, lnBf10: 0, anytimeP: 1, reject: false })
    const observations: CoinObservation[] = [1, 1, { k: 3, n: 4 }, 0, { k: 10, n: 10 }]
    let k = 0
    let n = 0
    let lnMax = 0
    for (const obs of observations) {
      const point = process.update(obs)
      k += typeof obs === 'number' ? obs : obs.k
      n += typeof obs === 'number' ? 1 : obs.n
      const ln = binomialLogBayesFactor(k, n, { a: 2, b: 2 })
      lnMax = Math.max(lnMax, ln)
      expect(point.k).toBe(k)
      expect(point.n).toBe(n)
      expect(point.lnBf10).toBe(ln)
      expect(point.lnMaxBf10).toBe(lnMax)
      expect(point.anytimeP).toBeCloseTo(Math.min(1, Math.exp(-lnMax)), 14)
      expect(Object.isFrozen(point)).toBe(true)
    }
    expect(process.current.n).toBe(17)
  })

  test('the stop rule fires at max BF ≥ 1/alpha and stays fired', () => {
    const process = new CoinEProcess({ alpha: 0.01 })
    let fired = -1
    for (let i = 0; i < 40; i++) {
      const p = process.update(1)
      if (p.reject && fired < 0) fired = i
      if (fired >= 0) expect(p.reject).toBe(true)
    }
    // all ones, uniform prior: BF10(n, n) = 2^n/(n+1): 93.1 at n = 10, 170.7 at n = 11
    expect(fired).toBe(10)
    const p = process.update({ k: 480, n: 1000 }) // 520 of 1040: exactly balanced
    expect(p.lnBf10).toBeLessThan(0) // current evidence gone …
    expect(p.reject).toBe(true) // … but the anytime decision stands
  })

  test('law of the iterated logarithm: checking a fixed-n p every trial rejects a fair coin far more often than α; the e-process does not (exact DP)', () => {
    const N = 2000
    const naive = exactCrossingProbability(
      N,
      (k, n) => n >= 10 && Math.abs(2 * k - n) / Math.sqrt(n) >= Z_975,
    )
    const eprocess = exactCrossingProbability(
      N,
      (k, n) => binomialLogBayesFactor(k, n) >= Math.log(20),
    )
    // a nominal 5% test peeked at 1991 times rejects a fair coin more than half the time (0.511)
    expect(naive).toBeGreaterThan(0.5)
    // Ville: P(sup BF10 ≥ 20) ≤ 0.05 at every horizon
    expect(eprocess).toBeLessThanOrEqual(0.05)
    expect(eprocess).toBeGreaterThan(0) // not vacuous
    // the one-sided and general-null versions obey the same bound
    const oneSided = exactCrossingProbability(
      N,
      (k, n) =>
        binomialLogBayesFactor(k, n, { alternative: 'greater', a: 5, b: 5 }) >= Math.log(20),
    )
    expect(oneSided).toBeLessThanOrEqual(0.05)
  }, 30_000)

  test('the edge-scanning DP equals a full-support DP', () => {
    const naiveRule = (k: number, n: number) =>
      n >= 10 && Math.abs(2 * k - n) / Math.sqrt(n) >= Z_975
    const bfRule = (k: number, n: number) => binomialLogBayesFactor(k, n, { a: 3, b: 1 }) >= 2
    for (const rule of [naiveRule, bfRule]) {
      let mass = new Float64Array([1])
      let crossed = 0
      for (let n = 1; n <= 250; n++) {
        const next = new Float64Array(n + 1)
        for (let k = 0; k < mass.length; k++) {
          next[k] = (next[k] as number) + (mass[k] as number) / 2
          next[k + 1] = (next[k + 1] as number) + (mass[k] as number) / 2
        }
        for (let k = 0; k <= n; k++) {
          if ((next[k] as number) > 0 && rule(k, n)) {
            crossed += next[k] as number
            next[k] = 0
          }
        }
        mass = next
      }
      expect(exactCrossingProbability(250, rule)).toBeCloseTo(crossed, 14)
    }
  }, 30_000)

  test('Monte Carlo through the class agrees with the exact crossing probability', () => {
    const N = 400
    const sims = 3000
    const exact = exactCrossingProbability(N, (k, n) => binomialLogBayesFactor(k, n) >= Math.log(8))
    const rng = new Xoshiro128(20260917)
    let rejected = 0
    for (let s = 0; s < sims; s++) {
      const process = new CoinEProcess({ alpha: 1 / 8 })
      for (let i = 0; i < N; i++) {
        if (process.update((rng.nextUint32() & 1) as 0 | 1).reject) {
          rejected++
          break
        }
      }
    }
    const se = Math.sqrt((exact * (1 - exact)) / sims)
    expect(Math.abs(rejected / sims - exact)).toBeLessThan(4 * se)
  }, 30_000)

  test('validation leaves the state untouched', () => {
    expect(() => new CoinEProcess({ alpha: 0 })).toThrow(code('invalid_plan'))
    expect(() => new CoinEProcess({ alpha: 1 })).toThrow(code('invalid_plan'))
    expect(() => new CoinEProcess({ p0: 1 })).toThrow(code('invalid_plan'))
    const process = new CoinEProcess()
    process.update({ k: 3, n: 5 })
    for (const bad of [2, -1, 0.5, { k: 6, n: 5 }, { k: 1, n: 0 }, { k: 1.5, n: 3 }, null]) {
      expect(() => process.update(bad as unknown as CoinObservation)).toThrow(code('invalid_plan'))
    }
    expect(() => process.update({ k: 0, n: 2 ** 53 })).toThrow(code('invalid_plan'))
    expect(process.current).toMatchObject({ k: 3, n: 5 })
  })
})

describe('coinEProcess (stream)', () => {
  test('yields one point per observation from sync and async iterables', async () => {
    const bits: CoinObservation[] = [1, 0, 1, 1, { k: 2, n: 3 }]
    const fromSync: number[] = []
    for await (const p of coinEProcess(bits)) fromSync.push(p.lnBf10)
    async function* gen() {
      yield* bits
    }
    const fromAsync: number[] = []
    for await (const p of coinEProcess(gen())) fromAsync.push(p.lnBf10)
    expect(fromSync).toEqual(fromAsync)
    expect(fromSync.length).toBe(5)
  })

  test('stopOnReject ends at the stop rule and closes the input', async () => {
    let closed = false
    let pulled = 0
    async function* ones() {
      try {
        while (true) {
          pulled++
          yield 1 as const
        }
      } finally {
        closed = true
      }
    }
    const points = []
    for await (const p of coinEProcess(ones(), { stopOnReject: true, alpha: 0.05 })) points.push(p)
    // BF10(n, n) = 2^n/(n+1) ≥ 20 first at n = 8
    expect(points.length).toBe(8)
    expect(points.at(-1)?.reject).toBe(true)
    expect(pulled).toBe(8)
    expect(closed).toBe(true)
  })

  test('options are validated eagerly; abort raises aborted', async () => {
    expect(() => coinEProcess([], { alpha: 2 })).toThrow(code('invalid_plan'))
    expect(() => coinEProcess([], { stopOnReject: 'yes' as unknown as boolean })).toThrow(
      code('invalid_plan'),
    )
    expect(() => coinEProcess(42 as unknown as CoinObservation[])).toThrow(code('invalid_plan'))
    const controller = new AbortController()
    async function* slow() {
      yield 1 as const
      await new Promise(() => {}) // never resolves
    }
    const stream = coinEProcess(slow(), { signal: controller.signal })
    expect((await stream.next()).done).toBe(false)
    const pending = stream.next()
    controller.abort()
    await expect(pending).rejects.toThrow(code('aborted'))
    // a source that ends cleanly after the abort still reports aborted
    const c2 = new AbortController()
    async function* endsOnAbort() {
      yield 1 as const
      c2.abort()
    }
    const s2 = coinEProcess(endsOnAbort(), { signal: c2.signal })
    await s2.next()
    await expect(s2.next()).rejects.toThrow(code('aborted'))
    await expect(async () => {
      for await (const _ of coinEProcess([1, 7 as unknown as CoinObservation])) {
        // consume
      }
    }).toThrow(code('invalid_plan'))
  })
})
