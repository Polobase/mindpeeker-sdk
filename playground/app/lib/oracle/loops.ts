// Chunked cast loops. CLIENT-ONLY (it imports ~/lib/entropy).
//
// Every frequency check runs many casts on ONE shared reader (that is what
// makes the per-cast byte deltas meaningful) and hands the main thread back
// every few milliseconds, so the progress bar paints and Cancel stays live.

import type { EntropyProvider } from '@mindpeeker/entropy'
import type { ByteReader } from '@mindpeeker/oracle'
import { createYielder, throwIfAborted } from '~/lib/async'
import { withReader } from '~/lib/entropy'

export interface RepeatOptions {
  readonly signal: AbortSignal
  readonly setProgress: (value: number | null) => void
  /** Draw from this provider instead of the header-selected source. */
  readonly source?: EntropyProvider | undefined
  /** Chunk hint for the stream: keep it small for network sources. */
  readonly chunkBytes?: number | undefined
}

/**
 * Run `each` `count` times on one shared `ByteReader`, yielding on a budget.
 * The reader is closed on success, failure and cancellation alike.
 *
 * ```ts
 * await repeatCasts(200, async (reader) => {
 *   const cast = await castCowries(reader)
 *   counts[cast.up]++
 * }, { signal, setProgress, source })
 * ```
 */
export async function repeatCasts(
  count: number,
  each: (reader: ByteReader, index: number) => Promise<void>,
  opts: RepeatOptions,
): Promise<{ bytesConsumed: number; bytesFetched: number }> {
  const tick = createYielder(8, opts.signal)
  let bytesConsumed = 0
  let bytesFetched = 0
  await withReader(
    async (reader) => {
      const startConsumed = reader.bytesConsumed
      const startFetched = reader.bytesFetched ?? 0
      for (let i = 0; i < count; i++) {
        throwIfAborted(opts.signal)
        await each(reader, i)
        // Throttled: a progress write per cast would re-render the controls
        // thousands of times for a long run.
        if ((i & 15) === 0 || i === count - 1) opts.setProgress((i + 1) / count)
        await tick()
      }
      bytesConsumed = reader.bytesConsumed - startConsumed
      bytesFetched = (reader.bytesFetched ?? 0) - startFetched
    },
    {
      signal: opts.signal,
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.chunkBytes ? { chunkBytes: opts.chunkBytes } : {}),
    },
  )
  return { bytesConsumed, bytesFetched }
}

/**
 * Pull `count` raw bytes through an oracle `ByteReader`, yielding on a budget —
 * the same reader a cast would use, so the accounting means the same thing.
 */
export async function drawBytes(count: number, opts: RepeatOptions): Promise<Uint8Array> {
  const tick = createYielder(8, opts.signal)
  const out = new Uint8Array(count)
  await withReader(
    async (reader) => {
      for (let i = 0; i < count; i++) {
        out[i] = await reader.next()
        if ((i & 255) === 0) {
          throwIfAborted(opts.signal)
          opts.setProgress((i + 1) / count)
          await tick()
        }
      }
      opts.setProgress(1)
    },
    {
      signal: opts.signal,
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.chunkBytes ? { chunkBytes: opts.chunkBytes } : {}),
    },
  )
  return out
}

/**
 * Chunk hint for a bulk run: a big chunk for local sources (fewer round trips
 * through the provider), the cast default for anything on the network, where a
 * large request would fetch dozens of beacon rounds in one blocking call.
 */
export function bulkChunkBytes(network: boolean): number | undefined {
  return network ? undefined : 4096
}
