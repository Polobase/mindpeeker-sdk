import type { TrialSource, TrialStreamOptions } from '../../src/types.js'

/** Deterministic xorshift32 byte stream (the SDK-wide seeded-test idiom). */
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

/** Deterministic uniforms in (0, 1). */
export function prngUniforms(n: number, seed = 0xabcdef01): Float64Array {
  let state = seed
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    out[i] = (state + 0.5) / 4294967296
  }
  return out
}

/** Finite source: yields the given chunks, then ends (optionally throws instead). */
export function chunkSource(
  name: string,
  chunks: readonly Uint8Array[],
  opts: { errorAfter?: unknown } = {},
): TrialSource {
  return {
    name,
    async *stream() {
      for (const chunk of chunks) yield chunk
      if (opts.errorAfter !== undefined) throw opts.errorAfter
    },
  }
}

/** Finite seeded source: `count` chunks of `chunkBytes` prng bytes each. */
export function finiteSource(
  name: string,
  count: number,
  seed: number,
  chunkBytes = 25,
): TrialSource {
  return chunkSource(
    name,
    Array.from({ length: count }, (_, i) => prngBytes(chunkBytes, seed + i)),
  )
}

/** The exact byte material `finiteSource` streams, concatenated — for batch cross-checks. */
export function finiteSourceBytes(count: number, seed: number, chunkBytes = 25): Uint8Array {
  const out = new Uint8Array(count * chunkBytes)
  for (let i = 0; i < count; i++) out.set(prngBytes(chunkBytes, seed + i), i * chunkBytes)
  return out
}

/** Endless seeded source with pull accounting, for laziness/abort assertions. */
export function countingSource(
  name: string,
  chunkBytes = 25,
  seed = 0xabcdef01,
): TrialSource & { readonly pulls: number; readonly streamCalls: number } {
  let pulls = 0
  let streamCalls = 0
  let round = seed
  return {
    name,
    get pulls() {
      return pulls
    },
    get streamCalls() {
      return streamCalls
    },
    stream(_opts?: TrialStreamOptions) {
      streamCalls++
      return (async function* () {
        while (true) {
          pulls++
          yield prngBytes(chunkBytes, round++)
        }
      })()
    },
  }
}

/** Monotonic fake clock: startMs, startMs + stepMs, … — deterministic timestamps. */
export function fakeClock(startMs = 0, stepMs = 1000): () => number {
  let calls = 0
  return () => startMs + stepMs * calls++
}
