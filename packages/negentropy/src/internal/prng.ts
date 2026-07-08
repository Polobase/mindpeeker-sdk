/**
 * Deterministic xorshift32 uniform stream in (0, 1) exclusive. Used for
 * dither noise — dither must be reproducible and must NEVER spend the
 * randomness under test.
 */
export function uniformStream(seed = 0x9e3779b9): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return (state + 0.5) / 4294967296
  }
}
