import { VdfError } from './errors.js'
import { hashToGroupSync, hashToPrimeSync } from './hash.js'
import { modPow } from './internal/bigint.js'
import { canon, isGroupElement, mulCanon } from './internal/group.js'
import { planQuotientPower, quotientPower } from './internal/quotient-power.js'
import {
  assertCanonicalClaim,
  assertCheckpoints,
  assertModulus,
  assertT,
  assertWesolowskiShape,
  toBytes,
} from './internal/validate.js'
import { Work } from './internal/work.js'
import { RSA2048 } from './moduli.js'
import type { ProveOptions } from './prove.js'
import type { WesolowskiProof } from './types.js'
import type { VerifyOptions } from './verify.js'

/**
 * Produce a Wesolowski proof for $y = |x^{2^T}|$ in $QR_n^+$ (Wesolowski,
 * *Efficient Verifiable Delay Functions*, EUROCRYPT 2019 / J. Cryptology 2020;
 * non-interactive via Fiat–Shamir): one group element instead of
 * $\lceil \log_2 T \rceil$ midpoints.
 *
 * With the challenge prime $\ell = \mathrm{hashToPrime}(x, y, T)$ (256 bits, see
 * `hashToPrime`), the proof is
 *
 * $$\pi = \big|x^{\lfloor 2^T/\ell \rfloor}\big| .$$
 *
 * Without checkpoints $\pi$ is computed by windowed long division in the exponent
 * ($T$ squarings + $T/8$ multiplications). With `checkpoints` from `evaluate` it is
 * a bucket multi-exponentiation over the stored powers — typically a fraction of
 * $T$ multiplications. Progress counts modular multiplications.
 *
 * Soundness rests on the *adaptive root assumption* in the group (Boneh–Bünz–Fisch,
 * eprint 2018/712): no efficient adversary, given a random prime $\ell$ after
 * committing to $u$, can output $w$ with $w^\ell = u \ne 1$. That is a stronger
 * assumption than Pietrzak's low-order assumption; in exchange the proof is
 * $w$ bytes and verification is two exponentiations.
 *
 * @param input The same seed bytes that were passed to `evaluate`.
 * @param T Number of sequential squarings, integer in $[1, 2^{32} - 1]$.
 * @param y The claimed canonical output, in $[1, (n-1)/2]$, else `VdfError('invalid_input')`.
 * @returns Frozen proof `{ T, y, pi }`.
 */
export async function wesolowskiProve(
  input: Uint8Array | ArrayLike<number>,
  T: number,
  y: bigint,
  opts: ProveOptions = {},
): Promise<WesolowskiProof> {
  const modulus = opts.modulus ?? RSA2048
  const n = assertModulus(modulus)
  assertT(T)
  const bytes = toBytes(input, 'input')
  assertCanonicalClaim(y, n)
  const { checkpoints } = opts
  if (checkpoints !== undefined) assertCheckpoints(checkpoints, T, n)
  const plan = planQuotientPower(T, checkpoints)
  const work = new Work(plan.units, opts.signal, opts.onProgress)
  work.throwIfAborted()
  const x = hashToGroupSync(bytes, n)
  if (checkpoints !== undefined && checkpoints.powers[0] !== x) {
    throw new VdfError('invalid_input', 'checkpoints belong to a different input or modulus')
  }
  const ell = hashToPrimeSync(x, y, T, n)
  const pi = canon(await quotientPower(x, T, ell, n, plan, work, checkpoints), n)
  work.finish()
  return Object.freeze({ T, y, pi })
}

/**
 * Verify a Wesolowski proof: with $\ell = \mathrm{hashToPrime}(x, y, T)$ and
 * $r = 2^T \bmod \ell$, accept iff
 *
 * $$\big|\pi^{\ell} \cdot x^{r}\big| = y ,$$
 *
 * which holds for the honest $\pi$ because $\ell \lfloor 2^T/\ell \rfloor + r = 2^T$.
 * Both $y$ and $\pi$ must be canonical group elements ($[1, (n-1)/2]$, admissible
 * Jacobi symbol): without that, $n - \pi$ would verify too
 * ($(-\pi)^\ell = -\pi^\ell$ for odd $\ell$) and the proof would not be unique.
 * Cost: two exponentiations (256-bit and $\le 256$-bit) plus one hash-to-prime.
 *
 * Failure semantics as for `pietrzakVerify`: wrong or non-canonical proofs return
 * `false`; only malformed arguments throw `VdfError('invalid_input' | 'invalid_modulus')`.
 */
export async function wesolowskiVerify(
  input: Uint8Array | ArrayLike<number>,
  T: number,
  y: bigint,
  proof: WesolowskiProof,
  opts: VerifyOptions = {},
): Promise<boolean> {
  const modulus = opts.modulus ?? RSA2048
  const n = assertModulus(modulus)
  assertT(T)
  const bytes = toBytes(input, 'input')
  if (typeof y !== 'bigint') throw new VdfError('invalid_input', 'y must be a bigint')
  assertWesolowskiShape(proof)
  if (proof.T !== T || proof.y !== y) return false
  if (!isGroupElement(y, n) || !isGroupElement(proof.pi, n)) return false
  const x = hashToGroupSync(bytes, n)
  const ell = hashToPrimeSync(x, y, T, n)
  const r = modPow(2n, BigInt(T), ell)
  return mulCanon(modPow(proof.pi, ell, n), modPow(x, r, n), n) === y
}
