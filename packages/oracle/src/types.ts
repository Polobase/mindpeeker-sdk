/**
 * Minimal structural view of a live byte source. Any `@mindpeeker/entropy`
 * provider satisfies this shape — the packages share a shape, not code.
 */
export interface ByteSource {
  readonly name: string
  stream(opts?: ByteStreamOptions): AsyncIterable<Uint8Array>
}

export interface ByteStreamOptions {
  signal?: AbortSignal
  /** Desired chunk size in bytes. Passed through to the source. */
  chunkBytes?: number
}

/**
 * Anything a cast can consume entropy from:
 *
 * - `Uint8Array` / `ArrayLike<number>` — a finite recorded batch (each value
 *   must be an integer in $[0, 255]$)
 * - `AsyncIterable<Uint8Array>` — a raw chunk stream
 * - {@link ByteSource} — a named live source (`stream()` is invoked lazily
 *   on the first byte pulled)
 *
 * Determinism guarantee: the same byte sequence always produces the exact
 * same reading — casts are pure functions of their input bytes.
 */
export type OracleInput = Uint8Array | ArrayLike<number> | AsyncIterable<Uint8Array> | ByteSource

/**
 * Honest entropy accounting attached to every cast result.
 *
 * - `bytesConsumed` — raw bytes pulled from the input during the cast,
 *   including bytes discarded by rejection sampling and buffered bits that
 *   were never handed out.
 * - `bitsUsed` — bits that actually entered a random decision: $8k$ per
 *   byte-level draw of $k$ bytes (rejected draws included — rejection
 *   *spends* entropy) plus the exact bit count of every bit-level draw.
 *
 * Always `bitsUsed` $\le$ `8 \cdot` `bytesConsumed`; the difference is
 * buffered bit padding at the end of a cast.
 */
export interface EntropyAccounting {
  readonly bytesConsumed: number
  readonly bitsUsed: number
}
