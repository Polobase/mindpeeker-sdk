import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shannonEntropy } from '../src/entropy.js'
import { FlowError } from '../src/errors.js'
import {
  activeInformationStorage,
  blockEntropy,
  entropyRate,
  localActiveInformationStorage,
  predictiveInformation,
} from '../src/storage.js'
import { prngSymbols } from './helpers/streams.js'

interface StorageFixtures {
  cases: Array<{
    label: string
    x: number[]
    alphabet: number
    measures: Array<{
      k: number
      activeInfo: number
      localActiveInfo?: number[]
      entropyRate: number
      blockEntropy: number
      predictiveInfo2?: number
    }>
  }>
}

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'storage.json'), 'utf8'),
) as StorageFixtures

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(FlowError)
    return (error as FlowError).code
  }
  throw new Error('expected a FlowError')
}

describe('PyInform cross-checks', () => {
  test('documented values: active_info = 0.3059584928680418, entropy_rate = 0.6792696431662095', () => {
    const series = [0, 0, 1, 1, 1, 1, 0, 0, 0]
    expect(activeInformationStorage(series, { k: 2 })).toBeCloseTo(0.3059584928680418, 15)
    expect(entropyRate(series, { k: 2 })).toBeCloseTo(0.6792696431662095, 15)
  })

  test('activeInformationStorage, local AIS, entropyRate, blockEntropy match pyinform', () => {
    for (const c of fixtures.cases) {
      for (const m of c.measures) {
        const opts = { k: m.k }
        expect(Math.abs(activeInformationStorage(c.x, opts) - m.activeInfo), c.label).toBeLessThan(
          1e-12,
        )
        expect(Math.abs(entropyRate(c.x, opts) - m.entropyRate), c.label).toBeLessThan(1e-12)
        expect(Math.abs(blockEntropy(c.x, m.k) - m.blockEntropy), c.label).toBeLessThan(1e-12)
        if (m.localActiveInfo !== undefined) {
          const local = localActiveInformationStorage(c.x, opts)
          expect(local.start).toBe(m.k)
          expect(local.count).toBe(m.localActiveInfo.length)
          for (let i = 0; i < local.count; i++) {
            expect(
              Math.abs((local.values[m.k + i] as number) - (m.localActiveInfo[i] as number)),
            ).toBeLessThan(1e-12)
          }
        }
      }
    }
  })

  test('predictiveInformation(k, kFuture = 2) matches pyinform mutual_info of block codes', () => {
    for (const c of fixtures.cases) {
      for (const m of c.measures) {
        if (m.predictiveInfo2 === undefined) continue
        const value = predictiveInformation(c.x, { k: m.k, kFuture: 2 })
        expect(Math.abs(value - m.predictiveInfo2), c.label).toBeLessThan(1e-12)
      }
    }
  })
})

describe('identities and closed forms', () => {
  test('AIS + entropy rate = H(X_{t+1}) over the same predicted samples', () => {
    for (const [alphabet, seed] of [
      [2, 1],
      [3, 2],
      [5, 3],
    ] as const) {
      const x = prngSymbols(3000, alphabet, seed)
      for (const k of [1, 2, 3]) {
        const future = shannonEntropy(x.subarray(k))
        expect(activeInformationStorage(x, { k }) + entropyRate(x, { k })).toBeCloseTo(future, 12)
      }
    }
  })

  test('period-p sequence: AIS = log2 p for k ≥ p − 1, entropy rate 0', () => {
    for (const p of [2, 3, 5]) {
      const x = Int32Array.from({ length: 50 * p + 1 }, (_, i) => i % p)
      for (let k = p - 1; k <= p + 1; k++) {
        const ais = activeInformationStorage(x, { k })
        expect(ais).toBeCloseTo(shannonEntropy(x.subarray(k)), 14)
        expect(entropyRate(x, { k })).toBe(0)
      }
      const exact = Int32Array.from({ length: 30 * p + (p - 1) }, (_, i) => i % p)
      // predicted samples x_{p−1} … cover whole periods → exactly uniform → log2 p
      expect(activeInformationStorage(exact, { k: p - 1 })).toBeCloseTo(Math.log2(p), 14)
    }
  })

  test('local AIS mean is exactly the plug-in AIS; NaN warm-up prefix', () => {
    const x = prngSymbols(500, 3, 9)
    const local = localActiveInformationStorage(x, { k: 2 })
    expect(local.mean).toBe(activeInformationStorage(x, { k: 2 }))
    expect(Number.isNaN(local.values[1] as number)).toBe(true)
    expect(Number.isFinite(local.values[2] as number)).toBe(true)
    expect(local.count).toBe(498)
  })

  test('predictiveInformation with kFuture = 1 is exactly AIS; default kFuture = k', () => {
    const x = prngSymbols(2000, 2, 17)
    expect(predictiveInformation(x, { k: 3, kFuture: 1 })).toBe(
      activeInformationStorage(x, { k: 3 }),
    )
    expect(predictiveInformation(x, { k: 2 })).toBe(predictiveInformation(x, { k: 2, kFuture: 2 }))
  })

  test('blockEntropy(x, 1) equals shannonEntropy; iid bits ≈ k bits per block', () => {
    const x = prngSymbols(4000, 2, 21)
    expect(blockEntropy(x, 1)).toBe(shannonEntropy(x))
    expect(blockEntropy(x, 4)).toBeCloseTo(4, 1)
    expect(blockEntropy(x, 2, { millerMadow: true })).toBeCloseTo(
      blockEntropy(x, 2) + 3 / (2 * 3999 * Math.LN2),
      14,
    )
  })

  test('Miller–Madow: AIS unclamped and corrected; entropy rate gains (K_joint − K_past)/(2N ln 2)', () => {
    const x = prngSymbols(1000, 2, 5)
    const mm = activeInformationStorage(x, { k: 2, millerMadow: true })
    expect(mm).toBeLessThan(activeInformationStorage(x, { k: 2 }))
    // 8 joint (past2, next) cells and 4 past cells, all occupied
    expect(entropyRate(x, { k: 2, millerMadow: true }) - entropyRate(x, { k: 2 })).toBeCloseTo(
      (8 - 4) / (2 * 998 * Math.LN2),
      14,
    )
  })

  test('validation', () => {
    expect(codeOf(() => activeInformationStorage([0, 1, 0], { k: 0 }))).toBe('invalid_input')
    expect(codeOf(() => activeInformationStorage([0, 1], { k: 1 }))).toBe('insufficient_data')
    expect(codeOf(() => entropyRate([0, 1.5, 0]))).toBe('invalid_input')
    expect(codeOf(() => blockEntropy([0, 1], 3))).toBe('insufficient_data')
    expect(codeOf(() => blockEntropy([0, 1], 0))).toBe('invalid_input')
    expect(codeOf(() => predictiveInformation([0, 1, 0, 1], { kFuture: 0 }))).toBe('invalid_input')
    expect(codeOf(() => predictiveInformation([0, 1, 0, 1], { k: 2, kFuture: 2 }))).toBe(
      'insufficient_data',
    )
    expect(codeOf(() => activeInformationStorage([0, 3, 1], { alphabet: 2 }))).toBe('invalid_input')
  })
})
