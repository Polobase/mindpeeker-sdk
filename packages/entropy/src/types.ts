/** What kind of physical (or algorithmic) process the randomness comes from. */
export type EntropyKind = 'qrng' | 'trng' | 'beacon' | 'csprng' | 'mixed'

/**
 * Whether the randomness is served privately to the caller or published for
 * everyone. `public` sources (beacons) must NEVER seed secrets on their own —
 * everyone in the world sees the same bytes.
 */
export type EntropyPrivacy = 'private' | 'public'

/** Static identity + classification of an entropy source. */
export interface EntropySourceInfo {
  readonly name: string
  readonly kind: EntropyKind
  readonly privacy: EntropyPrivacy
}

export interface EntropyRequestOptions {
  signal?: AbortSignal
  /** Budget for the whole call including internal chunking/retries. Default 10_000. */
  timeoutMs?: number
}

export interface EntropyResult {
  /** Exactly as many bytes as requested. */
  bytes: Uint8Array
  /** Provider(s) that actually contributed bytes to this result. */
  sources: readonly EntropySourceInfo[]
}

export interface EntropyStreamOptions extends EntropyRequestOptions {
  /** Desired chunk size in bytes. Default: the provider's natural chunk size. */
  chunkBytes?: number
}

export interface EntropyProvider extends EntropySourceInfo {
  /** Resolve with exactly `length` bytes or throw `EntropyError`. Never partial. */
  getBytes(length: number, opts?: EntropyRequestOptions): Promise<EntropyResult>
  /** Lazy, pull-based. No I/O before the first `next()`. Ends via `return()`/abort. */
  stream(opts?: EntropyStreamOptions): AsyncIterable<Uint8Array>
}
