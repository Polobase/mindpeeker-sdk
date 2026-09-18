// Running statistics over a byte stream: the byte histogram, the monobit
// z-score and the exact tests from @mindpeeker/negentropy.
// CLIENT-ONLY (it imports @mindpeeker/negentropy).

import { chiSquareBytes, shannonEntropy } from '@mindpeeker/negentropy'
import { normSf, POPCOUNT } from '@mindpeeker/negentropy/numerics'

export interface StreamSnapshot {
  readonly bytes: number
  readonly bits: number
  readonly ones: number
  readonly onesFraction: number
  /** (2·ones − n)/√n over every bit seen — the monobit z-score. */
  readonly z: number
  /** Two-sided pointwise p for that z. Watching it live inflates it (see the caveat). */
  readonly p: number
  /** Shannon entropy in bits per byte over the retained sample. */
  readonly shannon: number
  /** χ² over the 256-bin byte histogram (255 df) and its exact p-value. */
  readonly chi2: number
  readonly chi2P: number
  /** Bar heights: relative frequency per 8-value bin (32 bins). */
  readonly bins: number[]
}

export const HISTOGRAM_BINS = 32
const VALUES_PER_BIN = 256 / HISTOGRAM_BINS

export const BIN_LABELS: string[] = Array.from({ length: HISTOGRAM_BINS }, (_, i) =>
  String(i * VALUES_PER_BIN),
)

/**
 * Accumulates a stream without ever rescanning it: byte counts and one-bits
 * are updated per chunk, and a bounded sample is retained so the exact
 * `shannonEntropy` / `chiSquareBytes` estimators can be run on real bytes.
 */
export class StreamStats {
  readonly counts = new Uint32Array(256)
  readonly sample: Uint8Array
  private filled = 0
  private total = 0
  private ones = 0

  constructor(sampleCapacity = 1 << 20) {
    this.sample = new Uint8Array(sampleCapacity)
  }

  push(chunk: Uint8Array): void {
    for (const byte of chunk) {
      this.counts[byte] = (this.counts[byte] as number) + 1
      this.ones += POPCOUNT[byte] as number
    }
    this.total += chunk.length
    const room = this.sample.length - this.filled
    if (room > 0) {
      const take = Math.min(room, chunk.length)
      this.sample.set(chunk.subarray(0, take), this.filled)
      this.filled += take
    }
  }

  get bytes(): number {
    return this.total
  }

  snapshot(): StreamSnapshot | undefined {
    if (this.total === 0) return undefined
    const bits = this.total * 8
    const z = (2 * this.ones - bits) / Math.sqrt(bits)
    const view = this.sample.subarray(0, this.filled)
    const chi = this.filled > 0 ? chiSquareBytes(view) : { statistic: Number.NaN, pValue: Number.NaN }
    const bins: number[] = []
    for (let b = 0; b < HISTOGRAM_BINS; b++) {
      let sum = 0
      for (let v = b * VALUES_PER_BIN; v < (b + 1) * VALUES_PER_BIN; v++) {
        sum += this.counts[v] as number
      }
      bins.push(sum / this.total)
    }
    return {
      bytes: this.total,
      bits,
      ones: this.ones,
      onesFraction: this.ones / bits,
      z,
      p: 2 * normSf(Math.abs(z)),
      shannon: this.filled > 0 ? shannonEntropy(view) : Number.NaN,
      chi2: chi.statistic,
      chi2P: chi.pValue,
      bins,
    }
  }
}

/** The code the panel actually runs, for the section's snippet. */
export const STREAM_SNIPPET = `import { stream } from '~/lib/entropy'            // the header-selected source
import { chiSquareBytes } from '@mindpeeker/negentropy'
import { normSf, POPCOUNT } from '@mindpeeker/negentropy/numerics'

let bytes = 0
let ones = 0
for await (const chunk of stream({ chunkBytes: 1024, signal })) {
  for (const byte of chunk) ones += POPCOUNT[byte]
  bytes += chunk.length
  const bits = bytes * 8
  const z = (2 * ones - bits) / Math.sqrt(bits)   // monobit, SP 800-22 §2.1
  const p = 2 * normSf(Math.abs(z))               // pointwise, not anytime-valid
  const chi = chiSquareBytes(sample)              // 255 df, exact p
}`
