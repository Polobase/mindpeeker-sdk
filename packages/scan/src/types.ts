import type { BetaPrior } from '@mindpeeker/psi'
import type { Rate } from '@mindpeeker/rate'

/**
 * Structural view of a live byte source — identical shape to
 * `@mindpeeker/entropy`'s provider, `@mindpeeker/oracle`'s `ByteSource`,
 * `@mindpeeker/rate`'s `ByteSource`, and `@mindpeeker/negentropy`'s
 * `TrialSource`, imported by none of them. Any of those satisfies this. So one
 * `serialEntropy()` / `cameraEntropy()` / `anu()` / `cryptoProvider()`
 * instance drops into a scan, a rate modulation, and a psi trial extraction
 * with no adapter — the seam this whole package is built on.
 */
export interface ByteSource {
  readonly name: string
  stream(opts?: ByteStreamOptions): AsyncIterable<Uint8Array>
}

export interface ByteStreamOptions {
  signal?: AbortSignal
  /** Desired chunk size in bytes; passed through to the source. */
  chunkBytes?: number
}

/**
 * Honest entropy accounting for a scan or broadcast — the reproducibility
 * receipt AetherOne never kept.
 *
 * - `bytesConsumed` — raw bytes pulled from the source, including bytes
 *   discarded by `uniformInt`'s rejection sampling.
 * - `bitsUsed` — bits that entered a random decision. Every draw in this
 *   package is a byte-level `uniformInt`, so a draw of $k$ bytes spends $8k$
 *   bits (rejected attempts included — rejection *spends* entropy), and
 *   therefore `bitsUsed` $= 8 \cdot$ `bytesConsumed` exactly.
 */
export interface EntropyAccounting {
  readonly bytesConsumed: number
  readonly bitsUsed: number
}

/**
 * One catalog entry — a "rate" in AetherOne's vocabulary: a remedy, element,
 * organ, symbol, or intention the scan ranks. `rate` is the optional radionic
 * code; the scan ranks by chance dynamics over the *item set*, so an item
 * needs only a `name`.
 */
export interface CatalogItem {
  /** Stable identifier; defaults to `name` when unset. */
  readonly id?: string
  /** Human-readable label. */
  readonly name: string
  /** Optional grouping (AetherOne's rate "category"). */
  readonly category?: string
  /** Optional radionic rate code. */
  readonly rate?: Rate
}

/** A named rate book / remedy list the scan ranks against. */
export interface Catalog {
  readonly id: string
  readonly name: string
  readonly items: readonly CatalogItem[]
}

/**
 * A **witness**: the sample that links instrument to subject in radionic
 * practice (a hair, a photo, a signature). Here it is purely a broadcast
 * target descriptor — one of `rate` or `signature` must be present.
 */
export interface Witness {
  readonly name?: string
  /** A string signature hashed to a rate when `rate` is absent. */
  readonly signature?: string
  /** An explicit radionic rate. */
  readonly rate?: Rate
}

/** Per-item chance-deviation statistics — the honest null-model readout. */
export interface DeviationResult {
  /** One-bits ("scores") counted for this item over `rounds` rounds. */
  readonly successes: number
  /** Rounds the item was measured over (its Bernoulli trial count). */
  readonly rounds: number
  /**
   * $z = (k - N p_0)/\sqrt{N p_0 (1 - p_0)}$ with $p_0 = \tfrac12$; standard
   * normal under a fair source.
   */
  readonly z: number
  /** Two-sided normal-tail p-value $2\,\Phi(-|z|)$. */
  readonly p: number
  /**
   * $BF_{10}$ against the chance null $p_0 = \tfrac12$ (see
   * `binomialBayesFactor`). $\approx 1$ under a fair source; large only for a
   * genuinely biased item.
   */
  readonly bayesFactor: number
}

/** One ranked scan result. */
export interface ScanResult {
  readonly name: string
  readonly category?: string
  /**
   * Race energy normalised to $[0, 1]$ — the item's final EV over the winner's
   * EV. Present when the mode ran the race.
   */
  readonly energy?: number
  /** Number of EV increments this item received in the race. */
  readonly trials?: number
  /** General Vitality (GV) — best-of-three 0..1000 with the >950 explosion. */
  readonly vitality?: number
  /** Chance-deviation statistics. Present when the mode ran the deviation model. */
  readonly deviation?: DeviationResult
  /** 1-based rank (1 = strongest) in the report ordering. */
  readonly rank: number
}

/** Which scan machinery to run. */
export type ScanMode = 'race' | 'deviation' | 'both'

/** Options for {@link ScanReport}-producing scans. */
export interface ScanOptions {
  /** EV threshold a racing item must cross to win. Default 100 (AetherOne "high" = 1000). */
  maxValue?: number
  /** Fraction of the catalog raced, clamped to `[min(12, size), size]`. Default 0.1. */
  subsetFraction?: number
  /** `'race'`, `'deviation'`, or `'both'` (default). */
  mode?: ScanMode
  /** Compute per-item General Vitality. Default true. */
  withVitality?: boolean
  /** Rounds for the deviation model (each item's Bernoulli trial count). Default 256. */
  deviationRounds?: number
  /** Beta prior for the deviation Bayes factor. Default Beta(1, 1). */
  prior?: BetaPrior
  signal?: AbortSignal
}

/** A complete, reproducible scan. */
export interface ScanReport {
  /** The scanned catalog's id. */
  readonly catalog: string
  readonly mode: ScanMode
  /** Ranked results (race energy first, else deviation Bayes factor). */
  readonly results: readonly ScanResult[]
  /** Race passes to a winner (AetherOne's `numberOfTrials`); 0 when no race ran. */
  readonly numberOfTrials: number
  /** The source name. */
  readonly source: string
  readonly accounting: EntropyAccounting
}

/** Options for {@link EntropyAccounting}-carrying `generalVitality`. */
export interface VitalityOptions {
  signal?: AbortSignal
}

/** Options for the standalone deviation scan. */
export interface DeviationOptions {
  /** Rounds each item is measured over. Default 256. */
  rounds?: number
  /** Beta prior for the Bayes factor. Default Beta(1, 1). */
  prior?: BetaPrior
  signal?: AbortSignal
}

/** A standalone deviation report over a full catalog. */
export interface DeviationReport {
  readonly catalog: string
  /** Per-item results, ranked by Bayes factor descending. */
  readonly results: readonly (ScanResult & { readonly deviation: DeviationResult })[]
  /** The null probability each item was tested against ($\tfrac12$). */
  readonly p0: number
  readonly source: string
  readonly accounting: EntropyAccounting
}

/** How a broadcast rewrites the entropy stream by the target rate. */
export type BroadcastMode =
  | 'xor' // reversible XOR by the rate mask (rate.xorImprint semantics)
  | 'phase' // quantized phase rotation (rate.phaseModulate)
  | 'mask' // the pure rate mask keystream (rate.rateMask), data discarded

/** Options for {@link broadcast}. */
export interface BroadcastOptions {
  /** Modulation mode. Default `'xor'` (reversible). */
  mode?: BroadcastMode
  /** Stop after this many rounds. Default 100 when neither `rounds` nor `durationMs` is set. */
  rounds?: number
  /** Stop after this many wall-clock milliseconds (uses `now`). */
  durationMs?: number
  /** Bytes modulated per round. Default 16. */
  roundBytes?: number
  /** Resonance is tallied when `uniformInt(reader, resonanceOdds)` hits `resonanceValue`. Default 6765 (AetherOne / Fibonacci). */
  resonanceOdds?: number
  /** The value that counts as resonance. Default `resonanceOdds - 1` (the top value, AetherOne parity). */
  resonanceValue?: number
  signal?: AbortSignal
  /** Clock override for deterministic `durationMs` tests. */
  now?: () => number
}

/** One broadcast round. */
export interface BroadcastTick {
  /** 0-based round index. */
  readonly round: number
  /** Whether a resonance event fired this round. */
  readonly resonance: boolean
  /** The round's entropy after modulation by the target rate. */
  readonly modulated: Uint8Array
}

/**
 * The JSONL v1 broadcast receipt — emitted as the async generator's return
 * value. Keys serialize in exactly this order so records round-trip
 * byte-exact: `{"v":1,"t":…,"target":…,"witnessHash":…,"bytesConsumed":…,"resonances":…,"rounds":…}`.
 */
export interface BroadcastReceipt {
  /** Schema version. Always 1. */
  readonly v: 1
  /** Epoch ms the broadcast ended. */
  readonly t: number
  /** The target rate, formatted (`formatRate`). */
  readonly target: string
  /** SHA-256 hex of the witness signature, when the target was a witness/signature. */
  readonly witnessHash?: string
  readonly bytesConsumed: number
  readonly resonances: number
  readonly rounds: number
}

/** Options for {@link signatureToRate}. */
export interface SignatureOptions {
  /** Number of rate digits produced. Default 6. */
  length?: number
  /** Rate base. Default 44. */
  base?: number
}
