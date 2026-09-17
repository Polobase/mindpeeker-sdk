/** Default dither seed (the golden-ratio constant). */
export const DEFAULT_DITHER_SEED = 0x9e3779b9

/**
 * Deterministic xorshift32 uniform stream in (0, 1) exclusive. Used for
 * dither noise — dither must be reproducible and must NEVER spend the
 * randomness under test.
 */
export function uniformStream(seed = DEFAULT_DITHER_SEED): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return (state + 0.5) / 4294967296
  }
}

/** MurmurHash3 32-bit finalizer — full avalanche on a 32-bit word. */
function fmix32(value: number): number {
  let h = value >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * Derive a per-stream seed from a caller seed and a label (e.g. a source
 * name): FNV-1a over the label's UTF-16 code units, XORed with the finalized
 * seed and finalized again. Distinct labels give unrelated xorshift32 start
 * states, so dither never repeats across sources; same inputs, same seed.
 */
export function labelSeed(seed: number, label: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return fmix32(hash ^ fmix32(seed)) || 1
}
