import { describe, expect, test } from 'bun:test'
import {
  closedDeckMatchDistribution,
  closedDeckTest,
  compositionProbability,
  expectedMaxOfPmf,
} from '../src/index.js'
import { expectClose, expectJudgingError, fixtures } from './helpers/fixtures.js'

/** Match counts over every distinct order of the target multiset (brute force). */
function bruteForce(symbolCounts: number[], callCounts: number[]): bigint[] {
  const calls: number[] = []
  callCounts.forEach((c, s) => {
    for (let i = 0; i < c; i++) calls.push(s)
  })
  const n = calls.length
  const out = new Array<bigint>(n + 1).fill(0n)
  const remaining = symbolCounts.slice()
  const visit = (position: number, matches: number): void => {
    if (position === n) {
      out[matches] = (out[matches] as bigint) + 1n
      return
    }
    remaining.forEach((left, s) => {
      if (left === 0) return
      remaining[s] = left - 1
      visit(position + 1, matches + (calls[position] === s ? 1 : 0))
      remaining[s] = left
    })
  }
  visit(0, 0)
  return out
}

describe('closedDeckMatchDistribution', () => {
  test('reproduces Epstein Table 11-1 for the Zener pack', () => {
    const d = closedDeckMatchDistribution([5, 5, 5, 5, 5])
    expect(d.arrangements).toBe(623360743125120n)
    expect(d.counts[24]).toBe(0n)
    expect(d.counts[25]).toBe(1n)
    const printed: [number, number][] = [
      [0, 4.286e-3],
      [1, 2.545e-2],
      [5, 1.919e-1],
      [10, 1.291e-2],
      [20, 7.981e-10],
      [22, 4.011e-12],
      [23, 4.011e-13],
      [25, 1.604e-15],
    ]
    for (const [k, p] of printed) expectClose(d.pmf[k] as number, p, 6e-4)
    expect(d.mean).toBe(5)
    expectClose(d.variance, 25 / 6, 1e-15)
    expect(d.sd).toBeCloseTo(2.0412, 4)
    expect(d.openDeckVariance).toBeCloseTo(4, 14)
  })

  test('matches an independent contingency-table DP (exact integers)', () => {
    for (const c of fixtures.closedDeck) {
      const d = closedDeckMatchDistribution(c.symbolCounts, c.callCounts)
      expect(d.arrangements.toString()).toBe(c.arrangements)
      expect(d.counts.map(String)).toEqual(c.counts)
      expectClose(d.mean, c.mean, 1e-15)
      expectClose(d.variance, c.variance, 1e-14)
      for (const [hits, p] of c.upperTails) {
        expectClose(
          closedDeckTest(hits, c.symbolCounts, { callCounts: c.callCounts }).pOneSided,
          p,
          1e-15,
        )
      }
    }
  })

  test('matches brute-force enumeration of small multisets', () => {
    const cases: [number[], number[]][] = [
      [
        [2, 2, 2],
        [2, 2, 2],
      ],
      [
        [3, 1, 2],
        [1, 3, 2],
      ],
      [
        [4, 0, 2],
        [2, 2, 2],
      ],
      [
        [1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1],
      ],
    ]
    for (const [t, c] of cases) {
      expect(closedDeckMatchDistribution(t, c).counts).toEqual(bruteForce(t, c))
    }
  })

  test('closed form of the moments (Greville): mean Σc·t/N, variance from pair probabilities', () => {
    const t = [4, 3, 2, 1]
    const c = [1, 2, 3, 4]
    const n = 10
    let s = 0
    let sct2 = 0
    let scct = 0
    t.forEach((ts, i) => {
      const cs = c[i] as number
      s += cs * ts
      sct2 += cs * ts * ts
      scct += cs * (cs - 1) * ts
    })
    const mean = s / n
    const second = mean + (s * s - sct2 - scct) / (n * (n - 1))
    const d = closedDeckMatchDistribution(t, c)
    expectClose(d.mean, mean, 1e-15)
    expectClose(d.variance, second - mean * mean, 1e-14)
  })

  test('a permutation deck has the rencontres distribution → e⁻¹', () => {
    const d = closedDeckMatchDistribution(new Array<number>(40).fill(1))
    expectClose(d.pmf[0] as number, Math.exp(-1), 1e-15)
    expectClose(d.pmf[1] as number, Math.exp(-1), 1e-15)
    expect(d.mean).toBeCloseTo(1, 14)
    expect(d.variance).toBeCloseTo(1, 14)
  })

  test('validates', () => {
    expectJudgingError(() => closedDeckMatchDistribution([]), 'invalid_input')
    expectJudgingError(() => closedDeckMatchDistribution([0, 0]), 'invalid_input')
    expectJudgingError(() => closedDeckMatchDistribution([2, -1]), 'invalid_input')
    expectJudgingError(() => closedDeckMatchDistribution([2, 2], [3, 2]), 'invalid_input')
    expectJudgingError(() => closedDeckMatchDistribution([2, 2], [4]), 'invalid_input')
    expectJudgingError(() => closedDeckMatchDistribution([600]), 'too_large')
  })
})

describe('closedDeckTest', () => {
  test('the open-deck critical ratio is inflated by 2 % for a Zener pack', () => {
    const r = closedDeckTest(10, [5, 5, 5, 5, 5])
    expectClose(r.openDeckCriticalRatio / r.criticalRatio, Math.sqrt(25 / 6) / 2, 1e-14)
    expectClose(r.pOneSided + r.pLower - (r.distribution.pmf[10] as number), 1, 1e-14)
  })

  test('several runs: exact tails of the summed distribution', () => {
    const { runs, upperTails } = fixtures.closedDeckRuns
    for (const [hits, p] of upperTails) {
      const r = closedDeckTest(hits, [5, 5, 5, 5, 5], { runs })
      expectClose(r.pOneSided, p, 1e-12)
      expect(r.mean).toBe(15)
      expectClose(r.sd, Math.sqrt(3 * (25 / 6)), 1e-14)
    }
  })

  test('validates', () => {
    expectJudgingError(() => closedDeckTest(26, [5, 5, 5, 5, 5]), 'invalid_input')
    expectJudgingError(() => closedDeckTest(2, [5, 5, 5, 5, 5], { runs: 0 }), 'invalid_options')
    expectJudgingError(() => closedDeckTest(2, [5, 5, 5, 5, 5], { runs: 1000 }), 'too_large')
  })
})

describe('compositionProbability and the best of several looks', () => {
  test("Epstein's balanced-pack probability 0.00209", () => {
    expectClose(
      compositionProbability([5, 5, 5, 5, 5]),
      fixtures.zenerCompositionProbability,
      1e-15,
    )
    expect(compositionProbability([5, 5, 5, 5, 5])).toBeCloseTo(0.0020917, 7)
    expectClose(compositionProbability([1, 1]), 0.5, 1e-15)
  })

  test('best of three Zener looks: 6.740 exact vs 6.703 binomial (Epstein)', () => {
    const closed = closedDeckMatchDistribution([5, 5, 5, 5, 5]).pmf
    expectClose(expectedMaxOfPmf(closed, 3), fixtures.expectedMaxOfPmf.closed, 1e-13)
    expect(expectedMaxOfPmf(closed, 3)).toBeCloseTo(6.740239, 6)
    const binomial = new Float64Array(26)
    let choose = 1
    for (let j = 0; j <= 25; j++) {
      if (j > 0) choose = (choose * (26 - j)) / j
      binomial[j] = choose * 0.2 ** j * 0.8 ** (25 - j)
    }
    expectClose(expectedMaxOfPmf(binomial, 3), fixtures.expectedMaxOfPmf.binomial, 1e-12)
    expect(expectedMaxOfPmf(closed, 1)).toBeCloseTo(5, 13)
  })
})
