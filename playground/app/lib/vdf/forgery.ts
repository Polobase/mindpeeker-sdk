// The uniqueness break 0.2.0 closed, reconstructed from public exports.
//
// 0.1.0 verified Pietrzak proofs on raw representatives of Z_n^*, where −1 has
// order 2. A prover who claims the negated output n − y can therefore walk the
// sign out of the transcript and a range-only verifier accepts it: two
// "verified" outputs for one (input, T). This file rebuilds that attack with
// `hashToGroup` and `fiatShamirChallenge` — the shipped, modulus-bound v2
// hashes — plus a range-only verifier written HERE, for this page. It is not SDK
// code and never was: the shipped `pietrzakVerify` rejects every transcript it
// produces, which is what the section demonstrates.
//
// CLIENT/WORKER-ONLY: imports @mindpeeker/vdf.

import { fiatShamirChallenge, hashToGroup, type RsaModulus } from '@mindpeeker/vdf'
import type { RepairKind } from './jobs'

/** ⌈t/2⌉, the package's halving step. */
export function ceilHalf(t: number): number {
  return (t + 1) >> 1
}

/** Square-and-multiply, so this file needs nothing from the package internals. */
export function modPow(base: bigint, exponent: bigint, n: bigint): bigint {
  let result = 1n
  let b = ((base % n) + n) % n
  let e = exponent
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % n
    b = (b * b) % n
    e >>= 1n
  }
  return result
}

/** min(a, n − a) — the canonical representative of QR_n^+. */
export function canon(a: bigint, n: bigint): bigint {
  const r = ((a % n) + n) % n
  return r <= (n - 1n) >> 1n ? r : n - r
}

/** x^(2^e) mod n. The honest midpoint oracle a forger is allowed to use. */
function power(x: bigint, e: number, n: bigint): bigint {
  return modPow(x, 1n << BigInt(e), n)
}

export interface NegationForgery {
  /** The claimed output n − y. */
  readonly claim: bigint
  readonly mus: readonly bigint[]
  readonly rounds: number
  /** First round whose T_i is odd (1-based), or null when every T_i is even. */
  readonly oddRound: number | null
  readonly repairedBy: RepairKind
  readonly repairedAtRound: number | null
}

/**
 * Prove the negated claim n − y. The prover tracks the sign s of its claim
 * relative to the truth (y_i = s · x_i^(2^T_i), starting at s = −1):
 *
 * - an **odd** T_i squares the claim before folding, which squares the sign away
 *   (s → +1) — this is why every non-power-of-two T was forgeable with plain
 *   honest midpoints;
 * - an **even** T_i with s = −1 lets the prover send the negated midpoint n − μ,
 *   which re-randomises the challenge r; the fold then multiplies the sign by
 *   (−1)^r, so an odd r repairs it. Half the challenges are odd, so a power of
 *   two needs a couple of tries, not a break.
 *
 * Once s = +1 the rest of the transcript is an honest proof, so a verifier that
 * only range-checks elements accepts. `pietrzakVerify` never does: n − y is
 * outside [1, (n−1)/2].
 */
export async function forgeNegatedProof(
  input: Uint8Array,
  T: number,
  honestY: bigint,
  modulus: RsaModulus,
  tick?: () => Promise<void>,
): Promise<NegationForgery> {
  const { n } = modulus
  const claim = n - honestY
  let xi = await hashToGroup(input, modulus)
  let yi = claim
  let ti = T
  let sign = -1
  let round = 0
  let oddRound: number | null = null
  let repairedBy: RepairKind = 'none'
  let repairedAtRound: number | null = null
  const mus: bigint[] = []

  while (ti > 1) {
    round++
    const half = ceilHalf(ti)
    const odd = (ti & 1) === 1
    if (odd && oddRound === null) oddRound = round
    const honestMu = power(xi, half, n)
    let mu = honestMu
    let r = await fiatShamirChallenge(xi, yi, mu, ti, modulus)

    if (odd) {
      if (sign === -1) {
        repairedBy = 'odd-round'
        repairedAtRound = round
      }
      sign = 1
    } else if (sign === -1) {
      const flipped = n - honestMu
      const rFlipped = await fiatShamirChallenge(xi, yi, flipped, ti, modulus)
      if ((rFlipped & 1n) === 1n) {
        mu = flipped
        r = rFlipped
        sign = 1
        repairedBy = 'flipped-midpoint'
        repairedAtRound = round
      }
    }

    if (odd) yi = (yi * yi) % n
    xi = (modPow(xi, r, n) * mu) % n
    yi = (modPow(mu, r, n) * yi) % n
    mus.push(mu)
    ti = half
    if (tick) await tick()
  }

  return { claim, mus, rounds: round, oddRound, repairedBy, repairedAtRound }
}

/**
 * The 0.1.0 verifier, reimplemented here on raw Z_n^* representatives with the
 * shipped challenge function: range [1, n), raw folds, raw final comparison, no
 * canonicalisation and no Jacobi-symbol membership check.
 *
 * This is the page's own code, written to show what the shipped verifier no
 * longer does. Never use it for anything.
 */
export async function rangeOnlyVerify(
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

/**
 * What a sign-blind Wesolowski verifier would compute for the negated proof
 * element n − π: since ℓ is odd, (n − π)^ℓ ≡ −π^ℓ, so the product differs from y
 * by a sign only — `true` means a verifier that canonicalises the product but not
 * its inputs would have accepted a second proof. `wesolowskiVerify` rejects n − π
 * outright because it is outside [1, (n−1)/2].
 */
export function signBlindWesolowskiCheck(
  x: bigint,
  y: bigint,
  pi: bigint,
  ell: bigint,
  T: number,
  n: bigint,
): boolean {
  const negated = n - pi
  const r = modPow(2n, BigInt(T), ell)
  const product = (modPow(negated, ell, n) * modPow(x, r, n)) % n
  return canon(product, n) === y
}
