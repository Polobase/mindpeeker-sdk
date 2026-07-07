import { EntropyError } from '../errors.js'
import type { EntropyRequestOptions, EntropyResult, EntropyStreamOptions } from '../types.js'
import { concatBytes } from './bytes.js'
import { sleep } from './rate-limit.js'

export const DEFAULT_CHUNK_BYTES = 32

interface ByteSource {
  getBytes(length: number, opts?: EntropyRequestOptions): Promise<EntropyResult>
}

/**
 * Default stream implementation: one `getBytes` call per pull. Lazy (no I/O
 * before the first `next()`), backpressured by construction, and it inherits
 * whatever rate limiting the underlying `getBytes` applies.
 */
export function pollStream(
  source: ByteSource,
  opts: EntropyStreamOptions = {},
  defaultChunkBytes: number = DEFAULT_CHUNK_BYTES,
): AsyncIterable<Uint8Array> {
  const chunkBytes = opts.chunkBytes ?? defaultChunkBytes
  const requestOpts: EntropyRequestOptions = { signal: opts.signal, timeoutMs: opts.timeoutMs }
  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const { bytes } = await source.getBytes(chunkBytes, requestOpts)
        yield bytes
      }
    },
  }
}

/**
 * Re-slice an inner stream into fixed-size chunks. When the source ends, any
 * buffered tail is flushed as a final (short) chunk rather than discarded.
 */
export async function* rechunk(
  source: AsyncIterable<Uint8Array>,
  size: number,
): AsyncGenerator<Uint8Array> {
  let buffer: Uint8Array[] = []
  let buffered = 0
  for await (const chunk of source) {
    buffer.push(chunk)
    buffered += chunk.length
    if (buffered >= size) {
      let all = concatBytes(buffer)
      while (all.length >= size) {
        yield all.slice(0, size)
        all = all.slice(size)
      }
      buffer = all.length > 0 ? [all] : []
      buffered = all.length
    }
  }
  if (buffered > 0) yield concatBytes(buffer)
}

export interface BeaconPoll {
  /** Monotone identifier of the round/pulse, used for deduplication. */
  id: number
  bytes: Uint8Array
}

/**
 * Round-aware beacon stream: polls `fetchLatest` on a fixed cadence and
 * yields the payload only when the round/pulse id advances. Public beacons
 * emit a small fixed payload per round, so `chunkBytes` is served via rechunk.
 */
export function beaconStream(
  fetchLatest: (signal?: AbortSignal) => Promise<BeaconPoll>,
  pollIntervalMs: number,
  naturalChunkBytes: number,
  provider: string,
  opts: EntropyStreamOptions = {},
): AsyncIterable<Uint8Array> {
  async function* rounds(): AsyncGenerator<Uint8Array> {
    let lastId = Number.NEGATIVE_INFINITY
    try {
      while (true) {
        const timeoutMs = opts.timeoutMs ?? 10_000
        const timeoutSignal = AbortSignal.timeout(timeoutMs)
        const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal
        const { id, bytes } = await fetchLatest(signal)
        if (id > lastId) {
          lastId = id
          yield bytes
        }
        await sleep(pollIntervalMs, opts.signal)
      }
    } catch (error) {
      if (!(error instanceof EntropyError) && opts.signal?.aborted) {
        throw new EntropyError('aborted', 'stream aborted', { provider, cause: error })
      }
      throw error
    }
  }
  const inner = rounds()
  return opts.chunkBytes && opts.chunkBytes !== naturalChunkBytes
    ? rechunk(inner, opts.chunkBytes)
    : inner
}
