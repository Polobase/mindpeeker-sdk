import { describe, expect, test } from 'bun:test'
import { binomialCdf, binomialSf } from '@mindpeeker/negentropy/numerics'
import { describeLabelShuffle, labelShuffleSurrogates } from '../../src/resample/label-shuffle.js'
import { permutationP } from '../../src/resample/surrogates.js'
import { prngUniforms } from '../helpers/trial-sources.js'

type Label = 'target' | 'control'

/** iid N(0,1) per-epoch values via Box–Muller over the seeded xorshift uniforms. */
function gaussians(n: number, seed: number): Float64Array {
  const u = prngUniforms(2 * n, seed)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    out[i] =
      Math.sqrt(-2 * Math.log(u[2 * i] as number)) *
      Math.cos(2 * Math.PI * (u[2 * i + 1] as number))
  }
  return out
}

/** Presentiment-style statistic: (Z_target − Z_control)/√2 over per-epoch N(0,1) values. */
function deltaZ(values: Float64Array, labels: readonly Label[]): number {
  let t = 0
  let c = 0
  let nt = 0
  let nc = 0
  for (let i = 0; i < values.length; i++) {
    if (labels[i] === 'target') {
      t += values[i] as number
      nt++
    } else {
      c += values[i] as number
      nc++
    }
  }
  return (t / Math.sqrt(nt) - c / Math.sqrt(nc)) / Math.SQRT2
}

const alternating = (n: number): Label[] =>
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'target' : 'control'))

describe('labelShuffleSurrogates — permutation (default)', () => {
  test('exact enumeration when few distinct labelings exist (lexicographic, observed excluded)', () => {
    const labels: Label[] = ['target', 'control', 'target', 'control']
    const all = [...labelShuffleSurrogates(labels)].map((l) => l.map((x) => x[0]).join(''))
    // C(4,2) = 6 labelings, minus the observed tctc
    expect(all).toEqual(['ttcc', 'tcct', 'cttc', 'ctct', 'cctt'])
    expect(describeLabelShuffle(labels)).toEqual({
      method: 'exact',
      surrogates: 5,
      distinctLabelings: 6,
      resolution: 1 / 6,
    })
  })

  test('exact enumeration reproduces the brute-force exact p for every observation', () => {
    // 3 targets / 3 controls → C(6,3) = 20 labelings; brute force over all 2^6 masks
    const labels: Label[] = ['target', 'target', 'control', 'target', 'control', 'control']
    const values = Float64Array.from([0.3, -1.2, 0.8, 2.1, -0.4, 0.05])
    const observed = deltaZ(values, labels)
    const everyLabeling: number[] = []
    for (let mask = 0; mask < 64; mask++) {
      const relabel = Array.from(
        { length: 6 },
        (_, i): Label => (mask & (1 << i) ? 'target' : 'control'),
      )
      if (relabel.filter((l) => l === 'target').length === 3) {
        everyLabeling.push(deltaZ(values, relabel))
      }
    }
    expect(everyLabeling.length).toBe(20)
    const exactP = everyLabeling.filter((s) => s >= observed).length / 20
    const surrogates = [...labelShuffleSurrogates(labels)].map((l) => deltaZ(values, l))
    expect(surrogates.length).toBe(19)
    expect(permutationP(observed, surrogates)).toBeCloseTo(exactP, 15)
  })

  test('random draws: seeded, reproducible, count-preserving, identity allowed', () => {
    const labels = alternating(60)
    const a = [...labelShuffleSurrogates(labels, { surrogates: 50, seed: 7 })]
    const b = [...labelShuffleSurrogates(labels, { surrogates: 50, seed: 7 })]
    const c = [...labelShuffleSurrogates(labels, { surrogates: 50, seed: 8 })]
    expect(a.length).toBe(50)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    for (const relabel of a) expect(relabel.filter((l) => l === 'target').length).toBe(30)
    expect(new Set(a.map((l) => l.join())).size).toBeGreaterThan(45)
    const description = describeLabelShuffle(labels, { surrogates: 50 })
    expect(description.method).toBe('random')
    expect(description.surrogates).toBe(50)
    expect(description.resolution).toBeCloseTo(1 / 51, 15)
    // C(60,30) = 118264581564861424 > 2^53 → floating value
    expect(description.distinctLabelings / 1.1826458156486142e17).toBeCloseTo(1, 10)
    expect(describeLabelShuffle(labels).surrogates).toBe(100)
    expect([...labelShuffleSurrogates(labels, { count: 3 })].length).toBe(3) // deprecated alias
  })

  test('H0 calibration, alternating design: P(p ≤ 0.05) lies in the Binomial(·, 0.05) band', () => {
    const datasets = 500
    const labels = alternating(60)
    let hits = 0
    let legacyHits = 0
    for (let d = 0; d < datasets; d++) {
      const values = gaussians(60, 0x5eed + d * 7919)
      const observed = deltaZ(values, labels)
      const surrogates = [...labelShuffleSurrogates(labels, { surrogates: 99, seed: d })].map((l) =>
        deltaZ(values, l),
      )
      if (permutationP(observed, surrogates) <= 0.05) hits++
      // the 0.1.x algorithm: rotations with identity copies skipped → m complements
      const legacy: number[] = []
      for (let tau = 1; tau < 60; tau++) {
        const rotated = labels.map((_, i) => labels[(i + tau) % 60] as Label)
        if (rotated.some((l, i) => l !== labels[i])) legacy.push(deltaZ(values, rotated))
      }
      if (permutationP(observed, legacy) <= 0.05) legacyHits++
    }
    // exact 99.9% two-sided acceptance band for Binomial(500, 0.05)
    expect(binomialCdf(hits, datasets, 0.05)).toBeGreaterThan(0.0005)
    expect(binomialSf(hits - 1, datasets, 0.05)).toBeGreaterThan(0.0005)
    expect(legacyHits / datasets).toBeGreaterThan(0.4) // the verified defect: ~50% false positives
  })
})

describe('labelShuffleSurrogates — rotation (opt-in)', () => {
  test('yields all n − 1 rotations with identity copies, so p is exact but coarse', () => {
    const labels = alternating(60)
    const rotations = [...labelShuffleSurrogates(labels, { method: 'rotation' })]
    expect(rotations.length).toBe(59)
    const identical = rotations.filter((r) => r.every((l, i) => l === labels[i])).length
    expect(identical).toBe(29)
    const values = gaussians(60, 42)
    const observed = deltaZ(values, labels)
    const p = permutationP(
      observed,
      rotations.map((r) => deltaZ(values, r)),
    )
    expect(p).toBeCloseTo(observed > 0 ? 0.5 : 1, 15)
    expect(describeLabelShuffle(labels, { method: 'rotation' }).method).toBe('rotation')
    const explicit = [
      ...labelShuffleSurrogates(['a', 'b', 'c'], { method: 'rotation', offsets: [-1] }),
    ]
    expect(explicit).toEqual([['c', 'a', 'b']])
  })
})

describe('labelShuffleSurrogates — errors', () => {
  test('bad inputs throw PsiError', () => {
    const code = (c: string) =>
      expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error
    expect(() => [...labelShuffleSurrogates(['target'])]).toThrow(code('insufficient_data'))
    expect(() => [...labelShuffleSurrogates(['a', 'a', 'a'])]).toThrow(code('insufficient_data'))
    expect(() => [...labelShuffleSurrogates(['a', 'b'], { surrogates: 0 })]).toThrow(
      code('invalid_plan'),
    )
    expect(() => [...labelShuffleSurrogates(['a', 'b'], { seed: -1 })]).toThrow(
      code('invalid_plan'),
    )
    expect(() => [...labelShuffleSurrogates(['a', 'b'], { offsets: [1] })]).toThrow(
      code('invalid_plan'),
    )
    expect(() => [...labelShuffleSurrogates(['a', 'b'], { surrogates: 2, count: 3 })]).toThrow(
      code('invalid_plan'),
    )
    expect(() => [
      ...labelShuffleSurrogates(['a', 'b'], { method: 'rotation', surrogates: 5 }),
    ]).toThrow(code('invalid_plan'))
    expect(() => [
      ...labelShuffleSurrogates(['a', 'b', 'c'], { method: 'rotation', offsets: [3] }),
    ]).toThrow(code('invalid_plan'))
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: deliberately unknown method
      [...labelShuffleSurrogates(['a', 'b'], { method: 'shuffle' as any })],
    ).toThrow(code('invalid_plan'))
  })
})
