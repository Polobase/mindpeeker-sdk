import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import {
  claimBytes,
  conditionAccounted,
  debiasAccounted,
  extractAccounted,
  vettedOutputEntropy,
} from '../../src/extract/accounting.js'
import { toeplitzExtractor, toeplitzOutputBits } from '../../src/extract/toeplitz.js'
import { prngBytes } from '../helpers/byte-sources.js'

describe('claimBytes', () => {
  test('creates a claim with the invariant 0 ≤ minEntropy ≤ 8·bytes', () => {
    const accounted = claimBytes(prngBytes(100), 4, 'measured')
    expect(accounted.claim.minEntropy).toBe(400)
    expect(accounted.claim.epsilon).toBe(0)
    expect(accounted.claim.basis).toBe('measured')
    expect(accounted.trace).toEqual([])
  })

  test('rejects out-of-range per-byte claims', () => {
    expect(() => claimBytes(prngBytes(10), 0)).toThrow(NegentropyError)
    expect(() => claimBytes(prngBytes(10), 8.5)).toThrow(NegentropyError)
  })
})

describe('vettedOutputEntropy', () => {
  test('SP 800-90B §3.1.5.1.2: min(h_in, 0.999·n_out)', () => {
    expect(vettedOutputEntropy(300, 256)).toBeCloseTo(255.744, 10)
    expect(vettedOutputEntropy(100, 256)).toBe(100)
  })
})

describe('pipeline composition', () => {
  test('condition step caps at the vetted bound and records the trace', async () => {
    const input = claimBytes(prngBytes(1000), 4) // 4000 bits claimed
    const conditioned = await conditionAccounted(input)
    expect(conditioned.bytes.length).toBe(32)
    expect(conditioned.claim.minEntropy).toBeCloseTo(255.744, 10)
    expect(conditioned.claim.basis).toBe('derived')
    expect(conditioned.trace.length).toBe(1)
    expect(conditioned.trace[0]).toMatchObject({
      op: 'condition:sha256',
      inBytes: 1000,
      outBytes: 32,
      inMinEntropy: 4000,
    })
  })

  test('hmac mode requires a key and records its op', async () => {
    const input = claimBytes(prngBytes(64), 4)
    const conditioned = await conditionAccounted(input, {
      mode: 'hmac',
      key: prngBytes(32, 0xabc),
    })
    expect(conditioned.trace[0]?.op).toBe('condition:hmac')
    expect(conditionAccounted(input, { mode: 'hmac' })).rejects.toMatchObject({
      code: 'invalid_config',
    })
  })

  test('debias yields full credit on the packed output under the iid assumption', () => {
    const input = claimBytes(prngBytes(1000, 0x11), 2)
    const debiased = debiasAccounted(input, 'peres')
    expect(debiased.claim.minEntropy).toBe(debiased.bytes.length * 8)
    expect(debiased.claim.assumptions.some((a) => a.includes('iid'))).toBe(true)
    expect(debiased.trace[0]?.op).toBe('debias:peres')
    const vn = debiasAccounted(input, 'von-neumann')
    expect(vn.bytes.length).toBeLessThan(debiased.bytes.length) // Peres out-yields VN
  })

  test('extraction enforces the leftover hash lemma and accumulates epsilon', () => {
    const bytes = prngBytes(1000, 0x22) // 8000 bits
    const input = claimBytes(bytes, 4) // k = 4000
    const m = toeplitzOutputBits(4000) // 3936
    const seed = prngBytes(Math.ceil((8000 + m - 1) / 8), 0x33)
    const extracted = extractAccounted(input, toeplitzExtractor(seed, 8000, m))
    expect(extracted.claim.minEntropy).toBe(m)
    expect(extracted.claim.epsilon).toBe(2 ** -32)
    expect(extracted.claim.minEntropy).toBeLessThanOrEqual(extracted.bytes.length * 8)

    // asking for more output than the lemma allows must throw
    const greedy = toeplitzExtractor(prngBytes(Math.ceil((8000 + 4001 - 1) / 8), 0x44), 8000, 4001)
    expect(() => extractAccounted(input, greedy)).toThrow(NegentropyError)
  })

  test('claims never grow through a multi-step chain', async () => {
    const accounted = claimBytes(prngBytes(2000, 0x55), 3)
    const debiased = debiasAccounted(accounted, 'peres')
    const conditioned = await conditionAccounted(debiased)
    const stages = [accounted, debiased, conditioned]
    for (const stage of stages) {
      expect(stage.claim.minEntropy).toBeLessThanOrEqual(stage.bytes.length * 8)
      expect(stage.claim.minEntropy).toBeGreaterThanOrEqual(0)
    }
    for (const step of conditioned.trace) {
      expect(step.outMinEntropy).toBeLessThanOrEqual(step.outBytes * 8)
    }
    expect(conditioned.trace.map((s) => s.op)).toEqual(['debias:peres', 'condition:sha256'])
  })
})
