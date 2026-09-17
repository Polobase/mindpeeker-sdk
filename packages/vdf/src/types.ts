/**
 * An RSA group of unknown order, given by its modulus $n = pq$.
 *
 * The VDF works in the **signed quadratic residues** $QR_n^+$: every element is
 * the canonical representative $|a| = \min(a, n - a) \in [1, (n-1)/2]$ of a
 * square, and the group operation is $|a \cdot b \bmod n|$ (Hofheinz–Kiltz 2009,
 * as used by Pietrzak, ITCS 2019). Canonicalisation identifies $a$ with $-a$, so
 * the order-2 element $-1$ disappears and every $(\mathrm{input}, T)$ has exactly
 * one acceptable output. For a product of two safe primes $QR_n^+$ has odd order
 * and no low-order elements; for moduli with unknown factor structure (RSA-2048)
 * the residual assumption is that nobody can find a low-order element, which
 * Seres–Burcsi (eprint 2020/402) relate to factoring for a non-negligible portion
 * of moduli.
 *
 * This is the pluggable seam of the package: every function accepts a
 * `{ n: bigint }` and defaults to {@link RSA2048}. Sequentiality of
 * $x \mapsto x^{2^T}$ rests on the group order being unknown — anyone who knows
 * $p, q$ evaluates in $O(\log T)$ time via $2^T \bmod \varphi(n)$
 * (Rivest–Shamir–Wagner, *Time-lock puzzles and timed-release crypto*, 1996).
 * Use `checkModulus` to reject obviously broken custom moduli.
 */
export interface RsaModulus {
  /** The modulus $n$; must be odd and should be a product of two large safe primes. */
  readonly n: bigint
}

/**
 * Powers of $x$ stored by `evaluate(..., { checkpoints })` so the provers can
 * derive midpoints without re-running the squaring chain.
 */
export interface VdfCheckpoints {
  /** The delay the checkpoints were computed for. */
  readonly T: number
  /** Squarings between stored powers, $\lceil T / k \rceil$ for `checkpoints: k`. */
  readonly interval: number
  /** `powers[j]` $= |x^{2^{j \cdot \mathrm{interval}}}|$ for $j = 0 \dots \lfloor T/\mathrm{interval} \rfloor$. */
  readonly powers: readonly bigint[]
}

/**
 * Result of `evaluate`: the canonical group element $x = |H'(\mathrm{input})^2|$
 * and the VDF output $y = |x^{2^T}|$ after $T$ sequential squarings, plus the
 * stored powers when checkpoints were requested.
 */
export interface VdfEvaluation {
  readonly x: bigint
  readonly y: bigint
  readonly checkpoints?: VdfCheckpoints
}

/**
 * A Pietrzak halving proof for the statement $y = |x^{2^T}|$ in $QR_n^+$
 * (Pietrzak, *Simple Verifiable Delay Functions*, ITCS 2019).
 *
 * `mus` holds one canonical midpoint $\mu_i = |x_i^{2^{\lceil T_i/2 \rceil}}|$ per
 * halving round, $\lceil \log_2 T \rceil$ of them ($T = 1$ needs none — the
 * verifier checks $y = |x^2|$ directly). `T` and `y` restate the claim so a proof
 * is self-contained and serializable on its own.
 */
export interface PietrzakProof {
  /** Claimed number of sequential squarings, $1 \le T \le 2^{32} - 1$. */
  readonly T: number
  /** Claimed output $y = |x^{2^T}|$, canonical in $[1, (n-1)/2]$. */
  readonly y: bigint
  /** Halving midpoints $\mu_1, \dots, \mu_{\lceil \log_2 T \rceil}$, in round order. */
  readonly mus: readonly bigint[]
}

/**
 * A Wesolowski proof for $y = |x^{2^T}|$ (Wesolowski, *Efficient Verifiable Delay
 * Functions*, EUROCRYPT 2019): the single element $\pi = |x^{\lfloor 2^T/\ell
 * \rfloor}|$ for the challenge prime $\ell = \mathrm{hashToPrime}(x, y, T)$.
 */
export interface WesolowskiProof {
  /** Claimed number of sequential squarings, $1 \le T \le 2^{32} - 1$. */
  readonly T: number
  /** Claimed output $y = |x^{2^T}|$, canonical in $[1, (n-1)/2]$. */
  readonly y: bigint
  /** The proof element $\pi$, canonical in $[1, (n-1)/2]$. */
  readonly pi: bigint
}

/**
 * Progress callback for long computations: invoked with `(done, total)` work
 * units (squarings, or modular multiplications for the Wesolowski prover)
 * roughly every 1024 units and exactly once with `done === total`. Throwing from
 * the callback propagates out of the caller.
 */
export type ProgressFn = (done: number, total: number) => void
