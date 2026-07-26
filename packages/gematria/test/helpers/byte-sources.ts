import type { ByteSource } from '@mindpeeker/oracle'

/** Deterministic xorshift32 byte stream (the SDK-wide seeded-test idiom). */
export function prngBytes(n: number, seed = 0xabcdef01): Uint8Array {
  let state = seed >>> 0
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

/** Finite named source that yields one chunk, then ends. */
export function bytesSource(name: string, bytes: Uint8Array): ByteSource {
  return {
    name,
    async *stream() {
      yield bytes
    },
  }
}
