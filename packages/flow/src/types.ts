/**
 * Minimal structural view of a live byte source. Any `@mindpeeker/entropy`
 * provider satisfies this — the packages share a shape, not code. Bits are
 * MSB-first SDK-wide when bytes are expanded to bits.
 */
export interface ByteSource {
  readonly name: string
  stream(opts?: ByteStreamOptions): AsyncIterable<Uint8Array>
}

/** Options forwarded to a {@link ByteSource}'s `stream()`. */
export interface ByteStreamOptions {
  signal?: AbortSignal
  /** Desired chunk size in bytes. Passed through to the source. */
  chunkBytes?: number
}

/**
 * Anything {@link pairStreams} can consume as one side of a lock-step pair:
 * an (a)sync iterable of symbols and/or byte chunks (bytes enter as their
 * numeric values 0–255), or a live {@link ByteSource}.
 */
export type SymbolStreamInput =
  | AsyncIterable<number | Uint8Array>
  | Iterable<number | Uint8Array>
  | ByteSource
