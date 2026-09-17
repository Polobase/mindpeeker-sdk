/**
 * What kind of physical (or algorithmic) process the randomness comes from:
 * quantum (`qrng`), classical physical noise (`trng`), a public randomness
 * beacon (`beacon`), an algorithm (`csprng`), or a composite whose members
 * differ (`mixed`).
 */
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
  /** Abort the call; it rejects with `EntropyError('aborted')`. */
  signal?: AbortSignal
  /**
   * Budget for the whole call including internal chunking/retries: finite,
   * 0 < ms ≤ 2³¹ − 1 (`invalid_request` otherwise). Default 10_000 (some
   * providers use more).
   */
  timeoutMs?: number
}

/**
 * Public metadata of one beacon round (drand round, NIST-family pulse, CURBy
 * pulse, block level, slot or epoch) whose value contributed bytes to a
 * result — enough to fetch the same round again with `getRound` and audit it.
 */
export interface BeaconRound {
  /**
   * Round number within its chain: drand round, NIST-family `pulseIndex`,
   * CURBy pulse index, Tezos block level, Solana slot or Ethereum epoch.
   */
  readonly round: number
  /** Chain index, for beacons that restart numbering per chain (NIST IR 8213 family). */
  readonly chain?: number
  /**
   * Publication time in ms since the Unix epoch: as stated by the beacon, or
   * derived from the chain's genesis time and period (drand).
   */
  readonly timestamp?: number
  /**
   * The round's signature exactly as served (hex for drand and the NIST
   * family, a compact JWS for CURBy). Only checked when the provider's
   * `verify` option says so.
   */
  readonly signature?: string
}

/** Attribution of a result: the source's identity plus, for beacons, the rounds used. */
export interface EntropySourceAttribution extends EntropySourceInfo {
  /** Beacon rounds whose values make up the bytes, in byte order. */
  readonly rounds?: readonly BeaconRound[]
}

export interface EntropyResult {
  /** Exactly as many bytes as requested. */
  bytes: Uint8Array
  /**
   * Provider(s) that actually contributed bytes to this result. Beacons attach
   * the `rounds` they used.
   */
  sources: readonly EntropySourceAttribution[]
}

export interface EntropyStreamOptions extends EntropyRequestOptions {
  /**
   * Desired chunk size in bytes (integer ≥ 1). Default: the provider's
   * natural chunk size. For streams, `timeoutMs` bounds each pull rather than
   * the stream's lifetime.
   */
  chunkBytes?: number
}

export interface EntropyProvider extends EntropySourceInfo {
  /** Resolve with exactly `length` bytes or throw `EntropyError`. Never partial. */
  getBytes(length: number, opts?: EntropyRequestOptions): Promise<EntropyResult>
  /**
   * Lazy, pull-based. No I/O before the first `next()`. Ends via
   * `return()`/abort; invalid options reject the first pull with
   * `invalid_request`.
   */
  stream(opts?: EntropyStreamOptions): AsyncIterable<Uint8Array>
}

export interface BeaconRoundOptions extends EntropyRequestOptions {
  /**
   * Chain to read from — NIST IR 8213 beacons only (integer ≥ 1; other
   * beacons reject it with `invalid_request`). Default: the chain of the
   * latest pulse.
   */
  chain?: number
}

export interface BeaconRoundResult extends EntropyResult {
  /** The round that was fetched (also listed in `sources[0].rounds`). */
  readonly round: BeaconRound
}

/** A public beacon whose historical rounds can be fetched by number. */
export interface BeaconProvider extends EntropyProvider {
  /**
   * Fetch one round by number. `bytes` is the round's full value (e.g. 64
   * bytes for a NIST pulse, 32 for drand). A round number that is not an
   * integer in range rejects with `invalid_request`; a server answering with
   * a different round rejects with `bad_response`. Same timeout and abort
   * semantics as `getBytes`.
   */
  getRound(round: number, opts?: BeaconRoundOptions): Promise<BeaconRoundResult>
}
