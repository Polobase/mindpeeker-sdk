import { EntropyError } from '../errors.js'
import type { EntropyRequestOptions, EntropyResult, EntropyStreamOptions } from '../types.js'
import { raceSignal } from './abort.js'
import { concatBytes } from './bytes.js'
import { guardStream } from './guard-stream.js'
import { sleep } from './rate-limit.js'

export const DEFAULT_CHUNK_BYTES = 32
/** Default budget of one beacon poll (a single `fetchLatest`), in ms. */
export const DEFAULT_POLL_TIMEOUT_MS = 10_000

interface ByteSource {
  readonly name?: string
  getBytes(length: number, opts?: EntropyRequestOptions): Promise<EntropyResult>
}

/**
 * Default stream implementation: one `getBytes` call per pull. Lazy (no I/O
 * before the first `next()`), backpressured by construction, and it inherits
 * whatever rate limiting and `timeoutMs` handling the underlying `getBytes`
 * applies. A caller abort rejects the pending pull at once with `aborted`.
 */
export function pollStream(
  source: ByteSource,
  opts: EntropyStreamOptions = {},
  defaultChunkBytes: number = DEFAULT_CHUNK_BYTES,
): AsyncIterable<Uint8Array> {
  const chunkBytes = opts.chunkBytes ?? defaultChunkBytes
  const provider = source.name ?? 'stream'
  return {
    [Symbol.asyncIterator]: () =>
      guardStream(
        (signal) => ({
          async *[Symbol.asyncIterator]() {
            const requestOpts: EntropyRequestOptions = { signal, timeoutMs: opts.timeoutMs }
            while (true) {
              const { bytes } = await source.getBytes(chunkBytes, requestOpts)
              yield bytes
            }
          },
        }),
        { provider, signal: opts.signal },
      ),
  }
}

/**
 * Re-slice an inner stream into fixed-size chunks. When the source ends, any
 * buffered tail is flushed as a final (short) chunk rather than discarded.
 * `size` must be an integer ≥ 1 (`EntropyError('invalid_request')` on the
 * first pull otherwise — a size ≤ 0 used to yield empty chunks forever).
 */
export async function* rechunk(
  source: AsyncIterable<Uint8Array>,
  size: number,
): AsyncGenerator<Uint8Array> {
  if (!(Number.isSafeInteger(size) && size >= 1)) {
    throw new EntropyError('invalid_request', `chunk size must be an integer >= 1, got ${size}`)
  }
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

/**
 * Identifier of a beacon round, compared lexicographically: a plain round
 * number, or a tuple such as `[chainIndex, pulseIndex]` for beacons whose
 * round numbers restart with every chain.
 */
export type BeaconId = number | readonly number[]

/** Lexicographic comparison of two beacon ids (numbers compare as 1-tuples). */
export function compareBeaconIds(a: BeaconId, b: BeaconId): number {
  const x = typeof a === 'number' ? [a] : a
  const y = typeof b === 'number' ? [b] : b
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const d = (x[i] as number) - (y[i] as number)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1
}

export interface BeaconPoll {
  /** Monotone identifier of the round/pulse, used for deduplication. */
  id: BeaconId
  bytes: Uint8Array
}

/**
 * Round-aware beacon stream: polls `fetchLatest` every `pollIntervalMs` and
 * yields the payload only when the round id advances (so it yields at most
 * one value per round — rounds published between two polls are skipped).
 *
 * - `timeoutMs` bounds each poll (default 10 000); an expired poll rejects
 *   with `EntropyError('timeout')`.
 * - A caller abort rejects the pending pull at once with `aborted` — also
 *   while waiting between polls — and is checked right after every yield.
 * - Other failures keep their `EntropyError` code; foreign errors become
 *   `network`.
 * - With `chunkBytes` the payloads are always re-sliced to exactly that size
 *   (beacon payload sizes vary by chain and are never assumed).
 */
export function beaconStream(
  fetchLatest: (signal: AbortSignal) => Promise<BeaconPoll>,
  pollIntervalMs: number,
  provider: string,
  opts: EntropyStreamOptions = {},
): AsyncIterable<Uint8Array> {
  const pollTimeoutMs = opts.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS

  async function* rounds(signal: AbortSignal): AsyncGenerator<Uint8Array> {
    let last: BeaconId | undefined
    while (true) {
      const pollTimeout = AbortSignal.timeout(pollTimeoutMs)
      const pollSignal = AbortSignal.any([signal, pollTimeout])
      let poll: BeaconPoll
      try {
        poll = await raceSignal(fetchLatest(pollSignal), pollSignal)
      } catch (error) {
        if (pollTimeout.aborted && !signal.aborted) {
          throw new EntropyError('timeout', `beacon poll exceeded ${pollTimeoutMs}ms`, {
            provider,
            cause: error,
          })
        }
        throw error
      }
      if (last === undefined || compareBeaconIds(poll.id, last) > 0) {
        last = poll.id
        yield poll.bytes
        if (signal.aborted) throw new EntropyError('aborted', 'stream aborted', { provider })
      }
      await sleep(pollIntervalMs, signal)
    }
  }

  const guarded: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => guardStream(rounds, { provider, signal: opts.signal }),
  }
  return opts.chunkBytes !== undefined ? rechunk(guarded, opts.chunkBytes) : guarded
}
