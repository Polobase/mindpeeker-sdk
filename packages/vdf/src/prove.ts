import { VdfError } from './errors.js'
import { challengeSync, hashToGroupSync } from './hash.js'
import { ceilHalf, modPow } from './internal/bigint.js'
import { canon, mulCanon } from './internal/group.js'
import { checkpointOffset, planPietrzak } from './internal/plan.js'
import { sequentialSquare } from './internal/squaring.js'
import {
  assertCanonicalClaim,
  assertCheckpoints,
  assertModulus,
  assertT,
  toBytes,
} from './internal/validate.js'
import { Work } from './internal/work.js'
import { RSA2048 } from './moduli.js'
import type { PietrzakProof, ProgressFn, RsaModulus, VdfCheckpoints } from './types.js'

export interface ProveOptions {
  /** Group of unknown order to work in. Default {@link RSA2048}. */
  modulus?: RsaModulus
  /** Cooperative cancellation of the proving computation — `VdfError('aborted')`. */
  signal?: AbortSignal
  /**
   * Progress over the proving work: sequential squarings for Pietrzak (total
   * {@link pietrzakProveCost}), modular multiplications for Wesolowski. Called
   * roughly every 1024 units and exactly once with `done === total`.
   */
  onProgress?: ProgressFn
  /**
   * Stored powers from `evaluate(input, T, { checkpoints: k })`. Midpoints are
   * then recombined from nearby checkpoints instead of being recomputed — same
   * proof bytes, far fewer squarings. Must belong to the same input, $T$, and
   * modulus, else `VdfError('invalid_input')`.
   */
  checkpoints?: VdfCheckpoints
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
 * Exact number of sequential squarings `pietrzakProve` performs for delay $T$:
 * $\sum_i \lceil T_i/2 \rceil \approx T$ without checkpoints, and typically a
 * small fraction of $T$ with checkpoints every `checkpointInterval` squarings
 * (the deterministic plan described at {@link pietrzakProve}). This is the
 * `total` its progress callback reports.
 */
export function pietrzakProveCost(T: number, checkpointInterval?: number): number {
  assertT(T)
  if (
    checkpointInterval !== undefined &&
    (!Number.isInteger(checkpointInterval) || checkpointInterval < 1 || checkpointInterval > T)
  ) {
    throw new VdfError('invalid_input', `checkpointInterval must be an integer in [1, ${T}]`)
  }
  let total = 0
  for (const round of planPietrzak(T, checkpointInterval)) total += round.squarings
  return total
}

/**
 * Produce a Pietrzak halving proof for the statement $y = |x^{2^T}|$ in $QR_n^+$
 * with $x = |H'(\mathrm{input})^2|$ (Pietrzak, *Simple Verifiable Delay
 * Functions*, ITCS 2019, made non-interactive via Fiat–Shamir).
 *
 * Round $i$ starts from the claim $y_i = x_i^{2^{T_i}}$ and halves it: with
 * $t = \lceil T_i / 2 \rceil$ and midpoint $\mu_i = |x_i^{2^{t}}|$, challenge
 * $r_i = H(n, x_i, y_i, \mu_i, T_i)$,
 *
 * $$x_{i+1} = |x_i^{r_i} \mu_i|, \qquad y_{i+1} = |\mu_i^{r_i} \hat{y}_i|,
 *   \qquad T_{i+1} = t,$$
 *
 * where $\hat{y}_i = |y_i^2|$ if $T_i$ is odd and $\hat{y}_i = y_i$ otherwise (an
 * odd claim $x_i^{2^{2t-1}}$ is squared once into the even claim $x_i^{2^{2t}}$).
 * Recursion ends at $T = 1$, where the verifier checks $y = |x^2|$ directly.
 *
 * Midpoints: without checkpoints each $\mu_i$ is recomputed by $t$ sequential
 * squarings of $x_i$ ($\approx T$ extra squarings, $O(1)$ memory). With
 * checkpoints from `evaluate` the early rounds — where $t$ is large — are
 * recombined from stored powers (see `pietrzakProveCost`), which removes most of
 * that work. Both paths produce identical proofs.
 *
 * The proof does not verify itself: a canonical $y$ that is not the true output
 * yields a proof that `pietrzakVerify` rejects.
 *
 * @param input The same seed bytes that were passed to `evaluate`.
 * @param T Number of sequential squarings, integer in $[1, 2^{32} - 1]$.
 * @param y The claimed canonical output, in $[1, (n-1)/2]$ — anything else
 *   (including the negation $n - y$) throws `VdfError('invalid_input')`.
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
  assertCanonicalClaim(y, n)
  const { checkpoints } = opts
  if (checkpoints !== undefined) assertCheckpoints(checkpoints, T, n)
  const plan = planPietrzak(T, checkpoints?.interval)
  let total = 0
  for (const round of plan) total += round.squarings
  const work = new Work(total, opts.signal, opts.onProgress)
  work.throwIfAborted()

  const x = hashToGroupSync(bytes, n)
  if (checkpoints !== undefined && checkpoints.powers[0] !== x) {
    throw new VdfError('invalid_input', 'checkpoints belong to a different input or modulus')
  }
  const halves: number[] = []
  const challenges: bigint[] = []
  let xi = x
  let yi = y
  const mus: bigint[] = []
  for (const round of plan) {
    let mu: bigint
    if (round.fromCheckpoints && checkpoints !== undefined) {
      mu = canon(
        await unfold(halves.length, round.half, checkpoints, halves, challenges, n, work),
        n,
      )
    } else {
      mu = canon(await sequentialSquare(xi, round.half, n, work), n)
    }
    const r = challengeSync(xi, yi, mu, round.T, n)
    if ((round.T & 1) === 1) yi = mulCanon(yi, yi, n)
    xi = mulCanon(modPow(xi, r, n), mu, n)
    yi = mulCanon(modPow(mu, r, n), yi, n)
    halves.push(round.half)
    challenges.push(r)
    mus.push(mu)
  }
  work.finish()
  return Object.freeze({ T, y, mus: Object.freeze(mus) })
}

/**
 * $x_{level}^{2^e}$ (up to sign) from checkpoints via
 * $x_k^{2^e} = (x_{k-1}^{2^e})^{r_{k-1}} \cdot x_{k-1}^{2^{e + t_{k-1}}}$, bottoming
 * out at $x_0^{2^e}$ = a stored power squared `checkpointOffset(e)` more times.
 */
async function unfold(
  level: number,
  e: number,
  checkpoints: VdfCheckpoints,
  halves: readonly number[],
  challenges: readonly bigint[],
  n: bigint,
  work: Work,
): Promise<bigint> {
  if (level === 0) {
    const { interval, powers } = checkpoints
    const offset = checkpointOffset(e, interval, powers.length - 1)
    const base = powers[(e - offset) / interval] as bigint
    return sequentialSquare(base, offset, n, work)
  }
  const r = challenges[level - 1] as bigint
  const t = halves[level - 1] as number
  const low = await unfold(level - 1, e, checkpoints, halves, challenges, n, work)
  const high = await unfold(level - 1, e + t, checkpoints, halves, challenges, n, work)
  return (modPow(low, r, n) * high) % n
}
