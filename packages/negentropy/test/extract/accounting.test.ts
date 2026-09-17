import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import {
  claimBytes,
  conditionAccounted,
  debiasAccounted,
  extractAccounted,
  outputEntropy,
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

/** Linear-space Output_Entropy with exact BigInt powers of two — valid while 2^n_in fits a double. */
function outputEntropyLinear(nIn: number, nOut: number, nw: number, hIn: number): number {
  const pHigh = 2 ** -hIn
  const pLow = (1 - pHigh) / Number(2n ** BigInt(nIn) - 1n)
  const n = Math.min(nOut, nw)
  const scale = 2 ** (nIn - n)
  const psi = scale * pLow + pHigh
  const u = scale + Math.sqrt(2 * n * scale * Math.LN2)
  const omega = u * pLow
  return -Math.log2(Math.max(psi, omega))
}

/** The pre-0.2.0 credit, kept as documented history: it ignored the collision term. */
const legacyVettedOutputEntropy = (hIn: number, nOut: number): number => Math.min(hIn, 0.999 * nOut)

describe('outputEntropy (SP 800-90B §3.1.5.1.2 Output_Entropy)', () => {
  test('worked values: the ψ collision term and the ω multicollision term', () => {
    expect(outputEntropy(512, 256, 256, 256)).toBeCloseTo(255, 12) // ψ = 2·2⁻²⁵⁶
    expect(outputEntropy(8000, 256, 256, 255)).toBeCloseTo(256 - Math.log2(3), 12) // 2⁻²⁵⁶ + 2⁻²⁵⁵
    expect(outputEntropy(2048, 256, 256, 255.5)).toBeCloseTo(254.7284466968364, 10)
    expect(outputEntropy(256, 256, 256, 256)).toBeCloseTo(251.68976456872704, 10) // ω dominates
    expect(outputEntropy(800, 256, 256, 100)).toBeCloseTo(100, 12)
  })

  test('log-space evaluation equals the linear-space formula where the latter is representable', () => {
    for (const [nIn, nOut, nw, hIn] of [
      [64, 32, 32, 20],
      [64, 32, 32, 32],
      [128, 64, 64, 63.5],
      [40, 64, 64, 30],
      [512, 256, 128, 200],
      [1000, 256, 256, 255.9],
    ] as const) {
      expect(outputEntropy(nIn, nOut, nw, hIn)).toBeCloseTo(
        outputEntropyLinear(nIn, nOut, nw, hIn),
        9,
      )
    }
  })

  test('narrowest internal width caps the output; huge n_in works in log space', () => {
    expect(outputEntropy(4096, 256, 128, 4000)).toBeCloseTo(128, 9)
    expect(outputEntropy(10_000_000, 256, 256, 1_000_000)).toBe(256)
    expect(outputEntropy(1, 1, 1, 0)).toBe(0)
  })

  test('is monotone: never above h_in or n, non-decreasing in h_in and in n_in', () => {
    let previous = -1
    for (let h = 0; h <= 512; h += 16) {
      const value = outputEntropy(512, 256, 256, h)
      expect(value).toBeLessThanOrEqual(Math.min(h, 256))
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    previous = -1
    for (const nIn of [256, 257, 260, 300, 512, 4096]) {
      const value = outputEntropy(nIn, 256, 256, 256)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  test('validation', () => {
    const invalid = expect.objectContaining({ code: 'invalid_config' })
    expect(() => outputEntropy(0, 256, 256, 0)).toThrow(invalid)
    expect(() => outputEntropy(512, 256.5, 256, 10)).toThrow(invalid)
    expect(() => outputEntropy(512, 256, 256, 513)).toThrow(invalid)
    expect(() => outputEntropy(512, 256, 256, Number.NaN)).toThrow(invalid)
  })
})

describe('vettedOutputEntropy', () => {
  test('min(Output_Entropy, 0.999·n_out)', () => {
    expect(vettedOutputEntropy(300, 256)).toBeCloseTo(255.744, 10)
    expect(vettedOutputEntropy(100, 256)).toBe(100)
    expect(vettedOutputEntropy(256, 256, 512)).toBeCloseTo(255, 12)
    expect(vettedOutputEntropy(4000, 256, 8000)).toBeCloseTo(255.744, 10)
  })

  test('omitted n_in defaults to ⌈h_in⌉ — the most conservative admissible width', () => {
    expect(vettedOutputEntropy(256, 256)).toBeCloseTo(251.68976456872704, 10)
    for (const nIn of [256, 300, 512, 2048]) {
      expect(vettedOutputEntropy(256, 256)).toBeLessThanOrEqual(vettedOutputEntropy(256, 256, nIn))
    }
  })

  test('history: the old min(h_in, 0.999·n_out) overcredited near h_in ≈ n_out', () => {
    expect(legacyVettedOutputEntropy(256, 256)).toBeCloseTo(255.744, 10)
    expect(vettedOutputEntropy(256, 256, 512)).toBeCloseTo(255, 12) // 0.744 bits less
    expect(
      legacyVettedOutputEntropy(255.5, 256) - vettedOutputEntropy(255.5, 256, 2048),
    ).toBeCloseTo(0.7715533031, 8)
    // far from the knee both rules agree
    expect(vettedOutputEntropy(100, 256, 800)).toBeCloseTo(legacyVettedOutputEntropy(100, 256), 9)
    expect(vettedOutputEntropy(300, 256, 800)).toBeCloseTo(legacyVettedOutputEntropy(300, 256), 9)
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
    await expect(conditionAccounted(input, { mode: 'hmac' })).rejects.toMatchObject({
      code: 'invalid_config',
    })
  })

  test('debias is conservative by default: the claim is capped at the input claim', () => {
    const input = claimBytes(prngBytes(1000, 0x11), 0.5, 'measured') // 500 bits claimed
    const debiased = debiasAccounted(input, 'peres')
    expect(debiased.bytes.length * 8).toBeGreaterThan(500) // ~1700 output bits…
    expect(debiased.claim.minEntropy).toBe(500) // …but the claim cannot grow
    expect(debiased.trace[0]).toMatchObject({
      op: 'debias:peres',
      inMinEntropy: 500,
      outMinEntropy: 500,
    })
    expect(debiased.claim.assumptions.some((a) => a.includes('iid'))).toBe(true)
    const vn = debiasAccounted(input, 'von-neumann')
    expect(vn.bytes.length).toBeLessThan(debiased.bytes.length) // Peres out-yields VN
    // when the output is the binding limit the claim is 8 bits per packed byte
    const generous = debiasAccounted(claimBytes(prngBytes(1000, 0x11), 8), 'peres')
    expect(generous.claim.minEntropy).toBe(generous.bytes.length * 8)
  })

  test("debias { basis: 'iid' } opts into full output credit (the pre-0.2.0 behaviour)", () => {
    const input = claimBytes(prngBytes(1000, 0x11), 0.5, 'measured')
    const debiased = debiasAccounted(input, 'peres', { basis: 'iid' })
    expect(debiased.claim.minEntropy).toBe(debiased.bytes.length * 8)
    expect(debiased.claim.minEntropy).toBeGreaterThan(input.claim.minEntropy)
    expect(debiased.claim.assumptions.at(-1)).toContain('full output credit')
    const invalid = expect.objectContaining({ code: 'invalid_config' })
    expect(() => debiasAccounted(input, 'peres', { basis: 'bogus' as 'iid' })).toThrow(invalid)
    expect(() => debiasAccounted(input, 'bogus' as 'peres')).toThrow(invalid)
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

  test('monotonicity: every step of every default pipeline has outMinEntropy ≤ inMinEntropy', async () => {
    for (const perByte of [0.25, 1, 3, 6, 8]) {
      for (const method of ['peres', 'von-neumann'] as const) {
        const start = claimBytes(prngBytes(1500, 0x77), perByte, 'measured')
        const debiased = debiasAccounted(start, method)
        const conditioned = await conditionAccounted(debiased)
        const chain = [start, debiased, conditioned]
        for (let i = 1; i < chain.length; i++) {
          const before = chain[i - 1] as typeof start
          const after = chain[i] as typeof start
          expect(after.claim.minEntropy).toBeLessThanOrEqual(before.claim.minEntropy)
        }
        for (const step of conditioned.trace) {
          expect(step.outMinEntropy).toBeLessThanOrEqual(step.inMinEntropy)
        }
      }
      // extraction branch: Toeplitz output ≤ claim − 2·log₂(1/ε)
      const bytes = prngBytes(500, 0x78)
      const claimed = claimBytes(bytes, Math.max(perByte, 1))
      const m = toeplitzOutputBits(claimed.claim.minEntropy)
      if (m >= 1) {
        const seed = prngBytes(Math.ceil((4000 + m - 1) / 8), 0x79)
        const extracted = extractAccounted(claimed, toeplitzExtractor(seed, 4000, m))
        expect(extracted.claim.minEntropy).toBeLessThanOrEqual(claimed.claim.minEntropy)
      }
    }
  })

  test('conditioning credits Output_Entropy with the real input width', async () => {
    // 64 full-entropy bytes (512 bits, h = 512) → 256-bit block: min(256 − ε, 255.744)
    const full = await conditionAccounted(claimBytes(prngBytes(64, 0x81), 8))
    expect(full.claim.minEntropy).toBeCloseTo(255.744, 9)
    // 64 bytes at 4 bits/byte (h = 256 over 512 bits) → Output_Entropy 255.0, not 255.744
    const knee = await conditionAccounted(claimBytes(prngBytes(64, 0x82), 4))
    expect(knee.claim.minEntropy).toBeCloseTo(255, 12)
    expect(knee.trace[0]).toMatchObject({ inMinEntropy: 256, outMinEntropy: knee.claim.minEntropy })
  })
})
