import { describe, expect, test } from 'bun:test'
import { sealBeacon, verifySeal } from '../src/beacon.js'
import { evaluate } from '../src/evaluate.js'
import { RSA2048 } from '../src/moduli.js'
import { pietrzakProve } from '../src/prove.js'
import { pietrzakVerify } from '../src/verify.js'
import { expectVdfError } from './helpers/expect.js'
import { forgeNegatedProof, squaringOracle } from './helpers/forge.js'
import { shortcutPower, TEST_MODULUS } from './helpers/test-modulus.js'

/**
 * Regression suite for the verified 0.1.0 uniqueness break: the verifier accepted
 * $n - y$ (the element $-1 \cdot y$, $-1$ of order 2) with an adversarially
 * re-derived proof. VDF uniqueness (Boneh–Bonneau–Bünz–Fisch, CRYPTO 2018) requires
 * exactly one accepted output per (input, T).
 */
const opts = { modulus: TEST_MODULUS }
const n = TEST_MODULUS.n
const oracle = (x: bigint, e: number): bigint => shortcutPower(x, e)
const encoder = new TextEncoder()

describe('negated output n − y is rejected (TEST_MODULUS)', () => {
  for (const T of [3, 5, 6, 7, 1000]) {
    test(`non-power-of-two T=${T}: forged proof for n − y verifies false`, async () => {
      const pulse = encoder.encode('pulse-1')
      const { y } = await evaluate(pulse, T, opts)
      const forged = await forgeNegatedProof(pulse, T, y, TEST_MODULUS, oracle)
      // The forgery is real: a sign-blind verifier (0.1.0 logic) accepts it.
      expect(forged.rawAccepts).toBe(true)
      expect(n - y).not.toBe(y)
      expect(await pietrzakVerify(pulse, T, n - y, forged.proof, opts)).toBe(false)
      // The honest output still verifies.
      const honest = await pietrzakProve(pulse, T, y, opts)
      expect(await pietrzakVerify(pulse, T, y, honest, opts)).toBe(true)
    })
  }

  for (const T of [4, 8, 16, 256, 4096]) {
    test(`power-of-two T=${T}: sign-flipped midpoints for n − y verify false`, async () => {
      let found = false
      for (let i = 0; i < 12 && !found; i++) {
        const pulse = encoder.encode(`input-${i}`)
        const { y } = await evaluate(pulse, T, opts)
        const forged = await forgeNegatedProof(pulse, T, y, TEST_MODULUS, oracle)
        if (!forged.rawAccepts) continue
        found = true
        expect(await pietrzakVerify(pulse, T, n - y, forged.proof, opts)).toBe(false)
      }
      expect(found).toBe(true)
    })
  }

  test('the honest prover refuses a non-canonical claim n − y', async () => {
    const pulse = encoder.encode('pulse-1')
    const { y } = await evaluate(pulse, 1000, opts)
    await expectVdfError(pietrzakProve(pulse, 1000, n - y, opts), 'invalid_input')
  })

  test('negating any single midpoint of an honest proof verifies false', async () => {
    const pulse = encoder.encode('pulse-1')
    for (const T of [4, 1000]) {
      const { y } = await evaluate(pulse, T, opts)
      const proof = await pietrzakProve(pulse, T, y, opts)
      for (let i = 0; i < proof.mus.length; i++) {
        const mus = proof.mus.slice()
        mus[i] = n - (mus[i] as bigint)
        expect(await pietrzakVerify(pulse, T, y, { T, y, mus }, opts)).toBe(false)
      }
    }
  })

  test('verifySeal rejects a seal whose y was negated and re-proved', async () => {
    const pulse = encoder.encode('nist-pulse 2026-07-08T12:00:00Z')
    const seal = await sealBeacon(pulse, 1000, opts)
    const forged = await forgeNegatedProof(pulse, 1000, seal.y, TEST_MODULUS, oracle)
    expect(forged.rawAccepts).toBe(true)
    const negated = { T: 1000, y: n - seal.y, proof: forged.proof }
    expect(await verifySeal(pulse, negated, opts)).toBe(false)
    expect(await verifySeal(pulse, seal, opts)).toBe(true)
  })
})

describe('negated output n − y is rejected (RSA-2048)', () => {
  const pulse = encoder.encode('pulse-1')
  const rsaOracle = squaringOracle(RSA2048)
  for (const T of [255, 256]) {
    test(`T=${T}: honest round-trip verifies, negated seal does not`, async () => {
      const seal = await sealBeacon(pulse, T)
      expect(await verifySeal(pulse, seal)).toBe(true)
      let forged = await forgeNegatedProof(pulse, T, seal.y, RSA2048, rsaOracle)
      let input = pulse
      let y = seal.y
      for (let i = 0; !forged.rawAccepts && i < 8; i++) {
        input = encoder.encode(`rsa-input-${i}`)
        y = (await evaluate(input, T)).y
        forged = await forgeNegatedProof(input, T, y, RSA2048, rsaOracle)
      }
      expect(forged.rawAccepts).toBe(true)
      expect(await pietrzakVerify(input, T, RSA2048.n - y, forged.proof)).toBe(false)
      expect(await verifySeal(input, { T, y: RSA2048.n - y, proof: forged.proof })).toBe(false)
    })
  }
})
