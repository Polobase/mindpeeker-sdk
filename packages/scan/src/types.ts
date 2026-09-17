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
 *
 * Every entry point opens **one** stream per call and closes it (iterator
 * `return()`, so the source's `finally` runs) when the call completes, fails,
 * or is aborted — and, for `broadcast`, when the consumer stops iterating.
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
 * - `bitsUsed` — bits that entered a random decision. A byte-level
 *   `uniformInt` draw of $k$ bytes spends $8k$ bits (rejected attempts
 *   included — rejection *spends* entropy); a fair coin of the deviation model
 *   spends exactly one bit (eight coins per byte); a tripolar trial spends
 *   `bitsPerTrial` bits. Bits left over in the last, partly used byte of a
 *   phase entered no decision and are not counted, so
 *   `bitsUsed` $\le 8 \cdot$ `bytesConsumed`.
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
  /** Stable identifier, unique within its catalog; defaults to `name` when unset. */
  readonly id?: string
  /** Human-readable label (unique within its category). */
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
 * What kind of link a witness is, in the vocabulary of the radionics
 * literature: a physical `sample` (blood spot, hair, saliva), a `photograph`,
 * a `signature` (Abrams claimed handwriting diagnosis in 1923), a written
 * `name`, map `coordinates`, "charged" `water`, a `symbol`, or `other`.
 * Recorded on the receipt as metadata; it never changes the derived rate.
 */
export type WitnessKind =
  | 'sample'
  | 'photograph'
  | 'signature'
  | 'name'
  | 'coordinates'
  | 'water'
  | 'symbol'
  | 'other'

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
  /** What the witness is. Default `'signature'` when `signature` is set, else `'name'`. */
  readonly kind?: WitnessKind
}

/** Per-item chance-deviation statistics — the honest null-model readout. */
export interface DeviationResult {
  /** One-bits ("scores") counted for this item over `rounds` rounds. */
  readonly successes: number
  /** Rounds the item was measured over (its Bernoulli trial count). */
  readonly rounds: number
  /**
   * $z = (k - N p_0)/\sqrt{N p_0 (1 - p_0)}$ with $p_0 = \tfrac12$ — a
   * descriptive effect size, only *asymptotically* standard normal (the count
   * is discrete). Not used for `p`.
   */
  readonly z: number
  /**
   * Exact two-sided p-value under $K \sim \mathrm{Binomial}(N, \tfrac12)$:
   * $P(|K - N/2| \ge |k - N/2|)$ — never anti-conservative, at any $N$.
   */
  readonly p: number
  /** $\ln BF_{10}$ against $p_0 = \tfrac12$ — finite at any $N$; ranks use this. */
  readonly lnBayesFactor: number
  /**
   * $BF_{10} = e^{\ln BF_{10}}$ (rounds to `Infinity` past $\ln BF_{10} > 709.78$).
   * Under a fair source $E[BF_{10}] = 1$, but the typical value is well below 1
   * (median ≈ 0.095 at $N = 256$ with the Beta(1, 1) prior: the factor
   * *supports* the null); only a biased item drives it far above 1.
   */
  readonly bayesFactor: number
}

/** A {@link DeviationResult} inside a family of item tests, with multiplicity-adjusted p-values. */
export interface AdjustedDeviationResult extends DeviationResult {
  /** Bonferroni: $\min(1, M p)$ over the family of $M$ tests. */
  readonly pBonferroni: number
  /** Holm's step-down adjusted p (strong family-wise error control). */
  readonly pHolm: number
  /** Benjamini–Hochberg adjusted p ("q-value"; false discovery rate). */
  readonly qBH: number
}

/** The omnibus "is anything off at all?" test of a scan. */
export interface OmnibusTest {
  /** $S = \sum_i z_i^2$ over the family. */
  readonly statistic: number
  /** $M$: under a fair source $S \approx \chi^2(M)$ (de Moivre–Laplace; slightly conservative). */
  readonly df: number
  /** Upper tail $P(\chi^2_M \ge S)$. A small value flags the *source*, not an item. */
  readonly p: number
}

/** Multiplicity bookkeeping for one family of per-item deviation tests. */
export interface MultiplicitySummary {
  /** $M$, the number of item tests in the family. */
  readonly tests: number
  /** The family level $\alpha$ the counts below use. */
  readonly alpha: number
  /** $\alpha / M$, the Bonferroni per-test level. */
  readonly bonferroniAlpha: number
  /** $M \alpha$: how many unadjusted $p \le \alpha$ a fair source produces on average. */
  readonly expectedFalsePositives: number
  /** Items with unadjusted $p \le \alpha$. */
  readonly nominalHits: number
  /** Items with Holm-adjusted $p \le \alpha$. */
  readonly holmRejections: number
  /** Items with BH-adjusted $q \le \alpha$. */
  readonly bhRejections: number
  readonly omnibus: OmnibusTest
}

/** One ranked scan result. */
export interface ScanResult {
  /** The catalog item's id (`id ?? name`) — maps the row back to its item. */
  readonly id: string
  readonly name: string
  readonly category?: string
  /**
   * Race energy normalised to $[0, 1]$ — the item's final EV over the winner's
   * EV. Present when the mode ran the race.
   */
  readonly energy?: number
  /**
   * EV increments this item received in the race (modes `'race'`/`'both'`), or
   * its deviation rounds (mode `'deviation'`, `scanDeviation`, `scanTripolar`).
   */
  readonly trials?: number
  /** General Vitality (GV) — best-of-three 0..1000 with the >950 explosion. */
  readonly vitality?: number
  /**
   * $P(\mathrm{GV} \ge \texttt{vitality})$ for a fair source — the exact chance
   * rate of a value at least this high (see `generalVitalitySf`).
   */
  readonly vitalityP?: number
  /** Chance-deviation statistics. Present when the mode ran the deviation model. */
  readonly deviation?: AdjustedDeviationResult
  /** 1-based rank (1 = strongest) in the report ordering. */
  readonly rank: number
}

/** Which scan machinery to run. */
export type ScanMode = 'race' | 'deviation' | 'both'

/** Options for {@link ScanReport}-producing scans. */
export interface ScanOptions {
  /** EV threshold a racing item must reach to win; finite, ≥ 1. Default 100 (AetherOnePi; 1000 in its "very high" setting). */
  maxValue?: number
  /** Share of the catalog raced, in $(0, 1]$. Default 0.1 (AetherOnePi's size/10). */
  subsetFraction?: number
  /** Lower clamp of the raced subset size (integer ≥ 1). Default 120 (AetherOnePi). */
  subsetMin?: number
  /** Upper clamp of the raced subset size (integer ≥ `subsetMin`, or `Infinity`). Default 5000 (AetherOnePi). */
  subsetMax?: number
  /** `'race'`, `'deviation'`, or `'both'` (default). */
  mode?: ScanMode
  /** Compute per-item General Vitality. Default true. */
  withVitality?: boolean
  /** Rounds for the deviation model (each item's Bernoulli trial count); integer ≥ 1. Default 256. */
  deviationRounds?: number
  /** Beta prior for the deviation Bayes factor (finite shapes > 0). Default Beta(1, 1). */
  prior?: BetaPrior
  /** Family level for the multiplicity summary, in $(0, 1)$. Default 0.05. */
  alpha?: number
  signal?: AbortSignal
}

/** A complete, reproducible scan. */
export interface ScanReport {
  /** The scanned catalog's id. */
  readonly catalog: string
  readonly mode: ScanMode
  /** Ranked results (race energy first, else deviation log Bayes factor). */
  readonly results: readonly ScanResult[]
  /**
   * Race passes over the subset until a winner (0 when no race ran). AetherOnePi's
   * own `numberOfTrials` counts EV increments instead — the sum of `trials`.
   */
  readonly numberOfTrials: number
  /** Multiplicity over the scored items; present when the deviation model ran. */
  readonly multiplicity?: MultiplicitySummary
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
  /** Rounds each item is measured over; integer ≥ 1. Default 256. */
  rounds?: number
  /** Beta prior for the Bayes factor (finite shapes > 0). Default Beta(1, 1). */
  prior?: BetaPrior
  /** Family level for the multiplicity summary, in $(0, 1)$. Default 0.05. */
  alpha?: number
  signal?: AbortSignal
}

/** A standalone deviation report over a full catalog. */
export interface DeviationReport {
  readonly catalog: string
  /** Per-item results, ranked by log Bayes factor descending. */
  readonly results: readonly (ScanResult & { readonly deviation: AdjustedDeviationResult })[]
  /** The null probability each item was tested against ($\tfrac12$). */
  readonly p0: number
  /** Multiplicity over the $M$ item tests. */
  readonly multiplicity: MultiplicitySummary
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
  /** Stop after this many rounds (integer ≥ 0). Default 100 when neither `rounds` nor `durationMs` is set. */
  rounds?: number
  /** Stop after this many wall-clock milliseconds (finite, ≥ 0; uses `now`). */
  durationMs?: number
  /** Bytes modulated per round; integer in $[k, 2^{24}]$ with $k$ the bytes one resonance draw reads ($\lceil \log_{256} \texttt{resonanceOdds} \rceil$). Default 16. */
  roundBytes?: number
  /** Resonance is tallied when `uniformInt(round, resonanceOdds)` hits `resonanceValue`; integer in $[1, 2^{48}]$. Default 6765 (AetherOne / Fibonacci). */
  resonanceOdds?: number
  /** The value that counts as resonance; integer in `[0, resonanceOdds)`. Default `resonanceOdds - 1` (the top value). */
  resonanceValue?: number
  signal?: AbortSignal
  /** Clock override for deterministic `durationMs` tests and receipt timestamps. */
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
 * The JSONL broadcast receipt — emitted as the async generator's return value.
 * Keys serialize in exactly this order so records round-trip byte-exact:
 * v2 `{"v":2,"t","mode","target","witnessKind"?,"witnessHash"?,"bytesConsumed","resonances","rounds","outputHash"}`;
 * legacy v1 `{"v":1,"t","target","witnessHash"?,"bytesConsumed","resonances","rounds"}`
 * (parsed, never emitted).
 */
export interface BroadcastReceipt {
  /** Schema version: 2 for receipts this version emits; 1 for parsed 0.1 receipts. */
  readonly v: 1 | 2
  /** Epoch ms the broadcast ended. */
  readonly t: number
  /** Modulation mode (v2). */
  readonly mode?: BroadcastMode
  /** The target rate, formatted (`formatRate`). */
  readonly target: string
  /** The witness kind, when the target was a witness or signature (v2). */
  readonly witnessKind?: WitnessKind
  /** SHA-256 hex of the NFC-normalized witness signature (or name), when the target was a witness/signature. */
  readonly witnessHash?: string
  readonly bytesConsumed: number
  readonly resonances: number
  readonly rounds: number
  /** SHA-256 hex of every yielded tick's `modulated` bytes, concatenated in order (v2). */
  readonly outputHash?: string
}

/** Options for {@link signatureToRate}. */
export interface SignatureOptions {
  /** Number of rate digits produced; integer in $[1, 4096]$. Default 6. */
  length?: number
  /** Rate base; integer in $[2, 2^{32}]$. Default 44. */
  base?: number
}
