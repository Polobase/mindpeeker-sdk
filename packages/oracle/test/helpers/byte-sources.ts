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

/** Finite source: yields the given chunks, then ends (optionally throws instead). */
export function chunkSource(
  name: string,
  chunks: readonly Uint8Array[],
  opts: { errorAfter?: unknown } = {},
): ByteSource {
  return {
    name,
    async *stream() {
      for (const chunk of chunks) yield chunk
      if (opts.errorAfter !== undefined) throw opts.errorAfter
    },
  }
}

/** Endless seeded source with pull accounting, for laziness assertions. */
export function countingSource(
  name: string,
  chunkBytes = 25,
  seed = 0xabcdef01,
): ByteSource & { readonly pulls: number; readonly streamCalls: number } {
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
    stream(_opts?: ByteStreamOptions) {
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

/** Increment a counting array (sidesteps noUncheckedIndexedAccess noise). */
export function bump(counts: number[], index: number): void {
  counts[index] = (counts[index] ?? 0) + 1
}

/** Pearson chi-square statistic for observed counts against expected counts. */
export function chiSquare(observed: readonly number[], expected: readonly number[]): number {
  let stat = 0
  for (let i = 0; i < observed.length; i++) {
    const e = expected[i] as number
    const diff = (observed[i] as number) - e
    stat += (diff * diff) / e
  }
  return stat
}
