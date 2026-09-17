import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import { pairMatchTest } from '../src/pair-test.js'
import { value } from '../src/value.js'

/** Five equal-value pairs with pairwise distinct values (13, 358, 31, 45, 50). */
const PAIRS: readonly (readonly [string, string])[] = [
  ['אחד', 'אהבה'],
  ['נחש', 'משיח'],
  ['אל', 'לא'],
  ['אדם', 'מה'],
  ['ים', 'כל'],
]

/** Independent reference: enumerate all n! re-pairings and count S ≥ observed. */
function enumerate(pairs: readonly (readonly [string, string])[], t: number) {
  const a = pairs.map(([x]) => value(x, 'he-hechrachi'))
  const b = pairs.map(([, y]) => value(y, 'he-hechrachi'))
  const n = pairs.length
  const observed = a.filter((v, i) => Math.abs(v - (b[i] as number)) <= t).length
  let total = 0
  let atLeast = 0
  const used = new Array<boolean>(n).fill(false)
  const walk = (i: number, s: number): void => {
    if (i === n) {
      total++
      if (s >= observed) atLeast++
      return
    }
    for (let j = 0; j < n; j++) {
      if (used[j]) continue
      used[j] = true
      walk(i + 1, s + (Math.abs((a[i] as number) - (b[j] as number)) <= t ? 1 : 0))
      used[j] = false
    }
  }
  walk(0, 0)
  return { observed, total, atLeast }
}

describe('pairMatchTest', () => {
  test('all pairs agree, all values distinct: only the identity reaches 5, p = 1/5!', () => {
    const r = pairMatchTest(PAIRS, 'he-hechrachi')
    expect(r.method).toBe('exact')
    expect(r.n).toBe(5)
    expect(r.observed).toBe(5)
    expect(r.expected).toBe(1)
    expect(r.pairings).toBe(120)
    expect(r.atLeastObserved).toBe(1)
    expect(r.pValue).toBe(1 / 120)
  })

  test('exact DP agrees with brute-force enumeration, with and without tolerance', () => {
    const pairs: (readonly [string, string])[] = [
      ['אחד', 'דוד'], // 13 vs 14
      ['אל', 'לא'], // 31
      ['חי', 'יח'], // 18
      ['טוב', 'חי'], // 17 vs 18
      ['לב', 'בל'], // 32
      ['אמן', 'מלאך'], // 91
    ]
    for (const t of [0, 1, 2]) {
      const ref = enumerate(pairs, t)
      const r = pairMatchTest(pairs, 'he-hechrachi', { tolerance: t })
      expect(r.observed).toBe(ref.observed)
      expect(r.pairings).toBe(ref.total)
      expect(r.atLeastObserved).toBe(ref.atLeast)
      expect(r.pValue).toBe(ref.atLeast / ref.total)
    }
  })

  test('Monte Carlo is replayable from its seed and close to the exact p', () => {
    // א…ח (1…8) paired with ח…א (8…1): under colel only ד↔ה and ה↔ד agree as given,
    // while random re-pairings agree about as often — exact p = 0.805.
    const pairs = [...'אבגדהוזח'].map((a, i) => [a, 'חזוהדגבא'[i] as string] as const)
    const exact = pairMatchTest(pairs, 'he-hechrachi', { method: 'exact', colel: true })
    const mc = pairMatchTest(pairs, 'he-hechrachi', {
      method: 'permutation',
      colel: true,
      permutations: 20000,
      seed: 42,
    })
    const replay = pairMatchTest(pairs, 'he-hechrachi', {
      method: 'permutation',
      colel: true,
      permutations: 20000,
      seed: 42,
    })
    expect(mc.method).toBe('permutation')
    expect(mc.atLeastObserved).toBe(replay.atLeastObserved)
    expect(mc.pValue).toBe((1 + mc.atLeastObserved) / 20001)
    expect(Math.abs(mc.pValue - exact.pValue)).toBeLessThan(0.02)
    const other = pairMatchTest(pairs, 'he-hechrachi', {
      method: 'permutation',
      colel: true,
      permutations: 20000,
      seed: 43,
    })
    expect(other.atLeastObserved).not.toBe(mc.atLeastObserved)
  })

  test("'auto' switches to Monte Carlo above 12 pairs", () => {
    const pairs = Array.from({ length: 13 }, (_, i) => {
      const w = 'אבגדהוזחטיכלמ'[i] as string
      return [w, w] as const
    })
    const r = pairMatchTest(pairs, 'he-hechrachi', { permutations: 500 })
    expect(r.method).toBe('permutation')
    expect(r.observed).toBe(13)
    expect(r.pValue).toBe(1 / 501)
  })

  test('validates pairs, words and options', () => {
    expect(() => pairMatchTest([['אב', 'בא']], 'he-hechrachi')).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => pairMatchTest([['א'], ['ב', 'ג']] as any, 'he-hechrachi')).toThrow(GematriaError)
    expect(() =>
      pairMatchTest(
        [
          ['א', 'Αμην'],
          ['ב', 'ג'],
        ],
        'he-hechrachi',
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    const many = Array.from({ length: 17 }, () => ['א', 'א'] as const)
    expect(() => pairMatchTest(many, 'he-hechrachi', { method: 'exact' })).toThrow(GematriaError)
    for (const opts of [{ permutations: 0 }, { seed: -1 }, { seed: 1.5 }, { method: 'bogus' }]) {
      // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
      expect(() => pairMatchTest(PAIRS, 'he-hechrachi', opts as any)).toThrow(GematriaError)
    }
  })
})
