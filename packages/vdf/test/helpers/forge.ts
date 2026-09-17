import { fiatShamirChallenge, hashToGroup } from '../../src/hash.js'
import { ceilHalf, modPow } from '../../src/internal/bigint.js'
import type { PietrzakProof, RsaModulus } from '../../src/types.js'

/** `x^(2^e) mod n` — the honest midpoint oracle a forger is allowed to use. */
export type PowerOracle = (x: bigint, e: number) => bigint

/** Plain square-and-multiply midpoint oracle (fine for small e on any modulus). */
export function squaringOracle(modulus: RsaModulus): PowerOracle {
  return (x, e) => modPow(x, 2n ** BigInt(e), modulus.n)
}

export interface Forgery {
  readonly proof: PietrzakProof
  /** Whether a sign-blind (raw Z_n*) verifier — the 0.1.0 logic — accepts the forgery. */
  readonly rawAccepts: boolean
}

/**
 * The 0.1.0 verifier, reimplemented on raw $\mathbb{Z}_n^\times$ representatives with the
 * production challenge function: range $[1, n)$, raw folds, raw final comparison.
 */
export async function rawVerify(
  input: Uint8Array,
  T: number,
  y: bigint,
  mus: readonly bigint[],
  modulus: RsaModulus,
): Promise<boolean> {
  const { n } = modulus
  if (y < 1n || y >= n) return false
  let xi = await hashToGroup(input, modulus)
  let yi = y
  let ti = T
  for (const mu of mus) {
    if (mu < 1n || mu >= n) return false
    const r = await fiatShamirChallenge(xi, yi, mu, ti, modulus)
    if ((ti & 1) === 1) yi = (yi * yi) % n
    xi = (modPow(xi, r, n) * mu) % n
    yi = (modPow(mu, r, n) * yi) % n
    ti = ceilHalf(ti)
  }
  return ti === 1 && yi === (xi * xi) % n
}

const canon = (a: bigint, n: bigint): bigint => (a <= (n - 1n) >> 1n ? a : n - a)

/**
 * A verifier identical to production except that it skips the Jacobi-symbol
 * membership check: canonical range, canonical folds, canonical final comparison.
 */
export async function canonicalVerifyWithoutJacobi(
  input: Uint8Array,
  T: number,
  y: bigint,
  mus: readonly bigint[],
  modulus: RsaModulus,
): Promise<boolean> {
  const { n } = modulus
  const half = (n - 1n) >> 1n
  if (y < 1n || y > half || mus.some((mu) => mu < 1n || mu > half)) return false
  let xi = await hashToGroup(input, modulus)
  let yi = y
  let ti = T
  for (const mu of mus) {
    const r = await fiatShamirChallenge(xi, yi, mu, ti, modulus)
    if ((ti & 1) === 1) yi = canon((yi * yi) % n, n)
    xi = canon((modPow(xi, r, n) * mu) % n, n)
    yi = canon((modPow(mu, r, n) * yi) % n, n)
    ti = ceilHalf(ti)
  }
  return ti === 1 && yi === canon((xi * xi) % n, n)
}

/**
 * The sign-choice attack of {@link forgeNegatedProof}, run in canonical arithmetic
 * with an order-2 element `twist` $w \ne \pm 1$ instead of $-1$ (constructible only
 * from the factorization). Claims $|w y|$; returns whether a verifier without the
 * Jacobi check accepts.
 */
export async function forgeTwistedProof(
  input: Uint8Array,
  T: number,
  honestY: bigint,
  modulus: RsaModulus,
  power: PowerOracle,
  twist: bigint,
): Promise<Forgery> {
  const { n } = modulus
  const claim = canon((twist * honestY) % n, n)
  let xi = await hashToGroup(input, modulus)
  let yi = claim
  let ti = T
  let twisted = true
  const mus: bigint[] = []
  while (ti > 1) {
    const half = ceilHalf(ti)
    const honestMu = canon(power(xi, half), n)
    let mu = honestMu
    let r = await fiatShamirChallenge(xi, yi, mu, ti, modulus)
    if ((ti & 1) === 1) {
      twisted = false
    } else if (twisted) {
      const alt = canon((twist * honestMu) % n, n)
      const rAlt = await fiatShamirChallenge(xi, yi, alt, ti, modulus)
      if ((rAlt & 1n) === 1n) {
        mu = alt
        r = rAlt
        twisted = false
      }
    }
    if ((ti & 1) === 1) yi = canon((yi * yi) % n, n)
    xi = canon((modPow(xi, r, n) * mu) % n, n)
    yi = canon((modPow(mu, r, n) * yi) % n, n)
    mus.push(mu)
    ti = half
  }
  const proof: PietrzakProof = { T, y: claim, mus }
  return {
    proof,
    rawAccepts: await canonicalVerifyWithoutJacobi(input, T, claim, mus, modulus),
  }
}

/**
 * Adversarial prover for the negated output $-y = n - y$ (audit finding: uniqueness
 * break). It tracks the sign $s_i$ of its claim relative to the truth. An odd round
 * squares the sign away ($s \to +1$); in an even round with $s = -1$ it sends the
 * negated midpoint $n - \mu$, which re-randomises the challenge and flips the sign
 * whenever the fresh $r$ is odd. A sign-blind verifier accepts iff the final sign is $+1$.
 */
export async function forgeNegatedProof(
  input: Uint8Array,
  T: number,
  honestY: bigint,
  modulus: RsaModulus,
  power: PowerOracle,
): Promise<Forgery> {
  const { n } = modulus
  const claim = n - honestY
  let xi = await hashToGroup(input, modulus)
  let yi = claim
  let ti = T
  let sign = -1
  const mus: bigint[] = []
  while (ti > 1) {
    const half = ceilHalf(ti)
    const honestMu = power(xi, half)
    let mu = honestMu
    let r = await fiatShamirChallenge(xi, yi, mu, ti, modulus)
    if ((ti & 1) === 1) {
      sign = 1
    } else if (sign === -1) {
      const flipped = n - honestMu
      const rFlipped = await fiatShamirChallenge(xi, yi, flipped, ti, modulus)
      if ((rFlipped & 1n) === 1n) {
        mu = flipped
        r = rFlipped
        sign = 1
      }
    }
    if ((ti & 1) === 1) yi = (yi * yi) % n
    xi = (modPow(xi, r, n) * mu) % n
    yi = (modPow(mu, r, n) * yi) % n
    mus.push(mu)
    ti = half
  }
  const proof: PietrzakProof = { T, y: claim, mus }
  return { proof, rawAccepts: await rawVerify(input, T, claim, mus, modulus) }
}
