import { describe, expect, test } from 'bun:test'
import { displacementMatrix, displacementScore } from '../src/index.js'
import { expectClose, expectJudgingError, fixtures } from './helpers/fixtures.js'

/** Pooled hits over all m^n target sequences (brute force). */
function enumerateNull(calls: number[], m: number, offsets: number[], runLength: number) {
  const n = calls.length
  const targets = new Array<number>(n).fill(0)
  const counts = new Map<number, number>()
  let total = 0
  const visit = (i: number): void => {
    if (i === n) {
      let hits = 0
      for (const d of offsets) {
        for (let c = 0; c < n; c++) {
          const t = c + d
          if (
            t >= 0 &&
            t < n &&
            Math.floor(c / runLength) === Math.floor(t / runLength) &&
            calls[c] === targets[t]
          ) {
            hits++
          }
        }
      }
      counts.set(hits, (counts.get(hits) ?? 0) + 1)
      total++
      return
    }
    for (let s = 0; s < m; s++) {
      targets[i] = s
      visit(i + 1)
    }
  }
  visit(0)
  let mean = 0
  let second = 0
  for (const [h, c] of counts) {
    mean += (h * c) / total
    second += (h * h * c) / total
  }
  return { counts, total, mean, variance: second - mean * mean }
}

describe('displacementScore', () => {
  test("per-pattern variances for m = 5 are Soal's 36/25, 16/25, 6/25", () => {
    // calls AAA at the centre target, AAB, ABC, and run ends AA / AB
    const at = (calls: number[]) =>
      displacementScore([0, 0, 0], calls, { choices: 5 }).patterns.map((p) => [
        p.signature,
        p.variance,
      ])
    expect(at([1, 1, 1])).toEqual([
      ['3', expect.closeTo(36 / 25, 14)],
      ['2', expect.closeTo(16 / 25, 14)],
    ])
    expect(at([1, 1, 2])).toEqual([
      ['2+1', expect.closeTo(16 / 25, 14)],
      ['2', expect.closeTo(16 / 25, 14)],
      ['1+1', expect.closeTo(6 / 25, 14)],
    ])
    expect(at([1, 2, 3])).toEqual([
      ['1+1+1', expect.closeTo(6 / 25, 14)],
      ['1+1', expect.closeTo(6 / 25, 14)],
    ])
    // Soal's Table I weights reproduce 872.00 against the binomial 934.4
    const tableI =
      41 * (36 / 25) + 818 * (16 / 25) + 981 * (6 / 25) + 39 * (16 / 25) + 121 * (6 / 25)
    expectClose(tableI, 872, 1e-12)
    expectClose((73 * 80 * 4) / 25, 934.4, 1e-12)
  })

  test('mean, variance and exact tail match enumeration of every target sequence', () => {
    for (const c of fixtures.displacement) {
      const n = c.calls.length
      const candidates = [
        new Array<number>(n).fill(0),
        c.calls.slice(),
        c.calls.map((x, i) => (c.calls[(i + 1) % n] as number) ?? x),
        c.calls.map((_, i) => i % c.choices),
      ]
      const tails = new Map(c.upperTails)
      for (const targets of candidates) {
        const r = displacementScore(targets, c.calls, {
          choices: c.choices,
          offsets: c.offsets,
          runLength: c.runLength,
        })
        expectClose(r.expected, c.mean, 1e-14)
        expectClose(r.variance, c.variance, 1e-13)
        expect(r.pMethod).toBe('exact')
        expectClose(r.pOneSided, tails.get(r.hits) ?? Number.NaN, 1e-13)
      }
    }
  })

  test('the exact pooled p equals the enumerated tail for observed data', () => {
    const calls = [0, 1, 1, 2, 0, 0, 2]
    const targets = [1, 1, 2, 2, 0, 1, 2]
    const r = displacementScore(targets, calls, { choices: 3 })
    const brute = enumerateNull(calls, 3, [-1, 0, 1], 7)
    let tail = 0
    for (const [hits, count] of brute.counts) if (hits >= r.hits) tail += count / brute.total
    expectClose(r.pOneSided, tail, 1e-13)
    expectClose(r.variance, brute.variance, 1e-13)
    expect(r.comparisons).toBe(7 + 6 + 6)
    expect(r.perOffset.map((o) => o.offset)).toEqual([-1, 0, 1])
    expect(r.perOffset.reduce((s, o) => s + o.hits, 0)).toBe(r.hits)
  })

  test('runs of 25 give 73 comparisons per sheet and never cross sheets', () => {
    const calls = Array.from({ length: 100 }, (_, i) => (i * 7) % 5)
    const targets = Array.from({ length: 100 }, (_, i) => (i * 3) % 5)
    const r = displacementScore(targets, calls, { choices: 5, runLength: 25 })
    expect(r.comparisons).toBe(4 * 73)
    expectClose(r.binomialVariance, (73 * 4 * 4) / 25, 1e-12)
  })

  test('single offsets are exact binomials', () => {
    const r = displacementScore([0, 1, 2, 3, 4, 0], [0, 1, 0, 3, 1, 0], {
      choices: 5,
      offsets: [0],
    })
    const o = r.perOffset[0]
    expect(o?.hits).toBe(4)
    expectClose(r.variance, 6 * 0.2 * 0.8, 1e-14)
    expectClose(r.pOneSided, o?.pOneSided ?? Number.NaN, 1e-13)
  })

  test('validates', () => {
    expectJudgingError(() => displacementScore([0, 1], [0], { choices: 2 }), 'invalid_input')
    expectJudgingError(() => displacementScore([0, 5], [0, 1], { choices: 5 }), 'invalid_input')
    expectJudgingError(() => displacementScore([0, 1], [0, 1], { choices: 1 }), 'invalid_options')
    expectJudgingError(
      () => displacementScore([0, 1], [0, 1], { choices: 2, offsets: [0, 0] }),
      'invalid_options',
    )
    expectJudgingError(
      () => displacementScore([0, 1], [0, 1], { choices: 2, offsets: [] }),
      'invalid_options',
    )
    expectJudgingError(
      () => displacementScore([0, 1], [0, 1], { choices: 2, offsets: [2] }),
      'invalid_options',
    )
    expectJudgingError(
      () => displacementScore([0, 1], [0, 1], { choices: 2, runLength: 0 }),
      'invalid_options',
    )
  })
})

describe('displacementMatrix', () => {
  test("Carington's diagonal expectation Σ R_o C_c / T", () => {
    const hits = [
      [3, 1, 0],
      [0, 2, 1],
      [1, 0, 4],
    ]
    const diagonals = displacementMatrix(hits)
    expect(diagonals.map((d) => d.offset)).toEqual([-2, -1, 0, 1, 2])
    const main = diagonals[2]
    expect(main?.observed).toBe(9)
    // R = [4, 3, 5], C = [4, 3, 5], T = 12
    expectClose(main?.expected ?? 0, (16 + 9 + 25) / 12, 1e-15)
    expectClose(main?.z ?? 0, (9 - 50 / 12) / Math.sqrt(50 / 12), 1e-15)
    const total = diagonals.reduce((s, d) => s + d.expected, 0)
    expectClose(total, 12, 1e-14)
  })

  test('zero-expectation diagonals report z = null', () => {
    const d = displacementMatrix([
      [1, 0],
      [0, 0],
    ])
    expect(d.find((x) => x.offset === 1)?.z).toBeNull()
  })

  test('validates', () => {
    expectJudgingError(() => displacementMatrix([[0, 0]]), 'invalid_input')
    expectJudgingError(() => displacementMatrix([[1, -1]]), 'invalid_input')
    expectJudgingError(() => displacementMatrix([[1, 2], [1]]), 'invalid_input')
  })
})
