import { describe, expect, test } from 'bun:test'
import { consensusRank, rankOrderStatistic, sumOfRanksDistribution } from '../src/index.js'
import { expectClose, expectJudgingError, fixtures } from './helpers/fixtures.js'

/** Exact bigint counts of sums of n uniform ranks on 1…k (index = sum − n). */
function bigintCounts(n: number, k: number): bigint[] {
  let dist = [1n]
  for (let step = 0; step < n; step++) {
    const next = new Array<bigint>(dist.length + k - 1).fill(0n)
    dist.forEach((c, i) => {
      for (let d = 0; d < k; d++) next[i + d] = (next[i + d] as bigint) + c
    })
    dist = next
  }
  return dist
}

describe('sumOfRanksDistribution', () => {
  test('equals bigint convolution exactly for small designs', () => {
    for (const [n, k] of [
      [1, 2],
      [3, 4],
      [7, 3],
      [10, 6],
      [15, 4],
    ] as const) {
      const d = sumOfRanksDistribution(n, k)
      const counts = bigintCounts(n, k)
      const total = Number(BigInt(k) ** BigInt(n))
      expect(d.pmf.length).toBe(counts.length)
      expect(d.min).toBe(n)
      expect(d.max).toBe(n * k)
      counts.forEach((c, i) => {
        expectClose(d.pmf[i] as number, Number(c) / total, 1e-13)
      })
    }
    const fixture = sumOfRanksDistribution(8, 4).pmf
    fixtures.ranks.pmf8x4.forEach((p, i) => {
      expectClose(fixture[i] as number, p, 1e-14)
    })
  })

  test('tail probabilities keep relative precision far out in the tail', () => {
    for (const c of fixtures.ranks.tails) {
      const d = sumOfRanksDistribution(c.trials, c.choices)
      let lower = 0
      for (let i = 0; i <= c.sum - c.trials; i++) lower += d.pmf[i] as number
      expectClose(lower, c.lower, 1e-10, 1e-300)
    }
  })

  test('validates', () => {
    expectJudgingError(() => sumOfRanksDistribution(0, 4), 'invalid_input')
    expectJudgingError(() => sumOfRanksDistribution(5, 1), 'invalid_options')
    expectJudgingError(() => sumOfRanksDistribution(100_000, 4), 'too_large')
  })
})

describe('rankOrderStatistic', () => {
  test("mean rank, Utts' effect size and exact p", () => {
    const ranks = [1, 2, 1, 3, 4, 1, 2, 2]
    const r = rankOrderStatistic(ranks, 4)
    expect(r.sumOfRanks).toBe(16)
    expect(r.meanRank).toBe(2)
    expect(r.hits).toBe(3)
    expect(r.expectedMeanRank).toBe(2.5)
    expectClose(r.rankSd, Math.sqrt(15 / 12), 1e-15)
    expectClose(r.effectSize, 0.5 / Math.sqrt(15 / 12), 1e-15)
    const counts = bigintCounts(8, 4)
    const lower = counts.slice(0, 16 - 8 + 1).reduce((a, b) => a + b, 0n)
    const upper = counts.slice(16 - 8).reduce((a, b) => a + b, 0n)
    expectClose(r.pExact, Number(lower) / 4 ** 8, 1e-14)
    expectClose(r.pExactUpper, Number(upper) / 4 ** 8, 1e-14)
    // continuity-corrected normal approximation
    expectClose(r.z, (8 * 2.5 - 16 - 0.5) / Math.sqrt((8 * 15) / 12), 1e-15)
  })

  test('for N = 5 targets ES = (3 − mean rank)/√2 (Utts 1996)', () => {
    const r = rankOrderStatistic([1, 2, 3, 1, 1], 5)
    expectClose(r.effectSize, (3 - 8 / 5) / Math.SQRT2, 1e-15)
  })

  test('validates', () => {
    expectJudgingError(() => rankOrderStatistic([], 4), 'invalid_input')
    expectJudgingError(() => rankOrderStatistic([0, 1], 4), 'invalid_input')
    expectJudgingError(() => rankOrderStatistic([5], 4), 'invalid_input')
    expectJudgingError(() => rankOrderStatistic([1.5], 4), 'invalid_input')
    expectJudgingError(() => rankOrderStatistic([1], 1), 'invalid_options')
  })
})

describe('consensusRank', () => {
  test('rank sums, mid-ranks and Kendall W without ties', () => {
    const r = consensusRank([
      [1, 2, 3, 4],
      [2, 1, 3, 4],
      [1, 3, 2, 4],
    ])
    expect(Array.from(r.sums)).toEqual([4, 6, 8, 12])
    expect(Array.from(r.consensus)).toEqual([1, 2, 3, 4])
    // W = 12·Σ(R − 7.5)² / (m²(k³ − k)) = 12·35 / (9·60)
    expectClose(r.kendallW, (12 * 35) / (9 * 60), 1e-15)
    expectClose(r.friedmanChi2, 3 * 3 * r.kendallW, 1e-15)
  })

  test('identical judges give W = 1; tied sums share a mid-rank', () => {
    const same = consensusRank([
      [2, 1, 3],
      [2, 1, 3],
    ])
    expectClose(same.kendallW, 1, 1e-15)
    const tied = consensusRank([
      [1, 2, 3],
      [2, 1, 3],
    ])
    expect(Array.from(tied.consensus)).toEqual([1.5, 1.5, 3])
  })

  test('tie-corrected Friedman statistic matches SciPy', () => {
    const { judgeRanks, chi2, p } = fixtures.friedman
    const r = consensusRank(judgeRanks)
    expectClose(r.friedmanChi2, chi2, 1e-12)
    expectClose(r.friedmanP, p, 1e-10)
  })

  test('validates', () => {
    expectJudgingError(() => consensusRank([[1]]), 'invalid_input')
    expectJudgingError(() => consensusRank([[1, 2], [1]]), 'invalid_input')
    expectJudgingError(() => consensusRank([[1, 1]]), 'invalid_input')
    expectJudgingError(() => consensusRank([[1.25, 1.75]]), 'invalid_input')
    expectJudgingError(() => consensusRank([[0, 3]]), 'invalid_input')
  })
})
