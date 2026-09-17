import { bitLength } from './bigint.js'

/**
 * The signed quadratic residues $QR_n^+$ (Hofheinz–Kiltz, CRYPTO 2009), the group
 * Pietrzak's *Simple Verifiable Delay Functions* (ITCS 2019) instantiates the RSA
 * VDF in because it has no low-order elements for safe-prime moduli.
 *
 * Every element is identified with its *canonical representative*
 * $|a| = \min(a, n - a) \in [1, (n-1)/2]$, and the group operation is
 * $a \circ b = |a \cdot b \bmod n|$. Because $|\cdot|$ is a homomorphism
 * $\mathbb{Z}_n^\times \to \mathbb{Z}_n^\times/\{\pm 1\}$, arithmetic may run on raw
 * representatives and canonicalise once at the end: $|x^{e}| = |\,|x|^{e}|$.
 * The element $-1$ (order 2 in $\mathbb{Z}_n^\times$) collapses to the identity, so
 * the negated output $n - y$ is no longer a distinct, acceptable value.
 */

/** $(n-1)/2$ — the largest canonical representative. */
export function halfModulus(n: bigint): bigint {
  return (n - 1n) >> 1n
}

/** Canonical representative $\min(a, n - a)$ of $a \in [0, n)$ (0 stays 0). */
export function canon(a: bigint, n: bigint): bigint {
  return a <= (n - 1n) >> 1n ? a : n - a
}

/** Canonical product $|a \cdot b \bmod n|$. */
export function mulCanon(a: bigint, b: bigint, n: bigint): bigint {
  return canon((a * b) % n, n)
}

/**
 * Jacobi symbol $\left(\frac{a}{n}\right)$ for odd $n > 0$, by the binary
 * reciprocity algorithm (Cohen, *A Course in Computational Algebraic Number
 * Theory*, §1.4): strip factors of two using
 * $\left(\frac{2}{n}\right) = (-1)^{(n^2-1)/8}$, flip with quadratic reciprocity,
 * reduce. $O(\log^2 n)$ bit operations; returns 0 iff $\gcd(a, n) > 1$.
 */
export function jacobi(a: bigint, n: bigint): -1 | 0 | 1 {
  let x = a % n
  if (x < 0n) x += n
  let m = n
  let t: -1 | 1 = 1
  while (x !== 0n) {
    const zeros = bitLength(x & -x) - 1
    if (zeros > 0) {
      x >>= BigInt(zeros)
      const r = m & 7n
      if ((zeros & 1) === 1 && (r === 3n || r === 5n)) t = t === 1 ? -1 : 1
    }
    const swap = x
    x = m
    m = swap
    if ((x & 3n) === 3n && (m & 3n) === 3n) t = t === 1 ? -1 : 1
    x %= m
  }
  return m === 1n ? t : 0
}

/**
 * Membership test the verifiers apply to every prover-supplied element: the
 * canonical range $1 \le a \le (n-1)/2$ plus a Jacobi-symbol check.
 *
 * For $n \equiv 1 \pmod 4$ (every product of two safe primes, and RSA-2048)
 * $\left(\frac{-1}{n}\right) = 1$, so every honest element — the canonical
 * representative of a square — has Jacobi symbol $+1$, and the check restricts
 * the working set to $J_n^+$. For a Blum integer $n = pq$,
 * $p \equiv q \equiv 3 \pmod 4$, $J_n^+ = QR_n^+$ exactly (Hofheinz–Kiltz), which
 * for safe primes has odd order $p'q'$ and no element of order 2. For
 * $n \equiv 3 \pmod 4$ the sign flip changes the symbol, so only
 * $\gcd(a, n) > 1$ (symbol 0) is rejected.
 */
export function isGroupElement(a: bigint, n: bigint): boolean {
  if (a < 1n || a > (n - 1n) >> 1n) return false
  const symbol = jacobi(a, n)
  if (symbol === 1) return true
  return symbol === -1 && (n & 3n) === 3n
}
