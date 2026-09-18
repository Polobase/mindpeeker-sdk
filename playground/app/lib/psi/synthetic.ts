// Shared helpers for the psi page. CLIENT-ONLY: it imports ~/lib/entropy (and
// through it @mindpeeker/*), so only `Psi*.client.vue` components may import it.
//
// Everything here is either plain arithmetic on trial sums or a thin wrapper
// around the entropy accessors. No statistic is computed here that the SDK
// already owns — the components call @mindpeeker/psi for those.

import type { TrialSeries } from '@mindpeeker/psi'
import { drbgSource, localBytes } from '~/lib/entropy'

const POPCOUNT = /* @__PURE__ */ (() => {
  const table = new Uint8Array(256)
  for (let i = 0; i < 256; i++) table[i] = (table[i >> 1] as number) + (i & 1)
  return table
})()

/** Where a simulation panel's bytes come from (never a network source). */
export type SimSource = 'drbg' | 'crypto'

/**
 * Bytes for a simulation panel: the seeded DRBG (same seed ⇒ same figures) or
 * the browser CSPRNG (fresh every run). Both are local, so a 50 kB draw costs
 * nothing and no beacon is hammered for synthetic data.
 */
export async function simBytes(
  n: number,
  source: SimSource,
  seedLabel: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (source === 'crypto') return localBytes(n, signal ? { signal } : {})
  const result = await drbgSource(seedLabel).getBytes(n, signal ? { signal } : {})
  return result.bytes
}

/** Bytes needed for `trials` trials of `bitsPerTrial` bits. */
export function bytesFor(trials: number, bitsPerTrial: number): number {
  return Math.ceil((trials * bitsPerTrial) / 8)
}

/**
 * One trial sum per `bitsPerTrial` consecutive bits, MSB-first — the same
 * grouping negentropy's `trialStream` applies to a live source.
 */
export function sumsFromBytes(bytes: Uint8Array, bitsPerTrial: number): Float64Array {
  const perTrial = bitsPerTrial / 8
  if (!Number.isInteger(perTrial)) throw new Error('bitsPerTrial must be a multiple of 8 here')
  const trials = Math.floor(bytes.length / perTrial)
  const sums = new Float64Array(trials)
  for (let t = 0; t < trials; t++) {
    let sum = 0
    const start = t * perTrial
    for (let i = 0; i < perTrial; i++) sum += POPCOUNT[bytes[start + i] as number] as number
    sums[t] = sum
  }
  return sums
}

export interface SeriesOptions {
  bitsPerTrial: number
  /** Epoch ms of the first trial. */
  t0: number
  /** Milliseconds between trials (GCP records at 1 Hz). */
  stepMs?: number
}

/** A `TrialSeries` with one timestamp per trial, as a lock-step recording has. */
export function makeSeries(source: string, sums: Float64Array, opts: SeriesOptions): TrialSeries {
  const stepMs = opts.stepMs ?? 1000
  const timestamps = new Float64Array(sums.length)
  for (let i = 0; i < sums.length; i++) timestamps[i] = opts.t0 + i * stepMs
  return { source, bitsPerTrial: opts.bitsPerTrial, sums, timestamps }
}

/** z = (x − k/2)/√(k/4), the exact Binomial(k, ½) standardization. */
export function trialZ(sum: number, bitsPerTrial: number): number {
  return (sum - bitsPerTrial / 2) / Math.sqrt(bitsPerTrial / 4)
}

export function zScores(sums: ArrayLike<number>, bitsPerTrial: number): Float64Array {
  const out = new Float64Array(sums.length)
  for (let i = 0; i < sums.length; i++) out[i] = trialZ(sums[i] as number, bitsPerTrial)
  return out
}

/** Running Stouffer z: `cumsum(z)/√n` — what a live tripolar readout shows. */
export function cumulativeStouffer(zs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(zs.length)
  let sum = 0
  for (let i = 0; i < zs.length; i++) {
    sum += zs[i] as number
    out[i] = sum / Math.sqrt(i + 1)
  }
  return out
}

/** Cumulative deviation of a z path: `cumsum(z² − 1)`, the classic GCP curve. */
export function cumulativeDeviationOf(zs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(zs.length)
  let sum = 0
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i] as number
    sum += z * z - 1
    out[i] = sum
  }
  return out
}

/**
 * A **synthetic** excursion: every trial sum in `[from, to)` is shifted by
 * `k·ε/2` bits, the mean shift a per-bit effect ε would produce. Nothing is
 * discovered by this — it draws what an effect of that size would look like
 * next to the same data without it.
 */
export function injectShift(
  sums: Float64Array,
  bitsPerTrial: number,
  epsPerBit: number,
  from: number,
  to: number,
): Float64Array {
  const out = Float64Array.from(sums)
  if (epsPerBit === 0) return out
  const shift = (bitsPerTrial * epsPerBit) / 2
  for (let i = Math.max(0, from); i < Math.min(out.length, to); i++) {
    out[i] = Math.min(bitsPerTrial, Math.max(0, Math.round((out[i] as number) + shift)))
  }
  return out
}

/** Short hash for a readout: `9f86d081…b0f00a08`. */
export function shortHash(hash: string | undefined, head = 8, tail = 8): string {
  if (!hash) return '—'
  return hash.length <= head + tail ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`
}

/** Sum of an array-like (bytes accounting, trial counts). */
export function sumOf(values: ArrayLike<number>): number {
  let total = 0
  for (let i = 0; i < values.length; i++) total += values[i] as number
  return total
}

/** Lower-case hex SHA-256 of a string — the hash a chained recording commits to. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A deterministic lock-step clock for `recordSession`: round *r* stamps its
 * sources at `t0 + r·stepMs + j·spreadMs`, the small per-source spread a real
 * network shows (and the thing `alignment: 'strict'` guards against).
 */
export function lockStepClock(t0: number, sources: number, stepMs = 1000, spreadMs = 3) {
  let calls = 0
  return (): number => {
    const c = calls++
    return t0 + Math.floor(c / sources) * stepMs + (c % sources) * spreadMs
  }
}
