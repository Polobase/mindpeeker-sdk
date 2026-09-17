import { describe, expect, test } from 'bun:test'
import { canonicalJson } from '@mindpeeker/negentropy'
import { binomialLogBayesFactor } from '../../src/bayes/binomial.js'
import type { CoinObservation } from '../../src/bayes/eprocess.js'
import {
  runSequential,
  SEQUENTIAL_SCHEMA,
  type SequentialLook,
  sequentialPlan,
  sequentialPlanDigest,
} from '../../src/bayes/sequential.js'
import { Xoshiro128 } from '../../src/internal/prng.js'

const code = (c: string) =>
  expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function bits(count: number, seed: number, pOne = 0.5): (0 | 1)[] {
  const rng = new Xoshiro128(seed)
  return Array.from({ length: count }, () => (rng.nextUint32() / 2 ** 32 < pOne ? 1 : 0))
}

describe('sequentialPlan', () => {
  test('resolves defaults, freezes, and hashes the canonical JSON', async () => {
    const plan = sequentialPlan({ bfStop: 10, maxTrials: 1000 })
    expect(plan).toEqual({
      schema: SEQUENTIAL_SCHEMA,
      bfStop: 10,
      minTrials: 1,
      maxTrials: 1000,
      looks: 'every',
      prior: { a: 1, b: 1, p0: 0.5, alternative: 'two-sided' },
    })
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.prior)).toBe(true)
    // independent digest: sorted keys, no whitespace
    const text =
      '{"bfStop":10,"looks":"every","maxTrials":1000,"minTrials":1,' +
      '"prior":{"a":1,"alternative":"two-sided","b":1,"p0":0.5},"schema":"psi/sequential/1"}'
    expect(canonicalJson(plan)).toBe(text)
    expect(await sequentialPlanDigest(plan)).toBe(await sha256(text))
    // a resolved plan re-resolves to itself; equivalent specs hash identically
    expect(sequentialPlan(plan)).toEqual(plan)
    expect(
      await sequentialPlanDigest({ bfStop: 10, maxTrials: 1000, looks: 'every', prior: {} }),
    ).toBe(await sequentialPlanDigest(plan))
    expect(await sequentialPlanDigest({ bfStop: 10, maxTrials: 1001 })).not.toBe(
      await sequentialPlanDigest(plan),
    )
  })

  test('rejects malformed designs', () => {
    const bad = code('invalid_plan')
    const base = { bfStop: 10, maxTrials: 100 }
    expect(() => sequentialPlan({ ...base, bfStop: 1 })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, bfStop: Number.POSITIVE_INFINITY })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, bfStopNull: 1 })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, minTrials: 0 })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, minTrials: 200 })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, maxTrials: 2.5 })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, looks: [10, 10] })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, looks: [50, 20] })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, looks: [101] })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, minTrials: 20, looks: [10, 50] })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, looks: { every: 0 } })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, looks: 'often' as unknown as 'every' })).toThrow(bad)
    expect(() => sequentialPlan({ ...base, prior: { p0: 0 } })).toThrow(bad)
    expect(() =>
      sequentialPlan({ ...base, schema: 'psi/sequential/9' } as unknown as typeof base),
    ).toThrow(bad)
  })
})

describe('runSequential', () => {
  test('stops for H1 at the first look crossing bfStop and closes the input', async () => {
    let pulled = 0
    let closed = false
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
    const looks: SequentialLook[] = []
    const outcome = await runSequential(
      ones(),
      { bfStop: 20, maxTrials: 1000, looks: { every: 5 } },
      { onLook: (look) => looks.push(look) },
    )
    // BF10(n, n) = 2^n/(n+1): 5.3 at n = 5, 93.1 at n = 10
    expect(outcome.decision).toBe('stop_h1')
    expect(outcome.n).toBe(10)
    expect(pulled).toBe(10)
    expect(closed).toBe(true)
    expect(looks.map((l) => l.n)).toEqual([5, 10])
    expect(looks.map((l) => l.decision)).toEqual(['continue', 'stop_h1'])
    expect(outcome.looks).toEqual(looks)
    expect(outcome.lnBf10).toBeCloseTo(10 * Math.LN2 - Math.log(11), 12)
    expect(outcome.anytimeP).toBeCloseTo(11 / 1024, 12)
    expect(outcome.planDigest).toBe(
      await sequentialPlanDigest({ bfStop: 20, maxTrials: 1000, looks: { every: 5 } }),
    )
  })

  test('stops for H0, at the maximum, or reports incomplete', async () => {
    const fair = bits(4000, 7)
    const h0 = await runSequential(fair, {
      bfStop: 100,
      bfStopNull: 1 / 3,
      minTrials: 100,
      maxTrials: 4000,
      looks: [100, 500, 1000, 2000, 4000],
    })
    expect(h0.decision).toBe('stop_h0')
    expect(h0.looks.at(-1)?.decision).toBe('stop_h0')
    for (const look of h0.looks) {
      const k = fair.slice(0, look.n).reduce<number>((s, b) => s + b, 0)
      expect(look.k).toBe(k)
      expect(look.lnBf10).toBe(binomialLogBayesFactor(k, look.n))
    }
    const max = await runSequential(bits(300, 8), { bfStop: 1e6, maxTrials: 300, looks: [] })
    expect(max.decision).toBe('stop_max')
    expect(max.looks.map((l) => l.n)).toEqual([300])
    const incomplete = await runSequential(bits(50, 9), { bfStop: 1e6, maxTrials: 300 })
    expect(incomplete.decision).toBe('incomplete')
    expect(incomplete.n).toBe(50)
    expect(incomplete.looks.length).toBe(50)
  })

  test('minTrials suppresses early looks; multi-trial observations overshoot look points', async () => {
    const trials: CoinObservation[] = Array.from({ length: 20 }, () => ({ k: 150, n: 200 }))
    const outcome = await runSequential(trials, {
      bfStop: 1e300,
      maxTrials: 3000,
      minTrials: 600,
      looks: { every: 250 },
    })
    // cumulative n = 200, 400, …; look points 250·j are reached at 400 (suppressed: < 600),
    // 600, 800, 1000, then 1400 (1250), 1600, 1800, 2000, 2400 (2250), 2600, 2800, and 3000 (max)
    expect(outcome.looks.map((l) => l.n)).toEqual([
      600, 800, 1000, 1400, 1600, 1800, 2000, 2400, 2600, 2800, 3000,
    ])
    expect(outcome.decision).toBe('stop_max')
  })

  test('with bfStop = 1/α and a look after every trial, false H1 stops stay below α', async () => {
    const sims = 400
    let stops = 0
    for (let s = 0; s < sims; s++) {
      const outcome = await runSequential(bits(500, 1000 + s), { bfStop: 10, maxTrials: 500 })
      if (outcome.decision === 'stop_h1') stops++
    }
    // Ville: P ≤ 0.1; three binomial standard errors of slack for the Monte Carlo
    expect(stops / sims).toBeLessThan(0.1 + 3 * Math.sqrt((0.1 * 0.9) / sims))
  }, 30_000)

  test('general null and one-sided prior flow through', async () => {
    // ganzfeld-style sessions, p0 = 1/4, 34% hits
    const sessions = bits(354, 11, 0.34)
    const outcome = await runSequential(sessions, {
      bfStop: 1e300,
      maxTrials: 354,
      looks: [354],
      prior: { p0: 0.25, alternative: 'greater' },
    })
    const k = sessions.reduce<number>((s, b) => s + b, 0)
    expect(outcome.lnBf10).toBe(
      binomialLogBayesFactor(k, 354, { p0: 0.25, alternative: 'greater' }),
    )
  })

  test('errors: bad observations, bad options, abort', async () => {
    await expect(
      runSequential([1, 3 as unknown as 0], { bfStop: 10, maxTrials: 10 }),
    ).rejects.toThrow(code('invalid_plan'))
    await expect(
      runSequential([1], { bfStop: 10, maxTrials: 10 }, { onLook: 5 as unknown as () => void }),
    ).rejects.toThrow(code('invalid_plan'))
    const controller = new AbortController()
    async function* endsOnAbort() {
      yield 1 as const
      controller.abort()
    }
    await expect(
      runSequential(endsOnAbort(), { bfStop: 1e9, maxTrials: 10 }, { signal: controller.signal }),
    ).rejects.toThrow(code('aborted'))
  })
})
