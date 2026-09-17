import { describe, expect, test } from 'bun:test'
import { rankMatrixPermutationTest } from '../src/index.js'
import { expectClose, expectJudgingError, fixtures } from './helpers/fixtures.js'

/** Brute-force count over all k! pairings. */
function bruteForce(matrix: number[][], better: 'lower' | 'higher', targets?: number[]): number {
  const k = matrix.length
  const truth = targets ?? matrix.map((_, i) => i)
  const observed = matrix.reduce((sum, row, i) => sum + (row[truth[i] as number] as number), 0)
  const perm = matrix.map((_, i) => i)
  let count = 0
  const visit = (i: number): void => {
    if (i === k) {
      const s = matrix.reduce((sum, row, r) => sum + (row[perm[r] as number] as number), 0)
      if (better === 'lower' ? s <= observed + 1e-9 : s >= observed - 1e-9) count++
      return
    }
    for (let j = i; j < k; j++) {
      ;[perm[i], perm[j]] = [perm[j] as number, perm[i] as number]
      visit(i + 1)
      ;[perm[i], perm[j]] = [perm[j] as number, perm[i] as number]
    }
  }
  visit(0)
  return count
}

/** Deterministic pseudo-random matrix for tests (LCG). */
function matrix(k: number, seed: number, integer: boolean): number[][] {
  let state = seed
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  return Array.from({ length: k }, () =>
    Array.from({ length: k }, () =>
      integer ? 1 + Math.floor(next() * k) : Math.round(next() * 1000) / 100,
    ),
  )
}

describe('rankMatrixPermutationTest', () => {
  test('matches itertools enumeration (SRI-style ranks, ratings, real scores)', () => {
    for (const c of fixtures.rankMatrix) {
      const r = rankMatrixPermutationTest(c.matrix, { better: c.better })
      expect(r.method).toBe('exact')
      expect(r.count).toBe(c.count)
      expect(r.total).toBe(c.total)
      expectClose(r.pValue, c.count / c.total, 1e-15)
    }
  })

  test('subset DP (integers) and branch-and-bound (reals) agree with brute force', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const k of [2, 3, 5, 7]) {
        for (const integer of [true, false]) {
          const m = matrix(k, seed * 31 + k, integer)
          for (const better of ['lower', 'higher'] as const) {
            expect(rankMatrixPermutationTest(m, { better }).count).toBe(bruteForce(m, better))
          }
        }
      }
    }
  })

  test('a perfect 6 × 6 judging matrix has p = 1/720', () => {
    const perfect = Array.from({ length: 6 }, (_, i) =>
      Array.from({ length: 6 }, (_, j) => (i === j ? 1 : 2 + ((i + j) % 5))),
    )
    const r = rankMatrixPermutationTest(perfect)
    expect(r.statistic).toBe(6)
    expect(r.count).toBe(1)
    expectClose(r.pValue, 1 / 720, 1e-15)
  })

  test('targets option relocates the true pairs', () => {
    const m = matrix(6, 99, true)
    const targets = [3, 0, 5, 1, 2, 4]
    const r = rankMatrixPermutationTest(m, { targets })
    expect(r.count).toBe(bruteForce(m, 'lower', targets))
    expect(r.statistic).toBe(targets.reduce((s, t, i) => s + ((m[i] as number[])[t] as number), 0))
  })

  test('expected statistic is the grand total / k', () => {
    const m = matrix(5, 7, true)
    const grand = m.flat().reduce((a, b) => a + b, 0)
    expectClose(rankMatrixPermutationTest(m).expected, grand / 5, 1e-15)
  })

  test('Monte Carlo is seeded, reproducible and close to the exact p', () => {
    const m = matrix(8, 3, true)
    const exact = rankMatrixPermutationTest(m)
    const a = rankMatrixPermutationTest(m, { method: 'monte-carlo', samples: 20_000, seed: 42 })
    const b = rankMatrixPermutationTest(m, { method: 'monte-carlo', samples: 20_000, seed: 42 })
    expect(a.count).toBe(b.count)
    expect(a.seed).toBe(42)
    expect(a.pValue).toBe((1 + a.count) / 20_001)
    // binomial sampling error: 5 SD
    const sd = Math.sqrt((exact.pValue * (1 - exact.pValue)) / 20_000)
    expect(Math.abs(a.pValue - exact.pValue)).toBeLessThan(5 * sd + 1e-4)
    expect(
      rankMatrixPermutationTest(m, { method: 'monte-carlo', samples: 2000, seed: 'ff00' }).total,
    ).toBe(2000)
  })

  test('auto switches to Monte Carlo for large real-valued matrices', () => {
    const m = matrix(12, 5, false)
    const r = rankMatrixPermutationTest(m, { samples: 2000 })
    expect(r.method).toBe('monte-carlo')
    expectJudgingError(() => rankMatrixPermutationTest(m, { method: 'exact' }), 'too_large')
  })

  test('integer rank matrices up to 14 × 14 are exact', () => {
    const m = matrix(13, 11, true)
    const r = rankMatrixPermutationTest(m)
    expect(r.method).toBe('exact')
    expect(r.total).toBe(6227020800)
    expect(r.pValue).toBeGreaterThan(0)
    expect(r.pValue).toBeLessThanOrEqual(1)
  })

  test('validates', () => {
    expectJudgingError(() => rankMatrixPermutationTest([[1]]), 'invalid_input')
    expectJudgingError(() => rankMatrixPermutationTest([[1, 2], [3]]), 'invalid_input')
    expectJudgingError(
      () =>
        rankMatrixPermutationTest([
          [1, 2, 3],
          [3, 2, 1],
        ]),
      'invalid_input',
    )
    expectJudgingError(
      () =>
        rankMatrixPermutationTest([
          [1, Number.NaN],
          [1, 2],
        ]),
      'invalid_input',
    )
    expectJudgingError(
      () =>
        rankMatrixPermutationTest(
          [
            [1, 2],
            [2, 1],
          ],
          { targets: [0, 0] },
        ),
      'invalid_input',
    )
    expectJudgingError(
      () =>
        rankMatrixPermutationTest(
          [
            [1, 2],
            [2, 1],
          ],
          { better: 'up' as unknown as 'lower' },
        ),
      'invalid_options',
    )
    expectJudgingError(
      () =>
        rankMatrixPermutationTest(
          [
            [1, 2],
            [2, 1],
          ],
          { method: 'monte-carlo', samples: 0 },
        ),
      'invalid_options',
    )
    expectJudgingError(
      () =>
        rankMatrixPermutationTest(
          [
            [1, 2],
            [2, 1],
          ],
          { method: 'monte-carlo', seed: -1 },
        ),
      'invalid_options',
    )
  })
})
