import { describe, expect, test } from 'bun:test'
import { evaluate } from '../src/evaluate.js'
import { hashToGroup, hashToPrime } from '../src/hash.js'
import { modPow } from '../src/internal/bigint.js'
import { RSA2048 } from '../src/moduli.js'
import type { WesolowskiProof } from '../src/types.js'
import { wesolowskiProve, wesolowskiVerify } from '../src/wesolowski.js'
import { expectVdfError } from './helpers/expect.js'
import { fromHex, loadFixture } from './helpers/fixture.js'
import { canonical, P, Q, TEST_MODULUS } from './helpers/test-modulus.js'

const fixture = loadFixture()
const pulse = new TextEncoder().encode('pulse-1')
const opts = { modulus: TEST_MODULUS }
const n = TEST_MODULUS.n

const T = 1000
const { x, y } = await evaluate(pulse, T, opts)
const proof = await wesolowskiProve(pulse, T, y, opts)

/** Closed form π = |x^⌊2^T/ℓ⌋| with an exact BigInt quotient — independent of the provers. */
async function closedFormPi(input: Uint8Array, t: number, claim: bigint): Promise<bigint> {
  const base = await hashToGroup(input, TEST_MODULUS)
  const ell = await hashToPrime(base, claim, t, TEST_MODULUS)
  return canonical(modPow(base, (1n << BigInt(t)) / ell, n))
}

describe('wesolowskiProve', () => {
  test('reproduces the independent Python proofs (test modulus, RSA-2048, 522-bit)', async () => {
    for (const c of fixture.wesolowski) {
      const got = await wesolowskiProve(fromHex(c.inputHex), c.T, BigInt(c.y), opts)
      expect(got.pi.toString()).toBe(c.pi)
    }
    const rsa = fixture.rsa2048.wesolowski
    expect((await wesolowskiProve(fromHex(rsa.inputHex), rsa.T, BigInt(rsa.y))).pi.toString()).toBe(
      rsa.pi,
    )
    const odd = fixture.oddWidth.wesolowski
    const oddOpts = { modulus: { n: BigInt(fixture.oddWidth.n) } }
    const oddProof = await wesolowskiProve(fromHex(odd.inputHex), odd.T, BigInt(odd.y), oddOpts)
    expect(oddProof.pi.toString()).toBe(odd.pi)
    expect(
      await wesolowskiVerify(fromHex(odd.inputHex), odd.T, BigInt(odd.y), oddProof, oddOpts),
    ).toBe(true)
  })

  test('long division equals the closed form for odd, even, and window-aligned T', async () => {
    for (const t of [1, 2, 7, 8, 9, 255, 256, 1025, 4096]) {
      const e = await evaluate(pulse, t, opts)
      const p = await wesolowskiProve(pulse, t, e.y, opts)
      expect(p.pi).toBe(await closedFormPi(pulse, t, e.y))
      expect(Object.isFrozen(p)).toBe(true)
    }
  })

  test('checkpoint (bucket) prover gives the same π with a single completion event', async () => {
    for (const [t, k] of [
      [9, 3],
      [100, 10],
      [1000, 32],
      [1024, 32],
      [4097, 64],
      [5000, 5000],
    ] as const) {
      const e = await evaluate(pulse, t, { ...opts, checkpoints: k })
      const calls: [number, number][] = []
      const p = await wesolowskiProve(pulse, t, e.y, {
        ...opts,
        checkpoints: e.checkpoints,
        onProgress: (d, total) => calls.push([d, total]),
      })
      expect(p.pi).toBe(await closedFormPi(pulse, t, e.y))
      expect(calls.filter(([d, total]) => d === total)).toHaveLength(1)
      const [lastDone, lastTotal] = calls.at(-1) as [number, number]
      expect(lastDone).toBe(lastTotal)
    }
  })

  test('aborts: pre-aborted and mid-computation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expectVdfError(
      wesolowskiProve(pulse, T, y, { ...opts, signal: controller.signal }),
      'aborted',
    )
    const e = await evaluate(pulse, 20_000, opts)
    const live = new AbortController()
    await expectVdfError(
      wesolowskiProve(pulse, 20_000, e.y, {
        ...opts,
        signal: live.signal,
        onProgress: () => live.abort(),
      }),
      'aborted',
    )
  })

  test('rejects non-canonical claims and malformed arguments', async () => {
    await expectVdfError(wesolowskiProve(pulse, T, n - y, opts), 'invalid_input')
    await expectVdfError(wesolowskiProve(pulse, T, 0n, opts), 'invalid_input')
    await expectVdfError(wesolowskiProve(pulse, 0, y, opts), 'invalid_input')
    await expectVdfError(wesolowskiProve(pulse, T, y, { modulus: { n: 9n } }), 'invalid_modulus')
    const other = await evaluate(new TextEncoder().encode('other'), T, { ...opts, checkpoints: 10 })
    await expectVdfError(
      wesolowskiProve(pulse, T, y, { ...opts, checkpoints: other.checkpoints }),
      'invalid_input',
    )
  })
})

describe('wesolowskiVerify — soundness against simple forgeries', () => {
  test('accepts the honest proof (test modulus and RSA-2048)', async () => {
    expect(await wesolowskiVerify(pulse, T, y, proof, opts)).toBe(true)
    const rsa = await evaluate(pulse, 300)
    const rsaProof = await wesolowskiProve(pulse, 300, rsa.y)
    expect(await wesolowskiVerify(pulse, 300, rsa.y, rsaProof)).toBe(true)
    const negated = RSA2048.n - rsa.y
    expect(await wesolowskiVerify(pulse, 300, negated, { ...rsaProof, y: negated })).toBe(false)
    expect(
      await wesolowskiVerify(pulse, 300, rsa.y, { ...rsaProof, pi: RSA2048.n - rsaProof.pi }),
    ).toBe(false)
  })

  test('negation: n − y and n − π are rejected', async () => {
    expect(await wesolowskiVerify(pulse, T, n - y, { T, y: n - y, pi: proof.pi }, opts)).toBe(false)
    // (n − π)^ℓ = −π^ℓ for odd ℓ, so a sign-blind verifier would accept this one.
    expect(await wesolowskiVerify(pulse, T, y, { T, y, pi: n - proof.pi }, opts)).toBe(false)
  })

  test('tampered π, y, T, input, and trivial elements are rejected', async () => {
    const reject = async (input: Uint8Array, t: number, claim: bigint, pi: bigint) =>
      expect(await wesolowskiVerify(input, t, claim, { T: t, y: claim, pi }, opts)).toBe(false)
    await reject(pulse, T, y, proof.pi ^ 1n)
    await reject(pulse, T, y, canonical(proof.pi * x))
    await reject(pulse, T, y, 1n)
    await reject(pulse, T, y, 0n)
    await reject(pulse, T, canonical(y + 1n), proof.pi)
    await reject(pulse, T + 1, y, proof.pi)
    const tampered = Uint8Array.from(pulse)
    tampered[0] = (tampered[0] as number) ^ 1
    await reject(tampered, T, y, proof.pi)
    // Mismatched restatement.
    expect(await wesolowskiVerify(pulse, T, y, { T: T + 1, y, pi: proof.pi }, opts)).toBe(false)
  })

  test('a proof for a wrong y, even one made with the correct challenge prime, fails', async () => {
    const wrongY = canonical(y * 4n)
    const forged = await wesolowskiProve(pulse, T, wrongY, opts)
    expect(await wesolowskiVerify(pulse, T, wrongY, forged, opts)).toBe(false)
  })

  test('an order-2 twist that fools a range-only verifier is caught by the Jacobi check', async () => {
    const w = 1n + P * ((((Q - 2n) % Q) * modPow(P, Q - 2n, Q)) % Q)
    const claim = canonical(w * y)
    const ell = await hashToPrime(x, claim, T, TEST_MODULUS)
    const pi = canonical(w * modPow(x, (1n << BigInt(T)) / ell, n))
    // Without membership checks the twisted pair satisfies the verification equation…
    const r = modPow(2n, BigInt(T), ell)
    expect(canonical(modPow(pi, ell, n) * modPow(x, r, n))).toBe(claim)
    // …but the verifier rejects it.
    expect(await wesolowskiVerify(pulse, T, claim, { T, y: claim, pi }, opts)).toBe(false)
  })

  test('malformed arguments throw', async () => {
    await expectVdfError(
      wesolowskiVerify(pulse, T, y, { T, y } as unknown as WesolowskiProof, opts),
      'invalid_input',
    )
    await expectVdfError(
      wesolowskiVerify(pulse, T, '1' as unknown as bigint, proof, opts),
      'invalid_input',
    )
    await expectVdfError(wesolowskiVerify(pulse, 0, y, proof, opts), 'invalid_input')
  })
})
