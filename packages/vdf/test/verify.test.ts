import { describe, expect, test } from 'bun:test'
import { evaluate } from '../src/evaluate.js'
import { modPow } from '../src/internal/bigint.js'
import { pietrzakProve } from '../src/prove.js'
import type { PietrzakProof } from '../src/types.js'
import { pietrzakVerify } from '../src/verify.js'
import { expectVdfError } from './helpers/expect.js'
import { forgeTwistedProof } from './helpers/forge.js'
import { canonical, P, Q, shortcutPower, TEST_MODULUS } from './helpers/test-modulus.js'

const pulse = new TextEncoder().encode('pulse-1')
const opts = { modulus: TEST_MODULUS }
const n = TEST_MODULUS.n
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

  test('RSA-2048 round trip at T=256 and T=1000', async () => {
    for (const t of [256, 1000]) {
      const result = await evaluate(pulse, t)
      const p = await pietrzakProve(pulse, t, result.y)
      expect(await pietrzakVerify(pulse, t, result.y, p)).toBe(true)
      const forged = { T: p.T, y: p.y ^ 1n, mus: p.mus }
      expect(await pietrzakVerify(pulse, t, result.y ^ 1n, forged)).toBe(false)
    }
  })

  test('a proof for one modulus is rejected under a same-width modulus', async () => {
    const other = { n: n + 2n }
    expect(await pietrzakVerify(pulse, T, y, proof, { modulus: other })).toBe(false)
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

  test('out-of-range and non-canonical midpoints and outputs', async () => {
    const mus = proof.mus.slice()
    mus[0] = n
    expect(await pietrzakVerify(pulse, T, y, withMus(mus), opts)).toBe(false)
    mus[0] = (n + 1n) / 2n // first non-canonical value
    expect(await pietrzakVerify(pulse, T, y, withMus(mus), opts)).toBe(false)
    const huge = n + 2n
    expect(await pietrzakVerify(pulse, T, huge, { T, y: huge, mus: proof.mus }, opts)).toBe(false)
    expect(await pietrzakVerify(pulse, T, -y, { T, y: -y, mus: proof.mus }, opts)).toBe(false)
  })

  test('wrong midpoint count', async () => {
    expect(await pietrzakVerify(pulse, T, y, withMus(proof.mus.slice(1)), opts)).toBe(false)
    expect(await pietrzakVerify(pulse, T, y, withMus([...proof.mus, 2n]), opts)).toBe(false)
  })

  test('edge delays: T=1 with a smuggled midpoint, T=2/3 single-round tampering, all-even T=4096', async () => {
    for (const t of [1, 2, 3, 4096]) {
      const honest = await evaluate(pulse, t, opts)
      const p = await pietrzakProve(pulse, t, honest.y, opts)
      const extra = { T: t, y: honest.y, mus: [...p.mus, honest.y] }
      expect(await pietrzakVerify(pulse, t, honest.y, extra, opts)).toBe(false)
      const badY = canonical(honest.y + 1n)
      expect(await pietrzakVerify(pulse, t, badY, { T: t, y: badY, mus: p.mus }, opts)).toBe(false)
      if (p.mus.length > 0) {
        const mus = p.mus.slice()
        mus[mus.length - 1] = canonical((mus.at(-1) as bigint) * 4n)
        expect(await pietrzakVerify(pulse, t, honest.y, { T: t, y: honest.y, mus }, opts)).toBe(
          false,
        )
      }
    }
  })

  test('an honest proof still verifies after the suite (no shared-state corruption)', async () => {
    expect(await pietrzakVerify(pulse, T, y, proof, opts)).toBe(true)
  })
})

describe('Jacobi membership check (QR_n^+ for Blum moduli)', () => {
  // w ≡ 1 (mod P), w ≡ −1 (mod Q): an order-2 element ≠ ±1, known only via the factors.
  const w = 1n + P * ((((Q - 2n) % Q) * modPow(P, Q - 2n, Q)) % Q)

  test('the twist w has order 2, differs from ±1, and has Jacobi symbol −1', () => {
    expect((w * w) % n).toBe(1n)
    expect(w === 1n || w === n - 1n).toBe(false)
    expect(modPow(w % Q, (Q - 1n) / 2n, Q)).toBe(Q - 1n)
    expect(modPow(w % P, (P - 1n) / 2n, P)).toBe(1n)
  })

  test('a twisted forgery that passes a range-only verifier is rejected', async () => {
    const oracle = (x: bigint, e: number): bigint => shortcutPower(x, e)
    let checked = 0
    for (const t of [3, 1000, 4096]) {
      for (let i = 0; i < 12; i++) {
        const input = new TextEncoder().encode(`twist-${i}`)
        const honest = await evaluate(input, t, opts)
        const forged = await forgeTwistedProof(input, t, honest.y, TEST_MODULUS, oracle, w)
        if (!forged.rawAccepts) continue
        expect(await pietrzakVerify(input, t, forged.proof.y, forged.proof, opts)).toBe(false)
        checked++
        break
      }
    }
    expect(checked).toBe(3)
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
