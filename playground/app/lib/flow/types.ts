// Shared types for the "Information flow" page. No SDK import, so every file
// that only needs a shape stays cheap.

/** The coupled-processes lab: one draw shared by sections 1–3 and 5. */
export interface LabParams {
  /** Samples (binary symbols) per series. */
  n: number
  /** Y copies X from `lag` steps back (the planted interaction delay). */
  lag: number
  /** Probability that Y copies X, in percent. */
  coupling: number
  /** Probability that the copied bit is flipped, in percent. */
  noise: number
  /** Strength of the common driver Z on both series, in percent (0 = off). */
  driver: number
  /** Destination history. */
  k: number
  /** Source history. */
  l: number
  /** Miller–Madow bias correction on every entropy term. */
  millerMadow: boolean
}

export interface DrawInfo {
  /** Provider that actually produced the bytes, e.g. `fallback(drand, crypto)`. */
  readonly providerName: string
  /** Source id from the header picker. */
  readonly sourceId: string
  readonly sourceLabel: string
  /** Bytes requested from the source. */
  readonly bytes: number
  /** Bits of the draw used as X's own symbols. */
  readonly sourceBits: number
  /** Seed handed to `xoshiro128ss` for the construction's coin flips. */
  readonly seed: number
  /** `true` for the reproducible DRBG / jitter-free sources. */
  readonly deterministic: boolean
  readonly elapsedMs: number
}

export interface LabSeries {
  readonly x: Uint8Array
  readonly y: Uint8Array
  readonly z: Uint8Array
  /** The parameters this draw was built with (a snapshot, not the live object). */
  readonly params: LabParams
  readonly draw: DrawInfo
}

/** Everything a section needs to name the embedding it measured. */
export interface Embedding {
  readonly k: number
  readonly l: number
  readonly lag: number
}

export const SURROGATE_METHODS = [
  'shuffle',
  'circularShift',
  'embeddingShuffle',
  'blockShuffle',
  'stationaryBootstrap',
  'markov',
] as const

export type SurrogateMethodName = (typeof SURROGATE_METHODS)[number]

/** What each null keeps and destroys — from the flow README's surrogate table. */
export const SURROGATE_NOTES: Record<SurrogateMethodName, { keeps: string; destroys: string }> = {
  shuffle: {
    keeps: 'the marginal p(x)',
    destroys: 'all temporal structure (also inside xᵗ for l > 1)',
  },
  circularShift: {
    keeps: 'all autocorrelation (up to wraparound)',
    destroys: 'alignment with the destination — only n−1 distinct surrogates exist',
  },
  embeddingShuffle: {
    keeps: 'the embedded source vectors xᵗ (JIDT’s convention)',
    destroys: 'their order across tuples',
  },
  blockShuffle: {
    keeps: 'the multiset and the structure inside each block',
    destroys: 'structure across block boundaries',
  },
  stationaryBootstrap: {
    keeps: 'short-range dependence and stationarity (Politis–Romano)',
    destroys: 'the multiset — it resamples with replacement',
  },
  markov: {
    keeps: 'the order-m transition structure, in distribution',
    destroys: 'longer memory and cross-alignment',
  },
}

/**
 * Keep a numeric control numeric. A `USelect` hands back the item's `value`
 * as-is, and a stray string would quietly turn arithmetic into concatenation.
 */
export function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
