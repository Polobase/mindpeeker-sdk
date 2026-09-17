import { describe, expect, test } from 'bun:test'
import {
  presentCorrelation,
  presentCounts,
  presentCovar,
  presentCumulative,
  presentDevvar,
  presentNetvar,
  stepStouffer,
} from '../../src/experiment/present.js'
import { covar } from '../../src/stats/covar.js'
import { cumulativeDeviation } from '../../src/stats/cumdev.js'
import { devvar, interSourceCorrelation, netvar } from '../../src/stats/network.js'
import { chiSquareP, normalP } from '../../src/stats/pvalues.js'
import { stoufferZ } from '../../src/stats/zscores.js'
import { gaussians } from '../helpers/byte-sources.js'

const SOURCES = ['a', 'b', 'c', 'd']

function matrix(steps: number, seed: number): Float64Array[] {
  return SOURCES.map((_, i) => gaussians(steps, seed + i * 7919))
}

describe('presence-aware statistics', () => {
  test('with every source present they are bit-identical to the strict stats functions', () => {
    const zs = matrix(500, 0x51)
    const slices = zs.map((z) => z.slice(100, 400))
    const strictNet = netvar(slices, SOURCES)
    const strictDev = devvar(slices, SOURCES)
    const strictCorr = interSourceCorrelation(slices, SOURCES)
    const net = presentNetvar(zs, 100, 400)
    const dev = presentDevvar(zs, 100, 400)
    const corr = presentCorrelation(zs, 100, 400)
    expect(net).toEqual({
      statistic: strictNet.statistic,
      df: 300,
      pValue: strictNet.pValue,
      n: 300,
    })
    expect(dev?.statistic).toBe(strictDev.statistic)
    expect(dev?.df).toBe(strictDev.df)
    expect(dev?.pValue).toBe(strictDev.pValue)
    expect(corr?.statistic).toBe(strictCorr.statistic)
    expect(corr?.df).toBe(strictCorr.df)
    expect(corr?.pValue).toBe(strictCorr.pValue)
    for (const bitsPerTrial of [8, 200]) {
      const strictCovar = covar(slices, SOURCES, { bitsPerTrial })
      expect(presentCovar(zs, 100, 400, bitsPerTrial)).toEqual({
        statistic: strictCovar.statistic,
        df: strictCovar.df,
        pValue: strictCovar.pValue,
        n: 300,
      })
    }
    const stouffers = Float64Array.from({ length: 300 }, (_, t) =>
      stoufferZ(slices.map((s) => s[t] as number)),
    )
    expect([...presentCumulative(zs, 100, 400)]).toEqual([...cumulativeDeviation(stouffers)])
  })

  test('absent sources (NaN) drop out per step: hand-computed 3-step example', () => {
    // step 0: all three present; step 1: only a, c; step 2: only b
    const zs = [
      Float64Array.from([1, 2, Number.NaN]),
      Float64Array.from([-1, Number.NaN, 3]),
      Float64Array.from([2, 0.5, Number.NaN]),
    ]
    const z0 = (1 - 1 + 2) / Math.sqrt(3)
    const z1 = (2 + 0.5) / Math.sqrt(2)
    const z2 = 3
    expect(presentCounts(zs, 3)).toEqual(Uint32Array.from([3, 2, 1]))
    expect(stepStouffer(zs, 1)).toBe(z1)
    const net = presentNetvar(zs, 0, 3)
    expect(net?.statistic).toBeCloseTo(z0 ** 2 + z1 ** 2 + z2 ** 2, 14)
    expect(net?.df).toBe(3)
    expect(net?.pValue).toBe(chiSquareP(net?.statistic as number, 3))
    const dev = presentDevvar(zs, 0, 3)
    expect(dev?.statistic).toBeCloseTo(1 + 1 + 4 + 4 + 0.25 + 9, 14)
    expect(dev?.df).toBe(6)
    // pairs: step 0 → 3 (products −1 + 2 − 2 = −1), step 1 → 1 (2·0.5 = 1), step 2 → 0
    const corr = presentCorrelation(zs, 0, 3)
    expect(corr?.df).toBe(4)
    expect(corr?.statistic).toBeCloseTo((-1 + 1) / 2, 14)
    expect(corr?.pValue).toBe(normalP(corr?.statistic as number, 'upper'))
    expect([...presentCumulative(zs, 0, 3)].map((v) => Number(v.toFixed(12)))).toEqual(
      [z0 ** 2 - 1, z0 ** 2 - 1 + z1 ** 2 - 1, z0 ** 2 + z1 ** 2 + z2 ** 2 - 3].map((v) =>
        Number(v.toFixed(12)),
      ),
    )
  })

  test('covar drops absent sources per step: hand-computed 3-step example', () => {
    // u = z² − 1. step 0: a, b, c present → u = (0, 3, 0) → pairs 0·3 + 0·0 + 3·0 = 0;
    // step 1: a, c → u = (3, 8) → 24; step 2: only b → no pair
    const nan = Number.NaN
    const zs = [
      Float64Array.from([1, 2, nan]),
      Float64Array.from([2, nan, 3]),
      Float64Array.from([1, 3, nan]),
    ]
    const k = 8
    const v = 2 - 2 / k
    const result = presentCovar(zs, 0, 3, k)
    expect(result?.df).toBe(4) // 3 pairs + 1 pair
    expect(result?.n).toBe(3)
    expect(result?.statistic).toBeCloseTo(24 / Math.sqrt(4 * v * v), 14)
    expect(result?.pValue).toBe(normalP(result?.statistic as number, 'upper'))
    expect(presentCovar(zs, 2, 3, k)).toBeNull() // a single present source has no pair
  })

  test('steps with nobody present add nothing; no data → null', () => {
    const nan = Number.NaN
    const zs = [Float64Array.from([nan, 1, nan]), Float64Array.from([nan, nan, nan])]
    expect(presentNetvar(zs, 0, 3)?.df).toBe(1)
    expect(presentNetvar(zs, 0, 1)).toBeNull()
    expect(presentDevvar(zs, 2, 3)).toBeNull()
    expect(presentCorrelation(zs, 0, 3)).toBeNull() // never two present together
    expect([...presentCumulative(zs, 0, 3)]).toEqual([0, 0, 0])
  })
})
