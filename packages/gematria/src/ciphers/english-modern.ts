/**
 * The further modern English/Latin calculator ciphers, beyond the historical
 * set and the ×6 family in `english.ts` — split into this file to keep both
 * under the package's 500-line limit. Every cipher here is `modern: true`:
 * online-calculator inventions with no ancient pedigree (Latin has no native
 * numerals), added for parity with the gematriaq.com reference calculator.
 * All but a few are pure formulas over the `ordinal`/`reverse` primitives
 * from `latin-shared.ts`; Chaldean and the prime/Fibonacci/prime-cross
 * sequences are genuinely irregular, so those are hardcoded frozen tables.
 *
 * - **Standard** (`en-standard`) — letters grouped in nines like Hebrew's
 *   ones/tens/hundreds scale: A–I=1–9, J–R=10–90 ($10(n-9)$ for ordinal $n$),
 *   S–Z=100–800 ($100(n-18)$).
 * - **Reverse Reduction** (`en-reverse-reduction`) — the digital root of the
 *   reverse-ordinal value, $\operatorname{dr}(27-n)$.
 * - **Satanic** / **Reverse Satanic** (`en-satanic`, `en-reverse-satanic`) —
 *   ordinal (or reverse ordinal) offset by 35: A=36…Z=61, reversed Z=36…A=61.
 * - **Primes** / **Reverse Primes** (`en-primes`, `en-reverse-primes`) — the
 *   $n$-th prime assigned by ordinal position, A=2…Z=101, or that same
 *   26-prime sequence assigned from the other end of the alphabet.
 * - **Squares** / **Reverse Squares** (`en-squares`, `en-reverse-squares`) —
 *   the ordinal (or reverse ordinal) squared, $n^2$: A=1…Z=676.
 * - **Trigonal** / **Reverse Trigonal** (`en-trigonal`, `en-reverse-trigonal`)
 *   — the ordinal's triangular number $T(n) = n(n+1)/2$: A=1…Z=351.
 * - **Fibonacci** (`en-fibonacci`) — the $n$-th Fibonacci number by ordinal
 *   position, A=1, B=1, C=2, D=3 … Z=121393 (the calculator convention of
 *   starting both A and B at 1, rather than a leading $F(0)=0$).
 * - **Chaldean** (`en-chaldean`) — the traditional Chaldean numerology table:
 *   values 1–8 only, 9 being held sacred and never assigned to a letter. The
 *   number-symbolism tradition itself predates online calculators, but this
 *   particular English-letter table is their modern reconstruction of it.
 * - **Septenary** (`en-septenary`) — ordinal position cycled through seven
 *   values, $(n-1) \bmod 7 + 1$.
 * - **Keypad** (`en-keypad`) — the digit of each letter's key on the
 *   international E.161 telephone keypad (ABC=2 … WXYZ=9).
 * - **Cross** / **Reverse Cross** (`en-cross`, `en-reverse-cross`) — the
 *   numbers on Peter Plichta's Prime Number Cross: the successive $6n\pm1$
 *   values (the rays of the 24-wheel, on which every prime $> 3$ falls), A=1,
 *   B=5, C=7…Z=77. This is the whole cross lattice, so its composites (25, 35,
 *   49, 65, 77, …) are kept — it is the *cross*, not its primes. The reverse
 *   assigns the same sequence from Z to A.
 * - **Prime Cross** / **Reverse Prime Cross** (`en-prime-cross`,
 *   `en-reverse-prime-cross`) — only the numbers on that cross which are
 *   actually prime, keeping the central 1: A=1, B=5, C=7…Z=103 (1 followed by
 *   every prime except 2 and 3). Named the *prime* cross, so — unlike the plain
 *   Cross — it carries no composite values. The reverse assigns the same
 *   sequence from Z to A.
 *
 * Sources: gematriaq.com (the reference calculator this set reaches parity
 * with); traditional Chaldean numerology tables (e.g. Cheiro, *Cheiro's Book
 * of Numbers*); ITU-T Recommendation E.161 (the international telephone keypad
 * letter-to-digit mapping); Peter Plichta, *God's Secret Formula: The Prime
 * Number Code* (1997), for the Prime Number Cross.
 */

import { digitRoot } from '../normalize.js'
import type { Cipher } from '../types.js'
import { latinCipher, ordinal, reverse } from './latin-shared.js'

// A–I take the ones, J–R the tens, S–Z the hundreds — the same grouping
// `en-standard` this file is named for.
function standard(ch: string): number {
  const o = ordinal(ch)
  if (o === 0) return 0
  if (o <= 9) return o
  if (o <= 18) return (o - 9) * 10
  return (o - 18) * 100
}

function reverseReduction(ch: string): number {
  return digitRoot(reverse(ch))
}

function satanic(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? o + 35 : 0
}

function reverseSatanic(ch: string): number {
  const r = reverse(ch)
  return r > 0 ? r + 35 : 0
}

function squares(ch: string): number {
  const o = ordinal(ch)
  return o * o
}

function reverseSquares(ch: string): number {
  const r = reverse(ch)
  return r * r
}

/** The $n$-th triangular number $T(n) = n(n+1)/2$; $T(0) = 0$. */
function triangular(n: number): number {
  return (n * (n + 1)) / 2
}

function trigonal(ch: string): number {
  return triangular(ordinal(ch))
}

function reverseTrigonal(ch: string): number {
  return triangular(reverse(ch))
}

function septenary(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? ((o - 1) % 7) + 1 : 0
}

// The first 26 primes, A=2 … Z=101 — not derivable from `ordinal` by a
// formula, so this one sequence is a hardcoded frozen table.
const PRIMES_26: readonly number[] = Object.freeze([
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97,
  101,
])

function primes(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? (PRIMES_26[o - 1] as number) : 0
}

// Reverse-Primes reuses PRIMES_26 read from the other end, so A (index 25 of
// the same table) lands on 101 and Z (index 0) lands on 2.
function reversePrimes(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? (PRIMES_26[26 - o] as number) : 0
}

// Peter Plichta's Prime Number Cross (*God's Secret Formula*, 1997) lays the
// integers on a 24-spoke wheel; since 1, 2, 3 are indivisible, 6 is flanked by
// 5 and 7, and every prime > 3 has the form 6n±1, so all such primes fall on
// the cross's rays. CROSS_26 is those rays' numbers in order — A=1 … Z=77, the
// whole lattice with its composites (25, 35, 49, 65, 77, …) kept — a lookup
// sequence, hence a frozen table.
const CROSS_26: readonly number[] = Object.freeze([
  1, 5, 7, 11, 13, 17, 19, 23, 25, 29, 31, 35, 37, 41, 43, 47, 49, 53, 55, 59, 61, 65, 67, 71, 73,
  77,
])

function cross(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? (CROSS_26[o - 1] as number) : 0
}

// Reverse Cross reads CROSS_26 from the other end: A (index 25) = 77, Z = 1.
function reverseCross(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? (CROSS_26[26 - o] as number) : 0
}

// The Prime Cross proper: only the numbers on Plichta's cross that are actually
// prime, keeping the central 1 — 1 followed by every prime except 2 and 3,
// A=1 … Z=103. Being the *prime* cross, it carries none of CROSS_26's composites.
const CROSS_PRIMES_26: readonly number[] = Object.freeze([
  1, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101,
  103,
])

function primeCross(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? (CROSS_PRIMES_26[o - 1] as number) : 0
}

function reversePrimeCross(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? (CROSS_PRIMES_26[26 - o] as number) : 0
}

// The first 26 Fibonacci numbers starting 1, 1, 2, 3 … — also hardcoded,
// since it is a lookup sequence rather than a closed formula over `ordinal`.
const FIBONACCI_26: readonly number[] = Object.freeze([
  1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946,
  17711, 28657, 46368, 75025, 121393,
])

function fibonacci(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? (FIBONACCI_26[o - 1] as number) : 0
}

// The traditional Chaldean table: values 1-8 only (9 is sacred, never
// assigned). Irregular by design, so hardcoded rather than derived.
const CHALDEAN_ROWS: readonly (readonly [string, number])[] = [
  ['a', 1],
  ['b', 2],
  ['c', 3],
  ['d', 4],
  ['e', 5],
  ['f', 8],
  ['g', 3],
  ['h', 5],
  ['i', 1],
  ['j', 1],
  ['k', 2],
  ['l', 3],
  ['m', 4],
  ['n', 5],
  ['o', 7],
  ['p', 8],
  ['q', 1],
  ['r', 2],
  ['s', 3],
  ['t', 4],
  ['u', 6],
  ['v', 6],
  ['w', 6],
  ['x', 5],
  ['y', 1],
  ['z', 7],
]

const CHALDEAN_VALUES: ReadonlyMap<string, number> = new Map(CHALDEAN_ROWS)

function chaldean(ch: string): number {
  return CHALDEAN_VALUES.get(ch) ?? 0
}

// The international E.161 telephone keypad: irregular groups of 3 or 4
// letters per digit (PQRS and WXYZ take 4, since old keypads had no Q or Z).
const KEYPAD_ROWS: readonly (readonly [string, number])[] = [
  ['a', 2],
  ['b', 2],
  ['c', 2],
  ['d', 3],
  ['e', 3],
  ['f', 3],
  ['g', 4],
  ['h', 4],
  ['i', 4],
  ['j', 5],
  ['k', 5],
  ['l', 5],
  ['m', 6],
  ['n', 6],
  ['o', 6],
  ['p', 7],
  ['q', 7],
  ['r', 7],
  ['s', 7],
  ['t', 8],
  ['u', 8],
  ['v', 8],
  ['w', 9],
  ['x', 9],
  ['y', 9],
  ['z', 9],
]

const KEYPAD_VALUES: ReadonlyMap<string, number> = new Map(KEYPAD_ROWS)

function keypad(ch: string): number {
  return KEYPAD_VALUES.get(ch) ?? 0
}

/**
 * The fourteen further modern English/Latin ciphers that bring this package
 * to parity with the gematriaq.com cipher set. Concatenated onto {@link
 * ../ciphers/english.js}'s `ENGLISH_CIPHERS`; every entry is `modern: true`.
 */
export const ENGLISH_MODERN_CIPHERS: readonly Cipher[] = Object.freeze([
  latinCipher(
    'en-standard',
    'Standard',
    'Modern calculator cipher grouping letters like Hebrew numerals: A–I take ones (1–9), J–R ' +
      'take tens (10–90), S–Z take hundreds (100–800).',
    standard,
    true,
  ),
  latinCipher(
    'en-reverse-reduction',
    'Reverse Reduction',
    'Modern cipher: the reverse-ordinal value of each letter (Z=1…A=26) reduced to a single ' +
      'digit (its digital root) before summing.',
    reverseReduction,
    true,
  ),
  latinCipher(
    'en-satanic',
    'Satanic',
    "Modern cipher offsetting every letter's ordinal value by 35, A=36…Z=61 — an online " +
      "'Satanic gematria' calculator invention with no historical basis.",
    satanic,
    true,
  ),
  latinCipher(
    'en-reverse-satanic',
    'Reverse Satanic',
    "Modern cipher offsetting every letter's reverse-ordinal value by 35, Z=36…A=61 — the " +
      'mirror of the Satanic cipher.',
    reverseSatanic,
    true,
  ),
  latinCipher(
    'en-primes',
    'Primes',
    'Modern cipher assigning the sequence of prime numbers to letters in order: A=2, B=3, ' +
      'C=5…Z=101 (the 26th prime).',
    primes,
    true,
  ),
  latinCipher(
    'en-reverse-primes',
    'Reverse Primes',
    'Modern cipher assigning that same 26-prime sequence in reverse alphabetical order: Z=2, ' +
      'Y=3…A=101.',
    reversePrimes,
    true,
  ),
  latinCipher(
    'en-squares',
    'Squares',
    "Modern cipher squaring each letter's ordinal value: A=1²=1, B=2²=4…Z=26²=676.",
    squares,
    true,
  ),
  latinCipher(
    'en-reverse-squares',
    'Reverse Squares',
    'Modern cipher assigning the square-number sequence in reverse alphabetical order: Z=1, ' +
      'Y=4…A=676.',
    reverseSquares,
    true,
  ),
  latinCipher(
    'en-trigonal',
    'Trigonal',
    'Modern cipher assigning each letter its triangular number T(n)=n(n+1)/2 by ordinal ' +
      'position: A=1, B=3, C=6…Z=351.',
    trigonal,
    true,
  ),
  latinCipher(
    'en-reverse-trigonal',
    'Reverse Trigonal',
    'Modern cipher assigning the triangular-number sequence in reverse alphabetical order: ' +
      'Z=1, Y=3…A=351.',
    reverseTrigonal,
    true,
  ),
  latinCipher(
    'en-fibonacci',
    'Fibonacci',
    'Modern cipher assigning successive Fibonacci numbers to letters in order: A=1, B=1, C=2, ' +
      'D=3, E=5…Z=121393 (the 26th term).',
    fibonacci,
    true,
  ),
  latinCipher(
    'en-chaldean',
    'Chaldean',
    'The traditional Chaldean numerology table (values 1–8, 9 held sacred and never assigned) ' +
      'applied to English letters by modern calculators; a reconstruction of an older system.',
    chaldean,
    true,
  ),
  latinCipher(
    'en-septenary',
    'Septenary',
    "Modern cipher cycling each letter's ordinal position through seven values, " +
      '(ordinal−1) mod 7 + 1.',
    septenary,
    true,
  ),
  latinCipher(
    'en-keypad',
    'Keypad',
    'Modern cipher assigning each letter the digit of its key on the international E.161 ' +
      'telephone keypad (ABC=2 … WXYZ=9).',
    keypad,
    true,
  ),
  latinCipher(
    'en-cross',
    'Cross',
    "Modern cipher after Peter Plichta's Prime Number Cross: letters take the successive numbers " +
      'of the form 6n±1 (the rays of the 24-wheel, on which every prime >3 falls), A=1, B=5, ' +
      'C=7…Z=77 — the whole cross lattice, composites such as 25, 35, 49, 65 and 77 included.',
    cross,
    true,
  ),
  latinCipher(
    'en-reverse-cross',
    'Reverse Cross',
    'Modern cipher assigning the same 6n±1 cross sequence from the other end of the alphabet: ' +
      'Z=1…A=77.',
    reverseCross,
    true,
  ),
  latinCipher(
    'en-prime-cross',
    'Prime Cross',
    "Modern cipher taking only the numbers on Plichta's Prime Number Cross that are actually " +
      'prime, keeping the central 1: A=1, B=5, C=7…Z=103 (1 followed by the primes 5, 7, 11, …, ' +
      'i.e. every prime except 2 and 3) — so, unlike the plain Cross, no composite values.',
    primeCross,
    true,
  ),
  latinCipher(
    'en-reverse-prime-cross',
    'Reverse Prime Cross',
    'Modern cipher assigning that same 1-plus-primes prime-cross sequence from the other end of ' +
      'the alphabet: Z=1…A=103.',
    reversePrimeCross,
    true,
  ),
])
