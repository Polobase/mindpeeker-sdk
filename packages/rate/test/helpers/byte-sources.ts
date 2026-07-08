import type { ByteSource, ByteStreamOptions } from '../../src/types.js'

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

/** Finite source: yields the given chunks, then ends. Honours an abort signal. */
export function chunkSource(name: string, chunks: readonly Uint8Array[]): ByteSource {
  return {
    name,
    async *stream(opts?: ByteStreamOptions) {
      for (const chunk of chunks) {
        if (opts?.signal?.aborted) return
        yield chunk
      }
    },
  }
}

/** Collect an async byte stream into one buffer. */
export async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) {
    parts.push(chunk)
    total += chunk.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Collect an async Float64Array stream into one Float64Array. */
export async function collectFloats(stream: AsyncIterable<Float64Array>): Promise<Float64Array> {
  const parts: Float64Array[] = []
  let total = 0
  for await (const chunk of stream) {
    parts.push(chunk)
    total += chunk.length
  }
  const out = new Float64Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
