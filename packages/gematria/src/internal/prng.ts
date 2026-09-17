/**
 * A tiny seeded PRNG for replayable permutation nulls: xoshiro128** (Blackman &
 * Vigna) with its 128-bit state filled by splitmix32 from a safe-integer seed.
 * Integer-only arithmetic (`Math.imul`, shifts), so the stream is identical on
 * every JavaScript engine. Not cryptographic; it only has to make a null
 * distribution reproducible from a documented seed.
 */

/** A generator of uniform 32-bit unsigned integers. */
export type Uint32Source = () => number

/** One splitmix32 step (the "Hash Prospector" mixer) on a 32-bit counter. */
function splitmix32(state: { s: number }): number {
  state.s = (state.s + 0x9e3779b9) | 0
  let z = state.s
  z ^= z >>> 16
  z = Math.imul(z, 0x21f0aaad)
  z ^= z >>> 15
  z = Math.imul(z, 0x735a2d97)
  z ^= z >>> 15
  return z >>> 0
}

/**
 * A xoshiro128** generator from an explicit 128-bit state (four 32-bit words,
 * not all zero). With state `(1, 2, 3, 4)` the first outputs are 11520, 0,
 * 5927040 — the reference implementation's vector.
 */
export function xoshiro128FromState(a: number, b: number, c: number, d: number): Uint32Source {
  let s0 = a | 0
  let s1 = b | 0
  let s2 = c | 0
  let s3 = d | 0
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1
  return () => {
    const x = Math.imul(s1, 5)
    const result = Math.imul((x << 7) | (x >>> 25), 9) >>> 0
    const t = s1 << 9
    s2 ^= s0
    s3 ^= s1
    s1 ^= s2
    s0 ^= s3
    s2 ^= t
    s3 = (s3 << 11) | (s3 >>> 21)
    return result
  }
}

/**
 * A xoshiro128** generator for a non-negative safe-integer `seed`, its state
 * filled by splitmix32. Both 32-bit halves of the seed feed the state, so
 * distinct seeds give distinct streams.
 */
export function xoshiro128(seed: number): Uint32Source {
  const hi = Math.floor(seed / 2 ** 32) >>> 0
  const mix = { s: (seed >>> 0) ^ Math.imul(hi, 0x85ebca6b) }
  const a = splitmix32(mix)
  const b = splitmix32(mix)
  const c = splitmix32(mix) ^ hi
  return xoshiro128FromState(a, b, c, splitmix32(mix))
}

/** An exactly uniform integer in $[0, m)$ for $1 \le m \le 2^{32}$, by rejection. */
export function uniformBelow(next: Uint32Source, m: number): number {
  const limit = 2 ** 32 - (2 ** 32 % m)
  for (;;) {
    const u = next()
    if (u < limit) return u % m
  }
}
