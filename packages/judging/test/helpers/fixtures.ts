import { expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JudgingError, type JudgingErrorCode } from '../../src/errors.js'

/** Reference values from scripts/fixtures/generate.py (see its header for provenance). */
export interface Fixtures {
  readonly binomial: readonly {
    hits: number
    trials: number
    p0: number
    pOneSided: number
    pLower: number
    pTwoSided: number
    ciLower: number
    ciUpper: number
  }[]
  readonly bayes: readonly {
    hits: number
    trials: number
    p0: number
    a: number
    b: number
    alternative: 'two-sided' | 'greater' | 'less'
    lnBf10: number
  }[]
  readonly closedDeck: readonly {
    symbolCounts: number[]
    callCounts: number[]
    arrangements: string
    counts: string[]
    mean: number
    variance: number
    upperTails: [number, number][]
  }[]
  readonly closedDeckRuns: { runs: number; upperTails: [number, number][] }
  readonly zenerCompositionProbability: number
  readonly expectedMaxOfPmf: { closed: number; binomial: number }
  readonly feedback: readonly {
    deck: number[]
    expected: number
    variance: number
    pmf: number[]
  }[]
  readonly capacity: readonly { hitRate: number; choices: number; bits: number }[]
  readonly ranks: {
    pmf8x4: number[]
    tails: { trials: number; choices: number; sum: number; lower: number; upper: number }[]
  }
  readonly friedman: { judgeRanks: number[][]; chi2: number; p: number }
  readonly rankMatrix: readonly {
    matrix: number[][]
    better: 'lower' | 'higher'
    count: number
    total: number
  }[]
  readonly expectedMax: readonly { looks: number; exact: number; approximation: number }[]
  readonly deflated: readonly {
    looks: number
    alpha: number
    sided: 'one' | 'two'
    perLookAlpha: number
    z: number
    bonferroniZ: number
  }[]
  readonly optionalStopping: readonly {
    looks: number[]
    p0: number
    alpha: number
    criticalHits: (number | null)[]
    risk: number
  }[]
  readonly displacement: readonly {
    calls: number[]
    choices: number
    offsets: number[]
    runLength: number
    mean: number
    variance: number
    upperTails: [number, number][]
  }[]
}

export const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'judging.json'), 'utf8'),
) as Fixtures

/** |actual − expected| ≤ rel·|expected| (+ abs for values near 0). */
export function expectClose(actual: number, expected: number, rel = 1e-12, abs = 0): void {
  const tolerance = rel * Math.abs(expected) + abs
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`expected ${actual} to be within ${tolerance} of ${expected}`)
  }
  expect(true).toBe(true)
}

/** Run `fn` and assert it throws a JudgingError with `code`. */
export function expectJudgingError(fn: () => unknown, code: JudgingErrorCode): JudgingError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(JudgingError)
    expect((error as JudgingError).code).toBe(code)
    return error as JudgingError
  }
  throw new Error(`expected a JudgingError(${code})`)
}
