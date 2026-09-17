import { VdfError } from './errors.js'
import { challengeSync, hashToGroupSync } from './hash.js'
import { ceilHalf, modPow } from './internal/bigint.js'
import { isGroupElement, mulCanon } from './internal/group.js'
import { assertModulus, assertProofShape, assertT, toBytes } from './internal/validate.js'
import { RSA2048 } from './moduli.js'
import { pietrzakRounds } from './prove.js'
import type { PietrzakProof, RsaModulus } from './types.js'

export interface VerifyOptions {
  /** Group of unknown order to verify in. Default {@link RSA2048}. */
  modulus?: RsaModulus
}

/**
 * Verify a Pietrzak proof that $y = |x^{2^T}|$ in $QR_n^+$ for
 * $x = |H'(\mathrm{input})^2|$, in $O(\log T)$ modular exponentiations with
 * 128-bit exponents — versus the prover's $T$ sequential squarings.
 *
 * Every prover-supplied element ($y$ and each $\mu_i$) must be a canonical group
 * element: in $[1, (n-1)/2]$ with an admissible Jacobi symbol (see the README's
 * group section). This is what makes the output unique — the negation $n - y$ of
 * an honest output, or of any midpoint, is rejected outright. The verifier then
 * replays the halving transcript: for each $\mu_i$ it recomputes
 * $r_i = H(n, x_i, y_i, \mu_i, T_i)$ and folds
 *
 * $$x_{i+1} = |x_i^{r_i} \mu_i|, \qquad y_{i+1} = |\mu_i^{r_i} \hat{y}_i|,
 *   \qquad T_{i+1} = \lceil T_i / 2 \rceil$$
 *
 * ($\hat{y}_i = |y_i^2|$ when $T_i$ is odd), and accepts iff
 * $y_{\mathrm{final}} = |x_{\mathrm{final}}^2|$.
 *
 * Failure semantics: any *wrong* proof — tampered or non-canonical $y$ or
 * $\mu_i$, mismatched `proof.T`/`proof.y` against the `T`/`y` arguments, wrong
 * midpoint count, out-of-range elements (including the classic $\mu = 0$
 * forgery) — returns `false`, never throws. Only *malformed* arguments (wrong
 * types, invalid `T`, invalid modulus) throw `VdfError('invalid_input' |
 * 'invalid_modulus')`.
 *
 * @param input The seed bytes the evaluator hashed into the group.
 * @param T The claimed delay, integer in $[1, 2^{32} - 1]$.
 * @param y The claimed canonical output.
 * @param proof The halving proof; must restate the same `T` and `y`.
 */
export async function pietrzakVerify(
  input: Uint8Array | ArrayLike<number>,
  T: number,
  y: bigint,
  proof: PietrzakProof,
  opts: VerifyOptions = {},
): Promise<boolean> {
  const modulus = opts.modulus ?? RSA2048
  const n = assertModulus(modulus)
  assertT(T)
  const bytes = toBytes(input, 'input')
  if (typeof y !== 'bigint') {
    throw new VdfError('invalid_input', 'y must be a bigint')
  }
  assertProofShape(proof)

  if (proof.T !== T || proof.y !== y) return false
  if (proof.mus.length !== pietrzakRounds(T)) return false
  if (!isGroupElement(y, n)) return false
  for (const mu of proof.mus) {
    if (!isGroupElement(mu, n)) return false
  }

  let xi = hashToGroupSync(bytes, n)
  let yi = y
  let ti = T
  for (const mu of proof.mus) {
    const r = challengeSync(xi, yi, mu, ti, n)
    if ((ti & 1) === 1) yi = mulCanon(yi, yi, n)
    xi = mulCanon(modPow(xi, r, n), mu, n)
    yi = mulCanon(modPow(mu, r, n), yi, n)
    ti = ceilHalf(ti)
  }
  return yi === mulCanon(xi, xi, n)
}
