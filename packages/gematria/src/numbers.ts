/**
 * Number-lore — the pure-arithmetic portrait of a gematria value, independent
 * of any word. A value like 666 is not just a total: it is the 36th triangular
 * number ($\sum_{k=1}^{36} k = 666$) and factors as $2 \cdot 3^2 \cdot 37$.
 * Traditions read meaning into such facts; the arithmetic itself is exact and
 * uncontested (see the README's honest-framing section — the computation is
 * rigorous, the interpretation is not).
 *
 * Everything here is deterministic, allocation-light and browser-safe. One
 * trial-division sweep over 2, 3 and $6k \pm 1$ ($O(\sqrt{n})$, under $2^{23}$ candidates)
 * yields the prime factorization, from which primality (a single prime with
 * exponent 1) and perfection follow: the divisor sum is
 * $\sigma(n) = \prod_p (1 + p + \dots + p^{e_p})$ and $n$ is perfect iff
 * $\sigma(n) = 2n$. The triangular index uses the closed form
 * $k = \tfrac{-1 + \sqrt{1 + 8n}}{2}$.
 *
 * **Domain.** Integers $0 \le n \le 2^{48}$ ({@link MAX_NUMBER}). Below
 * $2^{53}$ every intermediate — digit sums, $1 + 8n$, $\sigma(n) < 7n$ — is an
 * exact float64 integer, and the $2^{48}$ cap bounds the sweep to well under a
 * second; it matches the largest range `@mindpeeker/oracle` draws uniformly.
 *
 * Sources: Clifford Pickover, *A Passion for Mathematics* (figurate numbers,
 * 666); standard number theory (triangular/square/perfect numbers; Robin's
 * bound $\sigma(n) < e^{\gamma} n \ln\ln n + 0.6483\, n / \ln\ln n$ for the
 * exactness margin).
 */

import { GematriaError } from './errors.js'
import { digitRoot } from './normalize.js'
import type { NumberProperties, PrimeFactor } from './types.js'

/** The largest integer {@link numberProperties} accepts: $2^{48}$. */
export const MAX_NUMBER = 2 ** 48

/** Sum of the decimal digits of a non-negative safe integer (a single pass). */
function digitSum(n: number): number {
  let s = 0
  let x = n
  while (x > 0) {
    s += x % 10
    x = Math.floor(x / 10)
  }
  return s
}

/** Ascending prime-power factorization by one trial-division sweep; empty for 0 and 1. */
function factorize(n: number): readonly PrimeFactor[] {
  const out: PrimeFactor[] = []
  if (n < 2) return Object.freeze(out)
  let x = n
  const divide = (d: number): void => {
    let exponent = 0
    while (x % d === 0) {
      x /= d
      exponent++
    }
    if (exponent > 0) out.push(Object.freeze({ prime: d, exponent }))
  }
  divide(2)
  divide(3)
  // 6k ± 1 wheel: 5, 7, 11, 13, … (every prime > 3 has this form)
  for (let d = 5, step = 2; d * d <= x; d += step, step = 6 - step) if (x % d === 0) divide(d)
  if (x > 1) out.push(Object.freeze({ prime: x, exponent: 1 }))
  return Object.freeze(out)
}

/** $\sigma(n)$ from the factorization; exact because $\sigma(n) < 7n \le 7 \cdot 2^{48}$. */
function divisorSum(factors: readonly PrimeFactor[]): number {
  let sigma = 1
  for (const { prime, exponent } of factors) {
    let term = 1
    let sum = 1
    for (let e = 0; e < exponent; e++) {
      term *= prime
      sum += term
    }
    sigma *= sum
  }
  return sigma
}

/** The triangular index $k$ with $k(k+1)/2 = n$, or `undefined`. */
function triangularIndex(n: number): number | undefined {
  const disc = 1 + 8 * n
  const r = Math.round(Math.sqrt(disc))
  if (r * r !== disc) return undefined
  const k = (r - 1) / 2
  return Number.isInteger(k) ? k : undefined
}

/** Whether `n` is a perfect square. */
function isSquare(n: number): boolean {
  const r = Math.round(Math.sqrt(n))
  return r * r === n
}

/**
 * The full number-lore portrait of a non-negative integer — its digit sum and
 * digital root, primality and prime factorization, and whether it is a
 * triangular, square or perfect number (with the triangular index when it is).
 *
 * @throws GematriaError `'invalid_input'` unless `n` is an integer in
 *   $[0, 2^{48}]$ (a non-safe integer, NaN or a non-number included)
 */
export function numberProperties(n: number): NumberProperties {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > MAX_NUMBER) {
    throw new GematriaError(
      'invalid_input',
      `numberProperties expects an integer in [0, 2^48], got ${String(n)}`,
    )
  }
  const factorization = factorize(n)
  const only = factorization.length === 1 ? factorization[0] : undefined
  const ti = triangularIndex(n)
  return Object.freeze({
    value: n,
    digitSum: digitSum(n),
    digitalRoot: digitRoot(n),
    isPrime: only !== undefined && only.exponent === 1,
    factorization,
    isTriangular: ti !== undefined,
    ...(ti !== undefined ? { triangularIndex: ti } : {}),
    isSquare: isSquare(n),
    isPerfect: n >= 2 && divisorSum(factorization) === 2 * n,
  })
}
