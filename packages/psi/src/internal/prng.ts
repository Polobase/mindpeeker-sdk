import { PsiError } from '../errors.js'

/**
 * A reproducible seed for psi's resampling and scheduling PRNG. State it in
 * the pre-registration: the same seed always yields the same permutations,
 * offsets, and schedules on every engine.
 *
 * - `number` — a non-negative safe integer ($0 \le s \le 2^{53}-1$)
 * - `bigint` — $0 \le s < 2^{64}$
 * - `string` — hex bytes (e.g. a beacon value or a registration hash), even
 *   length, 1–512 bytes, case-insensitive
 * - `Uint8Array` — 1–512 raw bytes
 *
 * Byte seeds are folded to 64 bits (see {@link seedToUint64}).
 */
export type Seed = number | bigint | string | Uint8Array

const MASK64 = (1n << 64n) - 1n
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n
const MAX_SEED_BYTES = 512
const TWO_32 = 4294967296

/** splitmix64's output mix (Steele, Lea & Flood 2014; Vigna's reference constants). */
function mix64(value: bigint): bigint {
  let z = value & MASK64
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64
  return z ^ (z >> 31n)
}

function bytesFromHex(hex: string, what: string): Uint8Array {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new PsiError('invalid_plan', `${what}: hex seed must be non-empty even-length hex`)
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
}

/**
 * Validate a {@link Seed} and reduce it to the 64-bit splitmix64 start state.
 * Integers map to themselves. Bytes $b_0 \dots b_{L-1}$ are absorbed as
 * $h \leftarrow \mathrm{mix}(L + \gamma)$, then for each big-endian 8-byte
 * block $B_j$ (the last one zero-padded) $h \leftarrow \mathrm{mix}((h \oplus B_j) + \gamma)$,
 * with $\gamma$ = `0x9e3779b97f4a7c15` — the length prefix keeps `[01]` and
 * `[01 00]` distinct.
 *
 * @throws {PsiError} `invalid_plan` for a negative, fractional, oversized, or
 *   malformed seed.
 */
export function seedToUint64(seed: Seed, what = 'seed'): bigint {
  if (typeof seed === 'number') {
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new PsiError('invalid_plan', `${what} must be a non-negative safe integer, got ${seed}`)
    }
    return BigInt(seed)
  }
  if (typeof seed === 'bigint') {
    if (seed < 0n || seed > MASK64) {
      throw new PsiError('invalid_plan', `${what} bigint must be in [0, 2^64), got ${seed}`)
    }
    return seed
  }
  const bytes =
    typeof seed === 'string'
      ? bytesFromHex(seed, what)
      : seed instanceof Uint8Array
        ? seed
        : undefined
  if (bytes === undefined) {
    throw new PsiError(
      'invalid_plan',
      `${what} must be a number, bigint, hex string, or Uint8Array`,
    )
  }
  if (bytes.length === 0 || bytes.length > MAX_SEED_BYTES) {
    throw new PsiError(
      'invalid_plan',
      `${what} must hold 1–${MAX_SEED_BYTES} bytes, got ${bytes.length}`,
    )
  }
  let h = mix64(BigInt(bytes.length) + GOLDEN_GAMMA)
  for (let i = 0; i < bytes.length; i += 8) {
    let block = 0n
    for (let j = 0; j < 8; j++) block = (block << 8n) | BigInt(bytes[i + j] ?? 0)
    h = mix64((h ^ block) + GOLDEN_GAMMA)
  }
  return h
}

function rotl32(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k))
}

/**
 * psi's internal deterministic PRNG: xoshiro128** (Blackman & Vigna 2018,
 * "Scrambled linear pseudorandom number generators") seeded from two
 * splitmix64 outputs $o_1, o_2$ as $s = (\mathrm{hi}(o_1), \mathrm{lo}(o_1),
 * \mathrm{hi}(o_2), \mathrm{lo}(o_2))$. splitmix64 is a bijection on distinct
 * consecutive states, so the xoshiro state is never all-zero.
 *
 * Statistical, not cryptographic: it decides *which* relabelings or offsets
 * form a null ensemble, and its only job is to be reproducible. Integer draws
 * are exactly uniform (rejection sampling, no modulo bias).
 */
export class Xoshiro128 {
  readonly #s = new Uint32Array(4)

  constructor(seed: Seed = 0, what = 'seed') {
    let state = seedToUint64(seed, what)
    const outputs: bigint[] = []
    for (let i = 0; i < 2; i++) {
      state = (state + GOLDEN_GAMMA) & MASK64
      outputs.push(mix64(state))
    }
    const [o1, o2] = outputs as [bigint, bigint]
    this.#s[0] = Number(o1 >> 32n)
    this.#s[1] = Number(o1 & 0xffffffffn)
    this.#s[2] = Number(o2 >> 32n)
    this.#s[3] = Number(o2 & 0xffffffffn)
  }

  /** Next raw 32-bit output as an unsigned integer in $[0, 2^{32})$. */
  nextUint32(): number {
    const s = this.#s
    const s1 = s[1] as number
    const result = Math.imul(rotl32(Math.imul(s1, 5), 7), 9) >>> 0
    const t = s1 << 9
    s[2] = (s[2] as number) ^ (s[0] as number)
    s[3] = (s[3] as number) ^ s1
    s[1] = s1 ^ (s[2] as number)
    s[0] = (s[0] as number) ^ (s[3] as number)
    s[2] = (s[2] as number) ^ t
    s[3] = rotl32(s[3] as number, 11)
    return result
  }

  /**
   * Exactly uniform integer in $[0, n)$ for integer $1 \le n \le 2^{32}$:
   * draws $x$ until $x < 2^{32} - (2^{32} \bmod n)$, then returns $x \bmod n$.
   */
  uniformInt(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > TWO_32) {
      throw new PsiError(
        'invalid_plan',
        `uniformInt bound must be an integer in [1, 2^32], got ${n}`,
      )
    }
    return this.#uniform(n)
  }

  /** Unchecked {@link uniformInt} for validated bounds (hot loops). */
  #uniform(n: number): number {
    if (n === 1) return 0
    // 2^32 mod n, via 32-bit integer arithmetic when n < 2^31
    const reject = n < 0x80000000 ? (-n >>> 0) % n : TWO_32 % n
    const limit = TWO_32 - reject
    for (;;) {
      const x = this.nextUint32()
      if (x < limit) return x % n
    }
  }

  /**
   * In-place Fisher–Yates (Durstenfeld) shuffle: for $i = n-1, \dots, 1$ swap
   * element $i$ with a uniform $j \in [0, i]$. Every permutation is equally
   * likely.
   */
  shuffle<T>(items: T[]): T[] {
    if (items.length > TWO_32) {
      throw new PsiError('invalid_plan', `cannot shuffle more than 2^32 items, got ${items.length}`)
    }
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.#uniform(i + 1)
      const tmp = items[i] as T
      items[i] = items[j] as T
      items[j] = tmp
    }
    return items
  }
}
