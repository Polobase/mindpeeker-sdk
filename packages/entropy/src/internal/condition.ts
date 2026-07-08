import { EntropyError } from '../errors.js'
import { concatBytes } from './bytes.js'
import { HealthTests } from './health.js'

export type ConditioningMode = 'conditioned' | 'raw'

/** Shared option surface every local (physical-noise) provider extends. */
export interface ConditioningOptions {
  /**
   * 'conditioned' (default): SHA-256 extraction with entropy-credit
   * accounting. 'raw': health-tested samples pass through unwhitened —
   * for uses where the unprocessed physical noise is the point.
   */
  conditioning?: ConditioningMode
  /** Override the source's assessed min-entropy (bits per raw sample byte). */
  minEntropyPerSample?: number
  /** Pool safetyFactor × 256 credited bits before emitting each 32-byte block. */
  safetyFactor?: number
}

export interface ConditionerConfig {
  provider: string
  minEntropyPerSample: number
  safetyFactor: number
  mode: ConditioningMode
  windowSize?: 512 | 1024
  /**
   * Run the health tests at a stricter assessed H than what is credited.
   * At very low credited H the APT cutoff exceeds its window (test disabled)
   * and the RCT cutoff balloons — a frozen-but-patterned source would pass.
   * Default: same as minEntropyPerSample.
   */
  healthMinEntropyPerSample?: number
}

const BLOCK_BITS = 256

/**
 * Raw sample chunks in → output chunks out. Health tests (RCT + APT) always
 * run on the raw side, in both modes. Conditioned mode pools raw bytes until
 * the credited min-entropy reaches safetyFactor × 256 bits, then emits
 * SHA-256(pool) and resets the pool.
 */
export async function* condition(
  raw: AsyncIterable<Uint8Array>,
  config: ConditionerConfig,
): AsyncGenerator<Uint8Array> {
  const { provider, minEntropyPerSample, safetyFactor, mode, windowSize } = config
  const health = new HealthTests(
    { minEntropyPerSample: config.healthMinEntropyPerSample ?? minEntropyPerSample, windowSize },
    provider,
  )
  const bytesPerBlock = Math.ceil((safetyFactor * BLOCK_BITS) / minEntropyPerSample)

  let pool: Uint8Array[] = []
  let pooled = 0
  for await (const chunk of raw) {
    health.test(chunk)
    if (mode === 'raw') {
      yield chunk
      continue
    }
    pool.push(chunk)
    pooled += chunk.length
    while (pooled >= bytesPerBlock) {
      const all = concatBytes(pool)
      const block = all.slice(0, bytesPerBlock)
      const rest = all.slice(bytesPerBlock)
      pool = rest.length > 0 ? [rest] : []
      pooled = rest.length
      yield new Uint8Array(await crypto.subtle.digest('SHA-256', block))
    }
  }
}

/** Drain a stream into exactly `n` bytes or throw insufficient_entropy. */
export async function collectBytes(
  stream: AsyncIterable<Uint8Array>,
  n: number,
  provider: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) {
    chunks.push(chunk)
    total += chunk.length
    if (total >= n) return concatBytes(chunks).slice(0, n)
  }
  throw new EntropyError('insufficient_entropy', `source ended after ${total}/${n} bytes`, {
    provider,
  })
}
