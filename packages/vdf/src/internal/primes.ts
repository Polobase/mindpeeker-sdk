import { bitLength, modPow } from './bigint.js'

/** Upper bound (exclusive) of the trial-division sieve used by `checkModulus`. */
export const TRIAL_DIVISION_BOUND = 65_536

/**
 * Fixed Miller–Rabin bases: the first 32 primes, $2, 3, 5, \dots, 131$.
 *
 * Fixed (not random) bases make primality a deterministic function, so a prover
 * and a verifier always derive the same Wesolowski challenge prime. For a
 * composite chosen *independently of the bases* (a SHA-256 output), each strong
 * base test passes with probability at most $1/4$ (Rabin, *J. Number Theory* 12,
 * 1980) and far less for random odd $k$-bit integers (Damgård–Landrock–Pomerance,
 * *Math. Comp.* 61, 1993); 32 bases put the error beyond any practical concern.
 * Fixed bases are *not* adversarially robust — Arnault (1995) constructs composites
 * that are strong pseudoprimes to many prime bases — which is why they are only ever
 * applied to hash outputs and to the modulus sanity check, never to certify a prime
 * an attacker picked.
 */
export const MILLER_RABIN_BASES: readonly bigint[] = Object.freeze([
  2n,
  3n,
  5n,
  7n,
  11n,
  13n,
  17n,
  19n,
  23n,
  29n,
  31n,
  37n,
  41n,
  43n,
  47n,
  53n,
  59n,
  61n,
  67n,
  71n,
  73n,
  79n,
  83n,
  89n,
  97n,
  101n,
  103n,
  107n,
  109n,
  113n,
  127n,
  131n,
])

let sieveCache: readonly number[] | undefined

/** All primes below {@link TRIAL_DIVISION_BOUND} (Eratosthenes, computed once). */
export function smallPrimes(): readonly number[] {
  if (sieveCache !== undefined) return sieveCache
  const composite = new Uint8Array(TRIAL_DIVISION_BOUND)
  const out: number[] = []
  for (let i = 2; i < TRIAL_DIVISION_BOUND; i++) {
    if (composite[i] === 1) continue
    out.push(i)
    for (let j = i * i; j < TRIAL_DIVISION_BOUND; j += i) composite[j] = 1
  }
  sieveCache = Object.freeze(out)
  return sieveCache
}

/** Primes used to pre-filter Miller–Rabin candidates (all primes below 2000). */
const FILTER_PRIMES: readonly bigint[] = Object.freeze(
  smallPrimes()
    .filter((p) => p < 2000)
    .map((p) => BigInt(p)),
)
const FILTER_LIMIT_SQUARED = 2000n * 2000n

/** One strong-probable-prime test of odd $n > 3$ to base $a$ with $n - 1 = d \cdot 2^s$. */
function strongProbablePrime(n: bigint, a: bigint, d: bigint, s: number): boolean {
  let x = modPow(a % n, d, n)
  if (x === 1n || x === n - 1n) return true
  for (let i = 1; i < s; i++) {
    x = (x * x) % n
    if (x === n - 1n) return true
    if (x === 1n) return false
  }
  return false
}

/**
 * Deterministic probable-prime test: trial division by the primes below 2000
 * (exact for $n < 2000^2$), then strong Miller–Rabin tests to every base in
 * {@link MILLER_RABIN_BASES}. Returns `false` for every $n < 2$.
 */
export function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false
  for (const p of FILTER_PRIMES) {
    if (n === p) return true
    if (n % p === 0n) return false
  }
  if (n < FILTER_LIMIT_SQUARED) return true
  let d = n - 1n
  let s = 0
  while ((d & 1n) === 0n) {
    d >>= 1n
    s++
  }
  for (const a of MILLER_RABIN_BASES) {
    if (!strongProbablePrime(n, a, d, s)) return false
  }
  return true
}

/**
 * $\lfloor n^{1/k} \rfloor$ for $n \ge 0$, $k \ge 1$, by integer Newton iteration
 * $x \leftarrow \lfloor ((k-1)x + \lfloor n / x^{k-1} \rfloor) / k \rfloor$ from the
 * over-estimate $2^{\lceil \mathrm{bitLength}(n)/k \rceil}$; the sequence decreases
 * strictly until it reaches the floor root.
 */
export function integerRoot(n: bigint, k: number): bigint {
  if (n < 2n || k === 1) return n
  const kb = BigInt(k)
  let x = 1n << BigInt(Math.ceil(bitLength(n) / k))
  for (;;) {
    const y = ((kb - 1n) * x + n / x ** (kb - 1n)) / kb
    if (y >= x) return x
    x = y
  }
}

/**
 * The smallest prime exponent $k$ with $n = r^k$ for an integer $r \ge 2$, or
 * `undefined` when $n$ is not a perfect power. Checking prime $k$ suffices
 * ($r^{ab} = (r^a)^b$), and $k \le \mathrm{bitLength}(n)$ since $r \ge 2$.
 */
export function perfectPowerExponent(n: bigint): number | undefined {
  if (n < 4n) return undefined
  const maxK = bitLength(n)
  for (const k of smallPrimes()) {
    if (k > maxK) break
    const root = integerRoot(n, k)
    if (root >= 2n && root ** BigInt(k) === n) return k
  }
  return undefined
}
