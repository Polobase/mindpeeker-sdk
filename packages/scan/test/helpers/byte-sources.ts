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
 * Bytes for a deviation scan: coin `r*itemCount + j` (round r, item j) is that
 * bit of the stream, MSB-first, eight coins per byte — `ceil(rounds × itemCount / 8)`
 * bytes. A fair PRNG baseline; if `biasedItem` is set, that item's coins are
 * forced to 1 (it scores every round).
 */
export function deviationBytes(
  rounds: number,
  itemCount: number,
  opts: { biasedItem?: number; seed?: number } = {},
): Uint8Array {
  const out = prngBytes(Math.ceil((rounds * itemCount) / 8), opts.seed ?? 0xabcdef01)
  if (opts.biasedItem !== undefined) {
    for (let r = 0; r < rounds; r++) {
      const c = r * itemCount + opts.biasedItem
      out[c >>> 3] = (out[c >>> 3] as number) | (0x80 >>> (c & 7))
    }
  }
  return out
}

/** Open/close bookkeeping of a {@link trackedSource}. */
export interface StreamLog {
  opened: number
  closed: number
  chunks: number
}

/**
 * A source whose stream counts sessions and records when its `finally` runs —
 * what a serial port's `close()` or a camera track's `stop()` would do. Cycles
 * `bytes` forever unless `finite`; `delayMs` makes each chunk wait (a slow,
 * non-cooperative device that ignores the abort signal).
 */
export function trackedSource(
  name: string,
  bytes: Uint8Array,
  opts: { chunkBytes?: number; finite?: boolean; delayMs?: number } = {},
): { source: ByteSource; log: StreamLog } {
  const log: StreamLog = { opened: 0, closed: 0, chunks: 0 }
  const chunkBytes = opts.chunkBytes ?? 64
  const source: ByteSource = {
    name,
    stream() {
      log.opened++
      return (async function* () {
        try {
          let i = 0
          while (true) {
            if (opts.delayMs !== undefined) await Bun.sleep(opts.delayMs)
            if (i >= bytes.length) {
              if (opts.finite) return
              i = 0
            }
            const end = Math.min(i + chunkBytes, bytes.length)
            log.chunks++
            yield bytes.subarray(i, end)
            i = end
          }
        } finally {
          log.closed++
        }
      })()
    },
  }
  return { source, log }
}

/** A source that yields `good` chunks, then throws `error`. */
export function failingSource(name: string, error: unknown, good = 2, chunkBytes = 16): ByteSource {
  return {
    name,
    async *stream() {
      for (let i = 0; i < good; i++) yield prngBytes(chunkBytes, 0x1234 + i)
      throw error
    },
  }
}

/** A coded error shaped like a sibling package's (e.g. `EntropyError('health_test')`). */
export function codedError(name: string, code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.name = name
  error.code = code
  return error
}
