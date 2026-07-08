import { VdfError } from './errors.js'
import { PROGRESS_INTERVAL } from './evaluate.js'
import { fiatShamirChallenge, hashToGroup } from './hash.js'
import { ceilHalf, modPow } from './internal/bigint.js'
import { sequentialSquare } from './internal/squaring.js'
import { assertModulus, assertT, toBytes } from './internal/validate.js'
import { RSA2048 } from './moduli.js'
import type { PietrzakProof, ProgressFn, RsaModulus } from './types.js'

export interface ProveOptions {
  /** Group of unknown order to work in. Default {@link RSA2048}. */
  modulus?: RsaModulus
  /** Cooperative cancellation of the midpoint squaring chains — `VdfError('aborted')`. */
  signal?: AbortSignal
  /**
   * Progress over the *total* midpoint squarings of all rounds
   * ($\sum_i \lceil T_i/2 \rceil \approx T$), every {@link PROGRESS_INTERVAL}
   * squarings and at completion.
   */
  onProgress?: ProgressFn
}

/**
 * Number of halving rounds a Pietrzak proof for delay $T$ contains:
 * repeated ceiling-halving $T \leftarrow \lceil T/2 \rceil$ until $T = 1$,
 * which is exactly $\lceil \log_2 T \rceil$ (0 rounds for $T = 1$).
 */
export function pietrzakRounds(T: number): number {
  assertT(T)
  let t = T
  let rounds = 0
  while (t > 1) {
    t = ceilHalf(t)
    rounds++
  }
  return rounds
}

/**
 * Produce a Pietrzak halving proof for the statement $y = x^{2^T} \bmod n$
 * with $x = H'(\mathrm{input})^2 \bmod n$ (Pietrzak, *Simple Verifiable Delay
 * Functions*, ITCS 2019, made non-interactive via Fiat–Shamir).
 *
 * Round $i$ starts from the claim $y_i = x_i^{2^{T_i}}$ and halves it:
 * with $t = \lceil T_i / 2 \rceil$ and midpoint $\mu_i = x_i^{2^{t}}$,
 * challenge $r_i = H(x_i, y_i, \mu_i, T_i)$,
 *
 * $$x_{i+1} = x_i^{r_i} \mu_i, \qquad
 *   y_{i+1} = \mu_i^{r_i} \hat{y}_i, \qquad T_{i+1} = t,$$
 *
 * where $\hat{y}_i = y_i^2$ if $T_i$ is odd and $\hat{y}_i = y_i$ otherwise
 * (the standard odd-$T$ handling, as in the Chia/POA implementations: an odd
 * claim $y_i = x_i^{2^{2t-1}}$ is squared once into the even claim
 * $y_i^2 = x_i^{2^{2t}}$, so the identity
 * $\mu_i^{r_i} \hat{y}_i = (x_i^{r_i}\mu_i)^{2^{t}}$ holds exactly).
 * Recursion ends at $T = 1$, where the verifier checks $y = x^2$ directly.
 *
 * Midpoint strategy: each $\mu_i$ is *recomputed* by $t$ sequential
 * squarings of the folded $x_i$, so proving costs $\approx T$ extra squarings
 * ($T/2 + T/4 + \dots$) and $O(1)$ memory. The alternative — checkpointing
 * $x^{2^k}$ powers during `evaluate` — trades $O(\sqrt{T})$ or $O(T/\log T)$
 * memory for near-zero recompute; for the tested range $T \le 2^{20}$ the
 * recompute cost (≈ one extra `evaluate`) is acceptable and keeps the API
 * stateless.
 *
 * The proof does not verify itself: passing a $y$ that is not the true VDF
 * output yields a proof that `pietrzakVerify` rejects.
 *
 * @param input The same seed bytes that were passed to `evaluate`.
 * @param T Number of sequential squarings, integer in $[1, 2^{32} - 1]$.
 * @param y The claimed output $x^{2^T} \bmod n$, in $[1, n)$.
 * @returns Frozen proof `{ T, y, mus }` with $\lceil \log_2 T \rceil$ midpoints.
 */
export async function pietrzakProve(
  input: Uint8Array | ArrayLike<number>,
  T: number,
  y: bigint,
  opts: ProveOptions = {},
): Promise<PietrzakProof> {
  const modulus = opts.modulus ?? RSA2048
  const n = assertModulus(modulus)
  assertT(T)
  const bytes = toBytes(input, 'input')
  if (typeof y !== 'bigint' || y < 1n || y >= n) {
    throw new VdfError('invalid_input', 'y must be a bigint in [1, n)')
  }
  const { signal, onProgress } = opts

  let totalSquarings = 0
  {
    let t = T
    while (t > 1) {
      const half = ceilHalf(t)
      totalSquarings += half
      t = half
    }
  }

  let xi = await hashToGroup(bytes, modulus)
  let yi = y
  let ti = T
  let done = 0
  const mus: bigint[] = []
  while (ti > 1) {
    const half = ceilHalf(ti)
    const offset = done
    const mu = await sequentialSquare(xi, half, n, {
      signal,
      interval: PROGRESS_INTERVAL,
      onStep: onProgress === undefined ? undefined : (d) => onProgress(offset + d, totalSquarings),
    })
    done += half
    const r = await fiatShamirChallenge(xi, yi, mu, ti, modulus)
    if ((ti & 1) === 1) yi = (yi * yi) % n
    xi = (modPow(xi, r, n) * mu) % n
    yi = (modPow(mu, r, n) * yi) % n
    ti = half
    mus.push(mu)
  }
  onProgress?.(totalSquarings, totalSquarings)
  return Object.freeze({ T, y, mus: Object.freeze(mus) })
}
