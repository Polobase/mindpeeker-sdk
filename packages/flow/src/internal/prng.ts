/**
 * Deterministic xorshift32 generator (Marsaglia 2003, "Xorshift RNGs")
 * returning uniforms in the open interval $(0, 1)$. Surrogate data must be
 * reproducible — same seed in, same surrogates out — and must never consume
 * the randomness under test, so this is the only randomness source in the
 * package. Period $2^{32} - 1$; a zero seed is remapped to 1 (zero is the
 * xorshift fixed point).
 */
export function xorshift32(seed = 0x9e3779b9): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return (state + 0.5) / 4_294_967_296
  }
}

/** Uniform integer in [0, bound) from a unit-uniform generator. */
export function randomInt(rng: () => number, bound: number): number {
  return Math.floor(rng() * bound)
}
