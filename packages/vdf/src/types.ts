/**
 * An RSA group of unknown order, given by its modulus $n = pq$. The VDF works
 * in the quotient group $\mathbb{Z}_n^\times / \{\pm 1\}$ restricted to
 * quadratic residues (inputs are squared into $QR_n$ by `hashToGroup`).
 *
 * This is the pluggable seam of the package: every function accepts a
 * `{ n: bigint }` and defaults to {@link RSA2048}. Sequentiality of
 * $x \mapsto x^{2^T} \bmod n$ rests on the group order $\varphi(n)$ being
 * unknown — anyone who knows $p, q$ evaluates in $O(\log T)$ time via
 * $2^T \bmod \varphi(n)$ (Rivest–Shamir–Wagner, *Time-lock puzzles and
 * timed-release crypto*, 1996).
 */
export interface RsaModulus {
  /** The modulus $n$; must be odd and should be a product of two large safe primes. */
  readonly n: bigint
}

/**
 * Result of `evaluate`: the group element $x = H'(\mathrm{input})^2 \bmod n$
 * and the VDF output $y = x^{2^T} \bmod n$ after $T$ sequential squarings.
 */
export interface VdfEvaluation {
  readonly x: bigint
  readonly y: bigint
}

/**
 * A Pietrzak halving proof for the statement $y = x^{2^T} \bmod n$
 * (Pietrzak, *Simple Verifiable Delay Functions*, ITCS 2019).
 *
 * `mus` holds one midpoint $\mu_i = x_i^{2^{\lceil T_i/2 \rceil}}$ per halving
 * round, $\lceil \log_2 T \rceil$ of them ($T = 1$ needs none — the verifier
 * checks $y = x^2$ directly). `T` and `y` restate the claim so a proof is
 * self-contained and serializable on its own.
 */
export interface PietrzakProof {
  /** Claimed number of sequential squarings, $1 \le T \le 2^{32} - 1$. */
  readonly T: number
  /** Claimed output $y = x^{2^T} \bmod n$. */
  readonly y: bigint
  /** Halving midpoints $\mu_1, \dots, \mu_{\lceil \log_2 T \rceil}$, in round order. */
  readonly mus: readonly bigint[]
}

/**
 * Progress callback for long squaring chains: invoked with
 * `(squaringsDone, squaringsTotal)` roughly every 1024 squarings and once at
 * completion. Throwing from the callback propagates out of the caller.
 */
export type ProgressFn = (done: number, total: number) => void
