import { NegentropyError } from '../errors.js'
import { POPCOUNT } from '../internal/bytes.js'
import type { Trial, TrialConfig, TrialSeries, TrialSource } from '../types.js'

export const DEFAULT_BITS_PER_TRIAL = 200

function validateBitsPerTrial(bitsPerTrial: number | undefined, source?: string): number {
  const k = bitsPerTrial ?? DEFAULT_BITS_PER_TRIAL
  if (!Number.isInteger(k) || k < 8) {
    throw new NegentropyError(
      'invalid_config',
      `bitsPerTrial must be an integer ≥ 8, got ${bitsPerTrial}`,
      { source },
    )
  }
  return k
}

/**
 * Batch trial extraction: slice a recorded byte buffer into trial sums — the
 * number of one-bits among each run of `bitsPerTrial` consecutive bits
 * (MSB-first). Under H0 each sum ~ Binomial(bitsPerTrial, ½). Trailing bits
 * that do not fill a whole trial are dropped and reported via `leftoverBits`,
 * never zero-padded.
 */
export function trialsFromBytes(
  bytes: Uint8Array,
  source: string,
  config: TrialConfig = {},
): TrialSeries {
  const k = validateBitsPerTrial(config.bitsPerTrial, source)
  const totalBits = bytes.length * 8
  const count = Math.floor(totalBits / k)
  const sums = new Float64Array(count)
  if (k % 8 === 0) {
    // fast path: trials are byte-aligned — sum popcounts
    const bytesPerTrial = k / 8
    for (let t = 0; t < count; t++) {
      let sum = 0
      const base = t * bytesPerTrial
      for (let i = 0; i < bytesPerTrial; i++)
        sum += POPCOUNT[(bytes[base + i] as number) & 0xff] as number
      sums[t] = sum
    }
  } else {
    let sum = 0
    let bits = 0
    let t = 0
    for (let i = 0; i < bytes.length && t < count; i++) {
      const byte = bytes[i] as number
      for (let b = 7; b >= 0; b--) {
        sum += (byte >> b) & 1
        if (++bits === k) {
          sums[t++] = sum
          sum = 0
          bits = 0
          if (t === count) break
        }
      }
    }
  }
  return { source, bitsPerTrial: k, sums, leftoverBits: totalBits - count * k }
}

export interface TrialStreamConfig extends TrialConfig {
  signal?: AbortSignal
  /** Desired chunk size passed through to the source's stream. */
  chunkBytes?: number
  /** Clock used by interval mode — injectable for deterministic tests. */
  now?: () => number
}

/**
 * Live trial extraction from a byte source. Lazy and pull-based: no I/O
 * happens before the first `next()`, and a slow consumer slows the source
 * (the backpressure convention of `@mindpeeker/entropy` streams).
 *
 * Count mode (default) completes a trial every `bitsPerTrial` bits. Interval
 * mode is GCP-style wall-clock bucketing: the first `bitsPerTrial` bits
 * arriving inside each `intervalMs` bucket form that bucket's trial, extra
 * bits in the bucket are discarded, and an underfilled bucket yields no trial
 * — `Trial.index` is bucket-relative there, so missing buckets appear as
 * index gaps.
 *
 * The source ending simply ends this stream; a source error is rethrown as
 * `source_failed` (or `aborted` when the caller's signal fired).
 */
export async function* trialStream(
  source: TrialSource,
  config: TrialStreamConfig = {},
): AsyncGenerator<Trial> {
  const k = validateBitsPerTrial(config.bitsPerTrial, source.name)
  const clock = config.clock ?? { mode: 'count' }
  if (clock.mode === 'interval' && (!Number.isFinite(clock.intervalMs) || clock.intervalMs <= 0)) {
    throw new NegentropyError('invalid_config', `intervalMs must be > 0, got ${clock.intervalMs}`, {
      source: source.name,
    })
  }
  const now = config.now ?? (() => Date.now())
  const signal = config.signal
  const abortError = () =>
    new NegentropyError('aborted', 'trial stream aborted', { source: source.name })
  if (signal?.aborted) throw abortError()

  let sum = 0
  let bits = 0
  let index = 0
  // interval-mode state
  let activeBucket = Number.NEGATIVE_INFINITY
  let bucketFilled = false
  let firstBucket: number | undefined

  try {
    for await (const chunk of source.stream({ signal, chunkBytes: config.chunkBytes })) {
      if (signal?.aborted) throw abortError()
      const at = now()
      if (clock.mode === 'interval') {
        const bucket = Math.floor(at / clock.intervalMs)
        if (bucket !== activeBucket) {
          activeBucket = bucket
          sum = 0
          bits = 0
          bucketFilled = false
        }
        if (bucketFilled) continue
      }
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i] as number
        if (bits + 8 < k) {
          sum += POPCOUNT[byte & 0xff] as number
          bits += 8
          continue
        }
        for (let b = 7; b >= 0; b--) {
          sum += (byte >> b) & 1
          if (++bits === k) {
            if (clock.mode === 'interval') {
              firstBucket ??= activeBucket
              bucketFilled = true
              yield { sum, index: activeBucket - firstBucket, at }
            } else {
              yield { sum, index: index++, at }
            }
            sum = 0
            bits = 0
            if (clock.mode === 'interval') break
          }
        }
        if (clock.mode === 'interval' && bucketFilled) break
      }
    }
  } catch (error) {
    if (error instanceof NegentropyError) throw error
    if (signal?.aborted) {
      throw new NegentropyError('aborted', 'trial stream aborted', {
        source: source.name,
        cause: error,
      })
    }
    throw new NegentropyError('source_failed', `${source.name} stream failed`, {
      source: source.name,
      cause: error,
    })
  }
}
