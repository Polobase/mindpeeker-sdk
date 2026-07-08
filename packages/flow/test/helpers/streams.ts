import type { ByteSource, ByteStreamOptions } from '../../src/types.js'

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
    out[i] = (state + 0.5) / 4_294_967_296
  }
  return out
}

/** Deterministic iid symbols uniform on [0, alphabet). */
export function prngSymbols(n: number, alphabet: number, seed = 0xabcdef01): Int32Array {
  const uniforms = prngUniforms(n, seed)
  const out = new Int32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.floor((uniforms[i] as number) * alphabet)
  return out
}

/** Deterministic iid bits. */
export function prngBits(n: number, seed = 0xabcdef01): Int32Array {
  return prngSymbols(n, 2, seed)
}

/** Wrap values in a plain async iterable, one item per pull. */
export async function* asyncValues<T>(values: Iterable<T>): AsyncGenerator<T> {
  for (const value of values) yield value
}

/** Endless seeded byte source with pull accounting, for laziness assertions. */
export function countingByteSource(
  name: string,
  chunkBytes = 25,
  seed = 0xabcdef01,
): ByteSource & { readonly pulls: number } {
  let pulls = 0
  let round = seed
  return {
    name,
    get pulls() {
      return pulls
    },
    stream(_opts?: ByteStreamOptions) {
      return (async function* () {
        while (true) {
          pulls++
          yield prngBytes(chunkBytes, round++)
        }
      })()
    },
  }
}

/** Drain an async generator into an array. */
export async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of gen) out.push(item)
  return out
}

/**
 * The exact-TE construction: x tiles the de Bruijn cycle "0011" M times plus
 * one trailing 0; y is x delayed by one step with y[0] = 1. Every consecutive
 * (y_t, y_{t+1}) pair then occurs exactly M times across the estimator's
 * tuple range, so plug-in TE(x→y, k=1, l=1) is EXACTLY 1 bit.
 */
export function balancedShiftPair(m: number): { x: Int32Array; y: Int32Array } {
  const n = 4 * m + 1
  const x = new Int32Array(n)
  for (let i = 0; i < 4 * m; i++) x[i] = i % 4 < 2 ? 0 : 1
  x[n - 1] = 0
  const y = new Int32Array(n)
  y[0] = 1
  for (let t = 1; t < n; t++) y[t] = x[t - 1] as number
  return { x, y }
}
