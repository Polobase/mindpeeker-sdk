import { VdfError } from './errors.js'
import { fiatShamirChallenge, hashToGroup } from './hash.js'
import { ceilHalf, modPow } from './internal/bigint.js'
import { assertModulus, assertProofShape, assertT, toBytes } from './internal/validate.js'
import { RSA2048 } from './moduli.js'
import { pietrzakRounds } from './prove.js'
import type { PietrzakProof, RsaModulus } from './types.js'

export interface VerifyOptions {
  /** Group of unknown order to verify in. Default {@link RSA2048}. */
  modulus?: RsaModulus
}

/**
 * Verify a Pietrzak proof that $y = x^{2^T} \bmod n$ for
 * $x = H'(\mathrm{input})^2 \bmod n$, in $O(\log T)$ modular exponentiations
 * with 128-bit exponents — versus the prover's $T$ sequential squarings.
 *
 * The verifier replays the halving transcript: for each midpoint $\mu_i$ it
 * recomputes $r_i = H(x_i, y_i, \mu_i, T_i)$ and folds
 *
 * $$x_{i+1} = x_i^{r_i} \mu_i, \qquad y_{i+1} = \mu_i^{r_i} \hat{y}_i,
 *   \qquad T_{i+1} = \lceil T_i / 2 \rceil$$
 *
 * ($\hat{y}_i = y_i^2$ when $T_i$ is odd), then accepts iff the final claim
 * holds: $y_{\mathrm{final}} = x_{\mathrm{final}}^2 \bmod n$.
 *
 * Failure semantics: any *wrong* proof — tampered $y$ or $\mu_i$, mismatched
 * `proof.T`/`proof.y` against the `T`/`y` arguments, wrong midpoint count,
 * out-of-range elements (including the classic $\mu = 0$ forgery, which would
 * otherwise collapse both folds to $0$ and pass the final check) — returns
 * `false`, never throws. Only *malformed* arguments (wrong types, invalid
 * `T`, invalid modulus) throw `VdfError('invalid_input' | 'invalid_modulus')`.
 *
 * @param input The seed bytes the evaluator hashed into the group.
 * @param T The claimed delay, integer in $[1, 2^{32} - 1]$.
 * @param y The claimed output.
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
  if (y < 1n || y >= n) return false
  if (proof.mus.length !== pietrzakRounds(T)) return false
  for (const mu of proof.mus) {
    if (mu < 1n || mu >= n) return false
  }

  let xi = await hashToGroup(bytes, modulus)
  let yi = y
  let ti = T
  for (const mu of proof.mus) {
    const r = await fiatShamirChallenge(xi, yi, mu, ti, modulus)
    if ((ti & 1) === 1) yi = (yi * yi) % n
    xi = (modPow(xi, r, n) * mu) % n
    yi = (modPow(mu, r, n) * yi) % n
    ti = ceilHalf(ti)
  }
  return yi === (xi * xi) % n
}
