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

/** Deterministic standard normals (Box–Muller over xorshift uniforms). */
export function gaussians(n: number, seed = 0xabcdef01): Float64Array {
  const uniforms = prngUniforms(2 * Math.ceil(n / 2), seed)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log(uniforms[i] as number))
    const theta = 2 * Math.PI * (uniforms[i + 1] as number)
    out[i] = r * Math.cos(theta)
    if (i + 1 < n) out[i + 1] = r * Math.sin(theta)
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

/** Endless seeded source with pull accounting, for laziness/backpressure assertions. */
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
