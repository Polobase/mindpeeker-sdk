import type { ByteSource } from '@mindpeeker/oracle'

/** Deterministic xorshift32 byte buffer (the SDK-wide seeded-test idiom). */
export function prngBytes(n: number, seed = 0xabcdef01): Uint8Array {
  let state = seed
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    out[i] = state & 0xff
  }
  return out
}

/**
 * Endless deterministic xorshift32 source — never starves, and advances across
 * a single `stream()` so consumers that pull many chunks get fresh bytes.
 * Same seed → same byte sequence (so single-shot draws are reproducible).
 */
export function prngSource(name: string, seed = 0xabcdef01): ByteSource {
  return {
    name,
    async *stream() {
      let state = seed >>> 0 || 1
      while (true) {
        const chunk = new Uint8Array(256)
        for (let i = 0; i < 256; i++) {
          state ^= state << 13
          state ^= state >>> 17
          state ^= state << 5
          state >>>= 0
          chunk[i] = state & 0xff
        }
        yield chunk
      }
    },
  }
}
