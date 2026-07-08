import { describe, expect, test } from 'bun:test'
import { evaluate } from '../src/evaluate.js'
import { pietrzakProve } from '../src/prove.js'
import type { PietrzakProof } from '../src/types.js'
import { pietrzakVerify } from '../src/verify.js'
import { expectVdfError } from './helpers/expect.js'
import { TEST_MODULUS } from './helpers/test-modulus.js'

const pulse = new TextEncoder().encode('pulse-1')
const opts = { modulus: TEST_MODULUS }
const T_VALUES = [1, 2, 3, 7, 8, 1000, 4096]

// One honest proof, reused by the whole tamper suite.
const T = 1000
const { y } = await evaluate(pulse, T, opts)
const proof = await pietrzakProve(pulse, T, y, opts)

function withMus(mus: readonly bigint[]): PietrzakProof {
  return { T: proof.T, y: proof.y, mus }
}

describe('evaluate → prove → verify round-trip', () => {
  for (const t of T_VALUES) {
    test(`accepts an honest proof at T=${t}`, async () => {
      const result = await evaluate(pulse, t, opts)
      const p = await pietrzakProve(pulse, t, result.y, opts)
      expect(await pietrzakVerify(pulse, t, result.y, p, opts)).toBe(true)
    })
  }

  test('RSA-2048 smoke test at T=256', async () => {
    const result = await evaluate(pulse, 256)
    const p = await pietrzakProve(pulse, 256, result.y)
    expect(await pietrzakVerify(pulse, 256, result.y, p)).toBe(true)
    const forged = { T: p.T, y: p.y ^ 1n, mus: p.mus }
    expect(await pietrzakVerify(pulse, 256, result.y ^ 1n, forged)).toBe(false)
  })
})

describe('tamper suite — every manipulation must verify false, never throw', () => {
  test('one flipped bit in y (claim kept self-consistent)', async () => {
    const bad = y ^ 1n
    expect(await pietrzakVerify(pulse, T, bad, { T, y: bad, mus: proof.mus }, opts)).toBe(false)
  })

  test('proof.y disagreeing with the y argument', async () => {
    expect(await pietrzakVerify(pulse, T, y, { T, y: y ^ 1n, mus: proof.mus }, opts)).toBe(false)
  })

  test('one flipped bit in any single midpoint', async () => {
    for (let i = 0; i < proof.mus.length; i++) {
      const mus = proof.mus.slice()
      mus[i] = (mus[i] as bigint) ^ 1n
      expect(await pietrzakVerify(pulse, T, y, withMus(mus), opts)).toBe(false)
    }
  })

  test('one flipped bit in the input', async () => {
    const tampered = Uint8Array.from(pulse)
    tampered[0] = (tampered[0] as number) ^ 0x01
    expect(await pietrzakVerify(tampered, T, y, proof, opts)).toBe(false)
  })

  test('wrong T (same midpoint count, so the crypto must catch it)', async () => {
    expect(await pietrzakVerify(pulse, T + 1, y, { T: T + 1, y, mus: proof.mus }, opts)).toBe(false)
  })

  test('proof.T disagreeing with the T argument', async () => {
    expect(await pietrzakVerify(pulse, T + 1, y, proof, opts)).toBe(false)
  })

  test('the μ = 0 forgery (would collapse both folds to 0 and pass the final check)', async () => {
    const mus = proof.mus.slice()
    mus[0] = 0n
    expect(await pietrzakVerify(pulse, T, y, withMus(mus), opts)).toBe(false)
  })

  test('out-of-range midpoints and outputs', async () => {
    const mus = proof.mus.slice()
    mus[0] = TEST_MODULUS.n
    expect(await pietrzakVerify(pulse, T, y, withMus(mus), opts)).toBe(false)
    const huge = TEST_MODULUS.n + 2n
    expect(await pietrzakVerify(pulse, T, huge, { T, y: huge, mus: proof.mus }, opts)).toBe(false)
  })

  test('wrong midpoint count', async () => {
    expect(await pietrzakVerify(pulse, T, y, withMus(proof.mus.slice(1)), opts)).toBe(false)
    expect(await pietrzakVerify(pulse, T, y, withMus([...proof.mus, 2n]), opts)).toBe(false)
  })

  test('an honest proof still verifies after the suite (no shared-state corruption)', async () => {
    expect(await pietrzakVerify(pulse, T, y, proof, opts)).toBe(true)
  })
})

describe('malformed arguments throw invalid_input (the only throwing path)', () => {
  test('structurally broken proofs', async () => {
    await expectVdfError(
      pietrzakVerify(pulse, T, y, null as unknown as PietrzakProof, opts),
      'invalid_input',
    )
    await expectVdfError(
      pietrzakVerify(pulse, T, y, { T, y, mus: ['1'] } as unknown as PietrzakProof, opts),
      'invalid_input',
    )
    await expectVdfError(
      pietrzakVerify(pulse, T, y, { T, y } as unknown as PietrzakProof, opts),
      'invalid_input',
    )
  })

  test('bad T, y, input, and modulus', async () => {
    await expectVdfError(pietrzakVerify(pulse, 0, y, proof, opts), 'invalid_input')
    await expectVdfError(
      pietrzakVerify(pulse, T, '5' as unknown as bigint, proof, opts),
      'invalid_input',
    )
    await expectVdfError(
      pietrzakVerify(undefined as unknown as Uint8Array, T, y, proof, opts),
      'invalid_input',
    )
    await expectVdfError(
      pietrzakVerify(pulse, T, y, proof, { modulus: { n: 8n } }),
      'invalid_modulus',
    )
  })
})
