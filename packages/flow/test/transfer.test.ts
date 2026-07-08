import { describe, expect, test } from 'bun:test'
import { FlowError } from '../src/errors.js'
import { localTransferEntropy, netTransferEntropy, transferEntropy } from '../src/transfer.js'
import { balancedShiftPair, prngBits, prngSymbols, prngUniforms } from './helpers/streams.js'

describe('transferEntropy closed forms', () => {
  test('y = x delayed by one, balanced construction → exactly 1 bit', () => {
    const { x, y } = balancedShiftPair(64)
    expect(transferEntropy(x, y, { k: 1, l: 1 })).toBe(1)
  })

  test('y = x delayed by one, iid uniform bits → ≈ 1 bit', () => {
    const x = prngBits(8192, 0x1234)
    const y = new Int32Array(x.length)
    y[0] = x[x.length - 1] as number
    for (let t = 1; t < x.length; t++) y[t] = x[t - 1] as number
    expect(transferEntropy(x, y)).toBeCloseTo(1, 2)
    // the reverse direction sees nothing: x's future is fresh iid randomness
    expect(transferEntropy(y, x)).toBeLessThan(0.01)
  })

  test('local TE mean equals TE, aligned to the predicted sample', () => {
    const { x, y } = balancedShiftPair(64)
    const local = localTransferEntropy(x, y)
    expect(local.mean).toBe(transferEntropy(x, y))
    expect(local.start).toBe(1)
    expect(local.count).toBe(x.length - 1)
    expect(Number.isNaN(local.values[0] as number)).toBe(true)
    for (let t = local.start; t < local.values.length; t++) {
      expect(local.values[t]).toBe(1)
    }
  })

  test('local TE mean equals TE on noisy data too', () => {
    const x = prngSymbols(2000, 3, 0x77)
    const y = prngSymbols(2000, 3, 0x88)
    const local = localTransferEntropy(x, y, { k: 2, l: 1 })
    let sum = 0
    for (let t = local.start; t < local.values.length; t++) sum += local.values[t] as number
    expect(sum / local.count).toBeCloseTo(transferEntropy(x, y, { k: 2, l: 1 }), 12)
    expect(local.count).toBe(local.values.length - local.start)
  })

  test('independent iid streams → TE tiny', () => {
    const te = transferEntropy(prngBits(4096, 0xaaaa), prngBits(4096, 0xbbbb))
    expect(te).toBeGreaterThanOrEqual(0)
    expect(te).toBeLessThan(0.005)
  })

  test('dependence two steps back: high TE at lag 2, low at lag 1', () => {
    // y[t] = x[t−2]
    const x = prngBits(4096, 0x4242)
    const y = new Int32Array(x.length)
    for (let t = 2; t < x.length; t++) y[t] = x[t - 2] as number
    expect(transferEntropy(x, y, { lag: 2 })).toBeGreaterThan(0.9)
    expect(transferEntropy(x, y, { lag: 1 })).toBeLessThan(0.1)
    // equivalently, source history l=2 at lag 1 covers the true lag
    expect(transferEntropy(x, y, { lag: 1, l: 2 })).toBeGreaterThan(0.9)
  })

  test('netTransferEntropy is antisymmetric and points x→y for a driven pair', () => {
    const x = prngBits(4096, 0x1111)
    const y = new Int32Array(x.length)
    for (let t = 1; t < x.length; t++) y[t] = x[t - 1] as number
    const net = netTransferEntropy(x, y)
    expect(net).toBeGreaterThan(0.9)
    expect(netTransferEntropy(y, x)).toBeCloseTo(-net, 12)
  })
})

describe('transferEntropy vs analytic coupled binary Markov chain', () => {
  // x_t iid Bernoulli(1/2); P(y_{t+1} = 1 | y_t, x_t) = THETA[y_t][x_t].
  const THETA = Object.freeze([Object.freeze([0.1, 0.7]), Object.freeze([0.3, 0.9])] as const)

  test('estimator on a long seeded realization matches the exact plug-in TE', () => {
    // Exact TE from the stationary distribution. P(y+=1 | y) = mean over x is
    // 0.4 (y=0) and 0.6 (y=1) → the y-chain is symmetric → π = (1/2, 1/2).
    const piY = [0.5, 0.5]
    let expected = 0
    for (const y of [0, 1]) {
      const pMean =
        ((THETA[y] as readonly [number, number])[0] + (THETA[y] as readonly [number, number])[1]) /
        2
      for (const x of [0, 1]) {
        const p1 = (THETA[y] as readonly [number, number])[x] as number
        for (const yNext of [0, 1]) {
          const cond = yNext === 1 ? p1 : 1 - p1
          const condMarginal = yNext === 1 ? pMean : 1 - pMean
          if (cond > 0) {
            expected += (piY[y] as number) * 0.5 * cond * Math.log2(cond / condMarginal)
          }
        }
      }
    }
    expect(expected).toBeCloseTo(0.2958, 3) // sanity pin against a hand calculation

    const n = 120_000
    const u = prngUniforms(2 * n, 0x600d5eed)
    const x = new Int32Array(n)
    const y = new Int32Array(n)
    for (let t = 0; t < n; t++) {
      x[t] = (u[2 * t] as number) < 0.5 ? 0 : 1
      if (t < n - 1) {
        const p1 = (THETA[y[t] as 0 | 1] as readonly [number, number])[x[t] as 0 | 1] as number
        y[t + 1] = (u[2 * t + 1] as number) < p1 ? 1 : 0
      }
    }
    expect(Math.abs(transferEntropy(x, y) - expected)).toBeLessThan(1e-2)
  })
})

describe('transferEntropy properties', () => {
  test('TE ≥ 0 across random alphabets, embeddings, and seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const pick = prngUniforms(6, seed * 0x9e37)
      const alphabet = 2 + Math.floor((pick[0] as number) * 4)
      const k = 1 + Math.floor((pick[1] as number) * 3)
      const l = 1 + Math.floor((pick[2] as number) * 3)
      const lag = 1 + Math.floor((pick[3] as number) * 3)
      const x = prngSymbols(300, alphabet, seed * 31)
      const y = prngSymbols(300, alphabet, seed * 37)
      expect(transferEntropy(x, y, { k, l, lag })).toBeGreaterThanOrEqual(0)
    }
  })

  test('TE is invariant under independent symbol relabeling of both streams', () => {
    const x = prngSymbols(1000, 4, 0xfeed)
    const y = prngSymbols(1000, 4, 0xbead)
    const relabelX = [3, 0, 2, 1]
    const relabelY = [1, 3, 0, 2]
    const te = transferEntropy(x, y, { k: 2, l: 2, lag: 2 })
    const teRelabeled = transferEntropy(
      Array.from(x, (v) => relabelX[v] as number),
      Array.from(y, (v) => relabelY[v] as number),
      { k: 2, l: 2, lag: 2 },
    )
    expect(teRelabeled).toBe(te)
  })

  test('explicit alphabet never changes the estimate (encoding only)', () => {
    const x = prngSymbols(500, 3, 0x777)
    const y = prngSymbols(500, 3, 0x888)
    const te = transferEntropy(x, y, { k: 2, l: 1 })
    expect(transferEntropy(x, y, { k: 2, l: 1, alphabet: 3 })).toBe(te)
    // alphabet 1500 forces the string-key fallback for the k+l+1 tuple space
    expect(transferEntropy(x, y, { k: 2, l: 1, alphabet: 1500 })).toBeCloseTo(te, 12)
  })

  test('millerMadow shifts by the four-term cell-count correction', () => {
    const x = prngSymbols(400, 2, 0x21)
    const y = prngSymbols(400, 2, 0x43)
    const plain = transferEntropy(x, y)
    const corrected = transferEntropy(x, y, { millerMadow: true })
    // binary with k = l = 1: the four count tables have 4 (dest past+future),
    // 4 (dest past+source), 8 (full), and 2 (dest past) cells, all occupied
    // in a 400-sample iid pair → correction = (4 + 4 − 8 − 2)/(2·399·ln 2).
    expect(corrected - plain).toBeCloseTo((4 + 4 - 8 - 2) / (2 * 399 * Math.LN2), 12)
  })

  test('rejects invalid embeddings and misaligned inputs', () => {
    const x = prngBits(64, 1)
    const y = prngBits(64, 2)
    expect(() => transferEntropy(x, y, { k: 0 })).toThrow(FlowError)
    expect(() => transferEntropy(x, y, { l: 0.5 })).toThrow(FlowError)
    expect(() => transferEntropy(x, y, { lag: 0 })).toThrow(FlowError)
    expect(() => transferEntropy(x, prngBits(63, 2))).toThrow(FlowError)
    try {
      transferEntropy([0, 1, 0], [1, 0, 1], { k: 5 })
      expect.unreachable()
    } catch (error) {
      expect((error as FlowError).code).toBe('insufficient_data')
    }
  })
})
