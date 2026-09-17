import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectiveTransferEntropy, conditionalTransferEntropy } from '../src/conditional.js'
import { FlowError } from '../src/errors.js'
import { localTransferEntropy, transferEntropy } from '../src/transfer.js'
import { prngBits, prngSymbols } from './helpers/streams.js'

interface ConditionalFixtures {
  cases: Array<{
    label: string
    x: number[]
    y: number[]
    conditions: number[][]
    k: number
    te: number
  }>
  blocks: Array<{
    label: string
    x: number[]
    y: number[]
    w: number[]
    k: number
    l: number
    lag: number
    condK: number
    condLag: number
    te: number
    count: number
    cte: number
  }>
}

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'conditional.json'), 'utf8'),
) as ConditionalFixtures

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(FlowError)
    return (error as FlowError).code
  }
  throw new Error('expected a FlowError')
}

describe('conditionalTransferEntropy — PyInform cross-checks', () => {
  test("reproduces PyInform's documented conditional example (0.2857142857142857)", () => {
    const xs = [0, 1, 1, 1, 1, 0, 0, 0, 0]
    const ys = [0, 0, 1, 1, 1, 1, 0, 0, 0]
    const ws = [0, 1, 1, 1, 1, 0, 1, 1, 1]
    expect(conditionalTransferEntropy(xs, ys, [ws], { k: 2 })).toBe(0.2857142857142857)
    expect(transferEntropy(xs, ys, { k: 2 })).toBeCloseTo(0.6792696431662097, 15)
  })

  test('matches pyinform transfer_entropy(…, condition=…) on seeded multi-condition cases', () => {
    for (const c of fixtures.cases) {
      const value = conditionalTransferEntropy(c.x, c.y, c.conditions, { k: c.k })
      expect(Math.abs(value - c.te), c.label).toBeLessThan(1e-12)
    }
  })

  test('l, lag, condK, condLag > 1 match block-coded PyInform conditional entropies', () => {
    for (const b of fixtures.blocks) {
      const embedding = { k: b.k, l: b.l, lag: b.lag }
      expect(Math.abs(transferEntropy(b.x, b.y, embedding) - b.te), b.label).toBeLessThan(1e-12)
      expect(localTransferEntropy(b.x, b.y, embedding).count).toBe(b.count)
      const cte = conditionalTransferEntropy(b.x, b.y, [b.w], {
        ...embedding,
        condK: b.condK,
        condLag: b.condLag,
      })
      expect(Math.abs(cte - b.cte), b.label).toBeLessThan(1e-12)
    }
  })
})

describe('conditionalTransferEntropy — closed forms', () => {
  test('conditioning on the common driver removes spurious flow exactly', () => {
    // Z iid; X_t = Z_{t−1}; Y_t = Z_{t−2}  ⇒  Y_{t+1} = X_t: pairwise TE ≈ 1 bit,
    // but given w = z_{t−1} (condLag 2) the destination is fully determined.
    const n = 4096
    const z = prngBits(n, 0x2024)
    const x = new Int32Array(n)
    const y = new Int32Array(n)
    for (let t = 2; t < n; t++) {
      x[t] = z[t - 1] as number
      y[t] = z[t - 2] as number
    }
    expect(transferEntropy(x, y)).toBeGreaterThan(0.95)
    expect(conditionalTransferEntropy(x, y, [z], { condLag: 2 })).toBe(0)
  })

  test('with no conditions it is exactly transferEntropy (incl. Miller–Madow)', () => {
    const x = prngSymbols(700, 3, 1)
    const y = prngSymbols(700, 3, 2)
    for (const opts of [{}, { k: 2, l: 2, lag: 3 }, { millerMadow: true }]) {
      expect(conditionalTransferEntropy(x, y, [], opts)).toBe(transferEntropy(x, y, opts))
    }
  })

  test('conditioning can reveal synergy: y = x ⊕ w is invisible pairwise, 1 bit given w', () => {
    const n = 8192
    const x = prngBits(n, 0x11)
    const w = prngBits(n, 0x22)
    const y = new Int32Array(n)
    for (let t = 1; t < n; t++) y[t] = (x[t - 1] as number) ^ (w[t - 1] as number)
    expect(transferEntropy(x, y)).toBeLessThan(0.01)
    expect(conditionalTransferEntropy(x, y, [w])).toBeGreaterThan(0.99)
  })

  test('validates embedding, condition options and alignment', () => {
    const x = prngBits(100, 1)
    const y = prngBits(100, 2)
    expect(codeOf(() => conditionalTransferEntropy(x, y, [x], { condK: 0 }))).toBe('invalid_input')
    expect(codeOf(() => conditionalTransferEntropy(x, y, [x], { condLag: 1.5 }))).toBe(
      'invalid_input',
    )
    expect(codeOf(() => conditionalTransferEntropy(x, y, [prngBits(99, 3)]))).toBe('invalid_input')
    expect(codeOf(() => conditionalTransferEntropy(x, y, x as never))).toBe('invalid_input')
    expect(codeOf(() => conditionalTransferEntropy(x, y, [[2, 1]] as never, { alphabet: 2 }))).toBe(
      'invalid_input',
    )
    expect(
      codeOf(() => conditionalTransferEntropy([0, 1, 0], [1, 0, 1], [[0, 0, 0]], { condLag: 3 })),
    ).toBe('insufficient_data')
  })
})

describe('collectiveTransferEntropy', () => {
  test('one source is exactly transferEntropy', () => {
    const x = prngSymbols(900, 4, 7)
    const y = prngSymbols(900, 4, 8)
    for (const opts of [{}, { k: 2, l: 2, lag: 2 }, { millerMadow: true }]) {
      expect(collectiveTransferEntropy([x], y, opts)).toBe(transferEntropy(x, y, opts))
    }
  })

  test('equals TE from the jointly coded source (identical count tables)', () => {
    const x1 = prngBits(2000, 31)
    const x2 = prngBits(2000, 32)
    const y = prngSymbols(2000, 3, 33)
    const joint = Int32Array.from(x1, (v, i) => 2 * v + (x2[i] as number))
    expect(collectiveTransferEntropy([x1, x2], y, { k: 2 })).toBeCloseTo(
      transferEntropy(joint, y, { k: 2 }),
      14,
    )
  })

  test('XOR synergy: pairwise ≈ 0, collective ≈ 1 bit', () => {
    const n = 8192
    const x1 = prngBits(n, 0x51)
    const x2 = prngBits(n, 0x52)
    const y = new Int32Array(n)
    for (let t = 1; t < n; t++) y[t] = (x1[t - 1] as number) ^ (x2[t - 1] as number)
    expect(transferEntropy(x1, y)).toBeLessThan(0.01)
    expect(transferEntropy(x2, y)).toBeLessThan(0.01)
    expect(collectiveTransferEntropy([x1, x2], y)).toBeGreaterThan(0.99)
  })

  test('validates sources', () => {
    const y = prngBits(50, 1)
    expect(codeOf(() => collectiveTransferEntropy([], y))).toBe('invalid_input')
    expect(codeOf(() => collectiveTransferEntropy([prngBits(49, 2)], y))).toBe('invalid_input')
    expect(codeOf(() => collectiveTransferEntropy(y as never, y))).toBe('invalid_input')
  })
})
