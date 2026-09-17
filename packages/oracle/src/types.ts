/**
 * Minimal structural view of a live byte source. Any `@mindpeeker/entropy`
 * provider satisfies this shape — the packages share a shape, not code.
 */
export interface ByteSource {
  readonly name: string
  stream(opts?: ByteStreamOptions): AsyncIterable<Uint8Array>
}

/**
 * Options a reader passes to `stream()`. Contract for sources: honour
 * `signal` (throwing *or* returning on abort — readers report `'aborted'`
 * either way), and release resources when the iterator's `return()` is
 * called; readers call it exactly once when closed.
 */
export interface ByteStreamOptions {
  signal?: AbortSignal
  /**
   * Desired chunk size in bytes — a hint the source may ignore. Forwarded
   * from `ByteReaderOptions.chunkBytes`; casts request 32 by default.
   */
  chunkBytes?: number
}

/**
 * Anything a cast can consume entropy from:
 *
 * - `Uint8Array` / `ArrayLike<number>` — a finite recorded batch (each value
 *   must be an integer in $[0, 255]$)
 * - `AsyncIterable<Uint8Array>` — a raw chunk stream, consumed like
 *   `for await` (closing the reader calls its iterator's `return()`)
 * - {@link ByteSource} — a named live source (`stream()` is invoked lazily
 *   on the first byte pulled; checked before the AsyncIterable shape)
 *
 * Determinism guarantee: the same byte sequence always produces the exact
 * same reading — casts are pure functions of their input bytes.
 */
export type OracleInput = Uint8Array | ArrayLike<number> | AsyncIterable<Uint8Array> | ByteSource

/**
 * Honest entropy accounting attached to every cast result.
 *
 * - `bytesConsumed` — bytes the cast read from its reader, including bytes
 *   discarded by rejection sampling and buffered bits that were never
 *   handed out. This is what a replay needs.
 * - `bytesFetched` — bytes the reader pulled out of the underlying input
 *   during the cast, including the unread rest of the last chunk: for a
 *   live source, what it actually delivered (and what a metered provider
 *   bills). Equal to `bytesConsumed` for batch inputs; on a shared reader it
 *   can be smaller (bytes buffered by an earlier cast). Absent when the
 *   reader does not track it.
 * - `bitsUsed` — bits that actually entered a random decision: $8k$ per
 *   byte-level draw of $k$ bytes (rejected draws included — rejection
 *   *spends* entropy) plus the exact bit count of every bit-level draw.
 *
 * Always `bitsUsed` $\le$ `8 \cdot` `bytesConsumed`; the difference is
 * buffered bit padding at the end of a cast.
 */
export interface EntropyAccounting {
  readonly bytesConsumed: number
  readonly bytesFetched?: number
  readonly bitsUsed: number
}
