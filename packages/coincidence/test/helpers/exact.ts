/**
 * Test-only exact arithmetic: BigInt rationals, brute-force enumeration and a
 * seeded PRNG. Nothing here shares code with src/.
 */
import { expect } from 'bun:test'

/** A non-negative rational num/den with BigInt parts (not reduced). */
export interface Rational {
  readonly num: bigint
  readonly den: bigint
}

export const ZERO: Rational = { num: 0n, den: 1n }
export const ONE: Rational = { num: 1n, den: 1n }

export function rat(num: bigint | number, den: bigint | number = 1n): Rational {
  return { num: BigInt(num), den: BigInt(den) }
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}

function reduce(r: Rational): Rational {
  const g = gcd(r.num, r.den)
  return g === 0n || g === 1n ? r : { num: r.num / g, den: r.den / g }
}

export function add(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.den + b.num * a.den, den: a.den * b.den })
}

export function sub(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.den - b.num * a.den, den: a.den * b.den })
}

export function mul(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.num, den: a.den * b.den })
}

export function equal(a: Rational, b: Rational): boolean {
  return a.num * b.den === b.num * a.den
}

/** Nearest double to a rational, via 64 significant bits of BigInt division. */
export function toNumber(r: Rational): number {
  if (r.num === 0n) return 0
  const negative = r.num < 0n !== r.den < 0n
  const num = r.num < 0n ? -r.num : r.num
  const den = r.den < 0n ? -r.den : r.den
  const shift = den.toString(2).length - num.toString(2).length + 64
  const q = shift >= 0 ? (num << BigInt(shift)) / den : num / (den << BigInt(-shift))
  const value = Number(q) * 2 ** -shift
  return negative ? -value : value
}

export function factorial(n: number): bigint {
  let f = 1n
  for (let i = 2n; i <= BigInt(n); i++) f *= i
  return f
}

/** Calls `visit` with every tuple in {0 … base−1}^length. */
export function forEachTuple(base: number, length: number, visit: (tuple: number[]) => void): void {
  const tuple = new Array<number>(length).fill(0)
  if (length === 0) {
    visit(tuple)
    return
  }
  for (;;) {
    visit(tuple)
    let i = length - 1
    while (i >= 0 && tuple[i] === base - 1) {
      tuple[i] = 0
      i--
    }
    if (i < 0) return
    tuple[i] = (tuple[i] as number) + 1
  }
}

/** Relative closeness with an absolute floor for values near zero. */
export function expectClose(actual: number, expected: number, relative = 1e-12, floor = 1e-300) {
  const scale = Math.max(Math.abs(expected), floor)
  expect(Math.abs(actual - expected) / scale).toBeLessThanOrEqual(relative)
}

/** SplitMix64-style 32-bit generator for deterministic test inputs. */
export function seeded(seed: number): () => number {
  let state = BigInt(seed) & 0xffffffffffffffffn
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn
    let z = state
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn
    z ^= z >> 31n
    return Number(z >> 11n) / 2 ** 53
  }
}
