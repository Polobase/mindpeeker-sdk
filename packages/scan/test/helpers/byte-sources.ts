import type { ByteSource, ByteStreamOptions } from '../../src/types.js'

/** Deterministic xorshift32 byte buffer (the SDK-wide seeded-test idiom). */
export function prngBytes(n: number, seed = 0xabcdef01): Uint8Array {
  let state = seed >>> 0 || 1
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

/** Finite batch source: yields `bytes` in `chunkBytes`-sized chunks, then ends. Re-runnable. */
export function batchSource(name: string, bytes: Uint8Array, chunkBytes = 64): ByteSource {
  return {
    name,
    async *stream(opts?: ByteStreamOptions) {
      for (let i = 0; i < bytes.length; i += chunkBytes) {
        if (opts?.signal?.aborted) return
        yield bytes.subarray(i, Math.min(i + chunkBytes, bytes.length))
      }
    },
  }
}

/** Endless source that cycles `bytes` forever (never starves). Honours abort. */
export function cyclingSource(name: string, bytes: Uint8Array, chunkBytes = 64): ByteSource {
  return {
    name,
    async *stream(opts?: ByteStreamOptions) {
      let i = 0
      while (true) {
        if (opts?.signal?.aborted) return
        const end = Math.min(i + chunkBytes, bytes.length)
        yield bytes.subarray(i, end)
        i = end >= bytes.length ? 0 : end
      }
    },
  }
}

/** Endless seeded source (fair-ish LSBs), reseeded per chunk. Honours abort. */
export function seededSource(name: string, seed = 0xabcdef01, chunkBytes = 64): ByteSource {
  return {
    name,
    async *stream(opts?: ByteStreamOptions) {
      let round = seed
      while (true) {
        if (opts?.signal?.aborted) return
        yield prngBytes(chunkBytes, round++)
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

/**
 * Bytes for a deviation scan: `rounds × itemCount` bytes, item `j` at round `r`
 * living at global position `r*itemCount + j`. A fair PRNG baseline; if
 * `biasedItem` is set, that item's bytes are forced odd (bit 1 → always scores).
 */
export function deviationBytes(
  rounds: number,
  itemCount: number,
  opts: { biasedItem?: number; seed?: number } = {},
): Uint8Array {
  const out = prngBytes(rounds * itemCount, opts.seed ?? 0xabcdef01)
  if (opts.biasedItem !== undefined) {
    for (let r = 0; r < rounds; r++) out[r * itemCount + opts.biasedItem] = 1
  }
  return out
}

/**
 * Bytes for a tripolar scan with an injected differential: `bitsPerTrial = 8`,
 * one byte per trial. Interleaved schedule sequence `s` has intention `s % 3`
 * (0 high, 1 low, 2 baseline). High trials get `0xff` (8 one-bits), low `0x00`
 * (0 one-bits), baseline `0x0f` (4). The rest of the buffer is neutral `0x0f`.
 */
export function tripolarBiasBytes(
  trialsPerRun: number,
  runsPerIntention: number,
  totalLength: number,
): Uint8Array {
  const out = new Uint8Array(totalLength).fill(0x0f)
  const schedule = runsPerIntention * 3
  for (let s = 0; s < schedule; s++) {
    const intention = s % 3
    const byte = intention === 0 ? 0xff : intention === 1 ? 0x00 : 0x0f
    for (let t = 0; t < trialsPerRun; t++) {
      const pos = s * trialsPerRun + t
      if (pos < totalLength) out[pos] = byte
    }
  }
  return out
}
