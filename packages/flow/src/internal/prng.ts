import { FlowError } from '../errors.js'

const TWO_POW_32 = 4_294_967_296
const TWO_POW_53 = 9_007_199_254_740_992
const MASK_64 = (1n << 64n) - 1n

/** Default surrogate seed (the 32-bit golden-ratio constant), kept from 0.1.0. */
export const DEFAULT_SEED = 0x9e3779b9

/**
 * Deterministic xorshift32 generator (Marsaglia 2003, "Xorshift RNGs")
 * returning uniforms in the open interval $(0, 1)$.
 *
 * Legacy generator kept for callers that pinned 0.1.0 surrogate streams; the
 * package's own significance tests use {@link xoshiro128ss}. Period
 * $2^{32} - 1$ and only $2^{32}$ states, so it cannot reach most
 * permutations of more than 12 elements. `seed` must be an integer in
 * $[0, 2^{32} - 1]$ (anything else throws `invalid_input` instead of silently
 * aliasing another seed); seed 0 is remapped to 1 because zero is the
 * xorshift fixed point, so seeds 0 and 1 produce the same stream.
 */
export function xorshift32(seed = DEFAULT_SEED): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new FlowError(
      'invalid_input',
      `xorshift32 seed must be an integer in [0, 2^32 − 1], got ${seed}`,
    )
  }
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return (state + 0.5) / TWO_POW_32
  }
}

/** Validate a surrogate seed: a non-negative safe integer. */
export function validateSeed(seed: number | undefined): number {
  if (seed === undefined) return DEFAULT_SEED
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new FlowError(
      'invalid_input',
      `seed must be a non-negative safe integer (0 … 2^53 − 1), got ${seed}`,
    )
  }
  return seed
}

/** One SplitMix64 step (Steele, Lea & Flood 2014) on a 64-bit BigInt state. */
function splitmix64(state: bigint): { state: bigint; value: bigint } {
  const next = (state + 0x9e3779b97f4a7c15n) & MASK_64
  let z = next
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64
  z ^= z >> 31n
  return { state: next, value: z }
}

function rotl32(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k))
}

/**
 * Deterministic xoshiro128** generator (Blackman & Vigna 2018, "Scrambled
 * linear pseudorandom number generators") seeded through SplitMix64, returning
 * uniforms in $[0, 1)$ with 53 bits of resolution. This is the surrogate PRNG
 * of every significance function in the package.
 *
 * Seeding (stable API — surrogate ensembles are reproducible from the seed):
 * two SplitMix64 outputs $z_1, z_2$ from the 64-bit state `seed` become the
 * 128-bit state $(s_0, s_1, s_2, s_3) = (\mathrm{hi}(z_1), \mathrm{lo}(z_1),
 * \mathrm{hi}(z_2), \mathrm{lo}(z_2))$. Each uniform consumes two 32-bit
 * outputs $a, b$: $u = (\lfloor a / 2^5 \rfloor \cdot 2^{26} +
 * \lfloor b / 2^6 \rfloor) / 2^{53}$. Period $2^{128} - 1$.
 *
 * `seed` must be a non-negative safe integer; otherwise `invalid_input`.
 */
export function xoshiro128ss(seed: number = DEFAULT_SEED): () => number {
  const s = validateSeed(seed)
  const first = splitmix64(BigInt(s))
  const second = splitmix64(first.state)
  let s0 = Number(first.value >> 32n) | 0
  let s1 = Number(first.value & 0xffff_ffffn) | 0
  let s2 = Number(second.value >> 32n) | 0
  let s3 = Number(second.value & 0xffff_ffffn) | 0
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1 // the all-zero state is a fixed point
  const next32 = (): number => {
    const result = Math.imul(rotl32(Math.imul(s1, 5), 7), 9) >>> 0
    const t = s1 << 9
    s2 ^= s0
    s3 ^= s1
    s1 ^= s2
    s0 ^= s3
    s2 ^= t
    s3 = rotl32(s3, 11)
    return result
  }
  return () => {
    const a = next32() >>> 5
    const b = next32() >>> 6
    return (a * 67_108_864 + b) / TWO_POW_53
  }
}

/**
 * Uniform integer in $[0, bound)$ from a unit-uniform generator. The
 * generator must return a finite number in $[0, 1)$; anything else (1, NaN,
 * negative) throws `invalid_input` rather than silently corrupting a
 * surrogate.
 */
export function randomInt(rng: () => number, bound: number): number {
  const u = rng()
  if (!(u >= 0 && u < 1)) {
    throw new FlowError('invalid_input', `rng must return a number in [0, 1), got ${u}`)
  }
  return Math.min(bound - 1, Math.floor(u * bound))
}
