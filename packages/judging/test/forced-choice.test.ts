import { describe, expect, test } from 'bun:test'
import {
  directHits,
  ESP_RUN,
  forcedChoiceTest,
  PK_RUN,
  rosenthalRubinPi,
  runsDifference,
  runsScore,
} from '../src/index.js'
import { expectClose, expectJudgingError, fixtures } from './helpers/fixtures.js'

/** Exact P(X ≥ k) with bigint rationals, for p0 = num/den. */
function exactUpperTail(k: number, n: number, num: number, den: number): number {
  let total = 0n
  let choose = 1n
  for (let j = 0; j <= n; j++) {
    if (j > 0) choose = (choose * BigInt(n - j + 1)) / BigInt(j)
    if (j >= k) total += choose * BigInt(num) ** BigInt(j) * BigInt(den - num) ** BigInt(n - j)
  }
  const scale = BigInt(den) ** BigInt(n)
  // 60 significant bits are plenty for a 1e-15 comparison
  return Number((total * 2n ** 60n) / scale) / 2 ** 60
}

describe('forcedChoiceTest', () => {
  test('matches exact rational tails, the two-sided minimum-likelihood p and Clopper–Pearson', () => {
    for (const c of fixtures.binomial) {
      const r = forcedChoiceTest(c.hits, c.trials, c.p0)
      expectClose(r.pOneSided, c.pOneSided, 1e-11, 1e-300)
      expectClose(r.pLower, c.pLower, 1e-11, 1e-300)
      expectClose(r.pTwoSided, c.pTwoSided, 1e-11, 1e-300)
      expectClose(r.confidenceInterval.lower, c.ciLower, 1e-10, 1e-300)
      expectClose(r.confidenceInterval.upper, c.ciUpper, 1e-10)
    }
  })

  test('bigint enumeration of a Zener series tail agrees', () => {
    expectClose(forcedChoiceTest(9, 25, 0.2).pOneSided, exactUpperTail(9, 25, 1, 5), 1e-12)
    expectClose(forcedChoiceTest(33, 100, 0.25).pOneSided, exactUpperTail(33, 100, 1, 4), 1e-12)
  })

  test('Rhine–Pratt statistics: placement test, Tyrrell, autoganzfeld', () => {
    // Rhine & Pratt: 600 placement trials, 268 hits → SD 12.25, CR −2.6
    const placement = forcedChoiceTest(268, 600, 0.5)
    expect(placement.sd).toBeCloseTo(12.247, 3)
    expect(placement.criticalRatio).toBeCloseTo(-2.61, 2)
    // Tyrrell's Table III: 2704 trials, 644 hits at 1/5 → +103, CR 4.96
    const tyrrell = forcedChoiceTest(644, 2704, 0.2)
    expect(tyrrell.deviation).toBeCloseTo(103.2, 10)
    expect(tyrrell.criticalRatio).toBeCloseTo(4.96, 2)
    // Carter: 122 direct hits in 354 autoganzfeld sessions → CR 4.11
    const ganzfeld = directHits(122, 354, 4)
    expect(ganzfeld.mce).toBe(88.5)
    expect(ganzfeld.criticalRatio).toBeCloseTo(4.112, 3)
    expectClose(ganzfeld.effectSize, ganzfeld.criticalRatio / Math.sqrt(354), 1e-15)
    expect(ganzfeld.pOneSided).toBeLessThan(1e-4)
  })

  test('Cohen h and the two-sided normal reading', () => {
    const r = forcedChoiceTest(40, 100, 0.25)
    expectClose(r.cohensH, 2 * Math.asin(Math.sqrt(0.4)) - 2 * Math.asin(0.5), 1e-15)
    expect(r.pCriticalRatio).toBeGreaterThan(0)
    expect(r.pCriticalRatio).toBeLessThan(r.pTwoSided * 2)
  })

  test('exactly at chance the two-sided p is 1', () => {
    expect(forcedChoiceTest(5, 25, 0.2).pTwoSided).toBe(1)
    expect(forcedChoiceTest(50, 100, 0.5).pTwoSided).toBe(1)
  })

  test('confidence option changes the interval width', () => {
    const narrow = forcedChoiceTest(30, 100, 0.25, { confidence: 0.8 }).confidenceInterval
    const wide = forcedChoiceTest(30, 100, 0.25, { confidence: 0.99 }).confidenceInterval
    expect(wide.lower).toBeLessThan(narrow.lower)
    expect(wide.upper).toBeGreaterThan(narrow.upper)
    expect(narrow.confidence).toBe(0.8)
  })

  test('validates counts and options', () => {
    expectJudgingError(() => forcedChoiceTest(-1, 10, 0.5), 'invalid_input')
    expectJudgingError(() => forcedChoiceTest(11, 10, 0.5), 'invalid_input')
    expectJudgingError(() => forcedChoiceTest(1.5, 10, 0.5), 'invalid_input')
    expectJudgingError(() => forcedChoiceTest(1, 0, 0.5), 'invalid_input')
    expectJudgingError(() => forcedChoiceTest(1, 10, 1), 'invalid_options')
    expectJudgingError(() => forcedChoiceTest(1, 10, Number.NaN), 'invalid_options')
    expectJudgingError(() => forcedChoiceTest(1, 10, 0.5, { confidence: 1 }), 'invalid_options')
    expectJudgingError(() => directHits(1, 10, 1), 'invalid_options')
    expectJudgingError(() => directHits(1, 10, 2.5), 'invalid_options')
  })
})

describe('rosenthalRubinPi', () => {
  test('maps chance to ½ and a perfect score to 1 for any k', () => {
    for (const k of [2, 3, 4, 5, 6, 10]) {
      expectClose(rosenthalRubinPi(1 / k, k), 0.5, 1e-15)
      expect(rosenthalRubinPi(1, k)).toBe(1)
      expect(rosenthalRubinPi(0, k)).toBe(0)
    }
    expectClose(rosenthalRubinPi(0.32, 4), 0.96 / 1.64, 1e-15)
    expect(directHits(32, 100, 4).rosenthalRubinPi).toBeCloseTo(0.5854, 4)
  })

  test('validates', () => {
    expectJudgingError(() => rosenthalRubinPi(1.1, 4), 'invalid_input')
    expectJudgingError(() => rosenthalRubinPi(0.5, 1), 'invalid_options')
  })
})

describe('run conventions', () => {
  test('ESP and PK runs have the Rhine–Pratt SDs', () => {
    expect(runsScore(5, 1, ESP_RUN).sdPerRun).toBe(2)
    expectClose(runsScore(4, 1, PK_RUN).sdPerRun, Math.sqrt((24 * 5) / 36), 1e-15)
    expect(runsScore(4, 1, PK_RUN).sdPerRun).toBeCloseTo(1.8257, 4)
    const series = runsScore(560, 100, ESP_RUN)
    expect(series.trials).toBe(2500)
    expect(series.sd).toBeCloseTo(20, 12)
    expect(series.meanPerRun).toBe(5.6)
    expect(series.criticalRatio).toBeCloseTo(3, 12)
  })

  test('difference of equal groups equals the pooled-trials rule (Rhine & Pratt: CR 4.0)', () => {
    // 50 runs each, total difference 80 hits
    const d = runsDifference({ hits: 330, runs: 50 }, { hits: 250, runs: 50 }, ESP_RUN)
    expect(d.sdDifference).toBeCloseTo(0.4, 14)
    expect(d.criticalRatio).toBeCloseTo(4, 12)
  })

  test('difference of run means with SD_run·√(1/R1 + 1/R2)', () => {
    const d = runsDifference({ hits: 330, runs: 48 }, { hits: 244, runs: 48 }, ESP_RUN)
    expect(d.meanA).toBe(6.875)
    expect(d.sdDifference).toBeCloseTo(0.408, 3)
    expect(d.criticalRatio).toBeCloseTo(4.39, 2)
  })

  test('validates', () => {
    expectJudgingError(() => runsScore(26, 1, ESP_RUN), 'invalid_input')
    expectJudgingError(() => runsScore(1, 0, ESP_RUN), 'invalid_input')
    expectJudgingError(
      () => runsScore(1, 1, { name: 'x', trialsPerRun: 0, choices: 2, p0: 0.5 }),
      'invalid_options',
    )
    expectJudgingError(
      () => runsDifference({ hits: 30, runs: 1 }, { hits: 1, runs: 1 }, ESP_RUN),
      'invalid_input',
    )
  })
})
