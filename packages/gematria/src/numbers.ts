/**
 * Number-lore — the pure-arithmetic portrait of a gematria value, independent
 * of any word. A value like 666 is not just a total: it is the 36th triangular
 * number ($\sum_{k=1}^{36} k = 666$) and factors as $2 \cdot 3^2 \cdot 37$.
 * Traditions read meaning into such facts; the arithmetic itself is exact and
 * uncontested (see the README's honest-framing section — the computation is
 * rigorous, the interpretation is not).
 *
 * Everything here is deterministic, allocation-light and browser-safe: trial
 * division for primality/factorization ($O(\sqrt{n})$), the closed form
 * $k = \tfrac{-1 + \sqrt{1 + 8n}}{2}$ for the triangular index, and a divisor
 * sweep for perfection. Intended for gematria-scale integers.
 *
 * Sources: Clifford Pickover, *A Passion for Mathematics* (figurate numbers,
 * 666); standard number theory (triangular/square/perfect numbers).
 */

import { GematriaError } from './errors.js'
import { digitRoot } from './normalize.js'
import type { NumberProperties, PrimeFactor } from './types.js'

/** Sum of the decimal digits of a non-negative integer (a single pass). */
function digitSum(n: number): number {
  let s = 0
  let x = n
  while (x > 0) {
    s += x % 10
    x = Math.floor(x / 10)
  }
  return s
}

/** Trial-division primality test. */
function isPrime(n: number): boolean {
  if (n < 2) return false
  if (n % 2 === 0) return n === 2
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false
  return true
}

/** Ascending prime-power factorization; empty for 0 and 1. */
function factorize(n: number): readonly PrimeFactor[] {
  const out: PrimeFactor[] = []
  let x = n
  for (let d = 2; d * d <= x; d++) {
    if (x % d !== 0) continue
    let exponent = 0
    while (x % d === 0) {
      x /= d
      exponent++
    }
    out.push(Object.freeze({ prime: d, exponent }))
  }
  if (x > 1) out.push(Object.freeze({ prime: x, exponent: 1 }))
  return Object.freeze(out)
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

/** Whether `n` equals the sum of its proper divisors (6, 28, 496, 8128, …). */
function isPerfect(n: number): boolean {
  if (n < 2) return false
  let sum = 1
  for (let d = 2; d * d <= n; d++) {
    if (n % d !== 0) continue
    sum += d
    const q = n / d
    if (q !== d) sum += q
  }
  return sum === n
}

/**
 * The full number-lore portrait of a non-negative integer — its digit sum and
 * digital root, primality and prime factorization, and whether it is a
 * triangular, square or perfect number (with the triangular index when it is).
 *
 * @throws GematriaError `'invalid_input'` unless `n` is a non-negative integer
 */
export function numberProperties(n: number): NumberProperties {
  if (!Number.isInteger(n) || n < 0) {
    throw new GematriaError(
      'invalid_input',
      `numberProperties expects a non-negative integer, got ${n}`,
    )
  }
  const ti = triangularIndex(n)
  return Object.freeze({
    value: n,
    digitSum: digitSum(n),
    digitalRoot: digitRoot(n),
    isPrime: isPrime(n),
    factorization: factorize(n),
    isTriangular: ti !== undefined,
    ...(ti !== undefined ? { triangularIndex: ti } : {}),
    isSquare: isSquare(n),
    isPerfect: isPerfect(n),
  })
}
