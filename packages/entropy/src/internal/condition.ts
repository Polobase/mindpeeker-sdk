import { EntropyError } from '../errors.js'
import { concatBytes } from './bytes.js'
import { type HealthAlarm, HealthTests } from './health.js'

export type ConditioningMode = 'conditioned' | 'raw'

/**
 * What a local provider does when a continuous health test (RCT/APT) raises
 * an alarm: `'throw'` fails the call/stream at once; `'retest'` (default)
 * applies SP 800-90B §4.3 restart semantics — discard the pending window, run
 * a fresh start-up test and resume — until `maxHealthFailures` is reached.
 */
export type HealthFailureMode = 'throw' | 'retest'

/** Shared option surface every local (physical-noise) provider extends. */
export interface ConditioningOptions {
  /**
   * 'conditioned' (default): SHA-256 extraction with entropy-credit
   * accounting. 'raw': health-tested samples pass through unwhitened —
   * for uses where the unprocessed physical noise is the point.
   */
  conditioning?: ConditioningMode
  /**
   * Override the source's assessed min-entropy in bits per raw sample byte:
   * finite, 0 < H ≤ 8. The health tests run at max(this, the provider's
   * stricter health-test H), never looser than the credit.
   */
  minEntropyPerSample?: number
  /**
   * Pool safetyFactor × 256 credited bits before emitting each 32-byte block.
   * Finite, ≥ 1 (≥ 1.25 carries the SP 800-90C full-entropy margin).
   */
  safetyFactor?: number
  /** Health-test alarm handling: `'retest'` (default) or `'throw'`. */
  onHealthFailure?: HealthFailureMode
  /**
   * Alarms tolerated per session under `'retest'`: the alarm that brings the
   * count to this value throws `EntropyError('health_test')`. Integer ≥ 1,
   * default 3. A session is one `getBytes` call or one `stream()` iterator.
   */
  maxHealthFailures?: number
}

export interface ConditionerConfig {
  provider: string
  minEntropyPerSample: number
  safetyFactor: number
  mode: ConditioningMode
  windowSize?: 512 | 1024
  /**
   * Run the health tests at a stricter assessed H than what is credited, so
   * the RCT/APT stay sensitive for sources credited very low entropy.
   * Default: same as minEntropyPerSample.
   */
  healthMinEntropyPerSample?: number
  /** Default 'retest'. */
  onHealthFailure?: HealthFailureMode
  /** Default 3. */
  maxHealthFailures?: number
  /**
   * Samples that must pass the health tests before any output is released,
   * at session start and after every alarm (SP 800-90B §4.3). Default 1024;
   * 0 disables the start-up test (unit tests of the pooling arithmetic only).
   */
  startupSamples?: number
}

const BLOCK_BITS = 256
const BLOCK_BYTES = 32
/** SP 800-90B §4.3: start-up tests run over at least 1024 consecutive samples. */
export const STARTUP_SAMPLES = 1024
export const DEFAULT_MAX_HEALTH_FAILURES = 3

interface ConditionerPlan {
  bytesPerBlock: number
  healthMinEntropyPerSample: number
  onHealthFailure: HealthFailureMode
  maxHealthFailures: number
  startupSamples: number
}

function planConditioner(config: ConditionerConfig): ConditionerPlan {
  const { provider, minEntropyPerSample, safetyFactor } = config
  const bytesPerBlock = Math.ceil((safetyFactor * BLOCK_BITS) / minEntropyPerSample)
  // Every 32-byte block must be backed by at least 256 credited bits. This
  // also rejects safetyFactor ≤ 0, NaN and H = ∞, which used to make the
  // pool loop hash an empty block forever (the constant SHA-256('')).
  if (!(Number.isSafeInteger(bytesPerBlock) && bytesPerBlock >= BLOCK_BYTES)) {
    throw new EntropyError(
      'invalid_request',
      `conditioner needs >= ${BLOCK_BYTES} raw bytes per block, got ${bytesPerBlock} (safetyFactor ${safetyFactor}, minEntropyPerSample ${minEntropyPerSample})`,
      { provider },
    )
  }
  const maxHealthFailures = config.maxHealthFailures ?? DEFAULT_MAX_HEALTH_FAILURES
  const startupSamples = config.startupSamples ?? STARTUP_SAMPLES
  if (!(Number.isSafeInteger(maxHealthFailures) && maxHealthFailures >= 1)) {
    throw new EntropyError(
      'invalid_request',
      `maxHealthFailures must be an integer >= 1, got ${maxHealthFailures}`,
      { provider },
    )
  }
  if (!(Number.isSafeInteger(startupSamples) && startupSamples >= 0)) {
    throw new EntropyError(
      'invalid_request',
      `startupSamples must be an integer >= 0, got ${startupSamples}`,
      { provider },
    )
  }
  return {
    bytesPerBlock,
    healthMinEntropyPerSample: config.healthMinEntropyPerSample ?? minEntropyPerSample,
    onHealthFailure: config.onHealthFailure ?? 'retest',
    maxHealthFailures,
    startupSamples,
  }
}

function healthFailure(
  alarm: HealthAlarm,
  failures: number,
  plan: ConditionerPlan,
  provider: string,
): EntropyError {
  const suffix =
    plan.onHealthFailure === 'retest'
      ? ` — alarm ${failures} of ${plan.maxHealthFailures} tolerated this session`
      : ''
  return new EntropyError('health_test', `${alarm.message}${suffix}`, { provider })
}

/**
 * Raw sample chunks in → output chunks out. Health tests (RCT + APT) always
 * run on the raw side, in both modes, and no sample is released before a
 * start-up test over `startupSamples` consecutive samples has passed.
 *
 * On an alarm under `'retest'` the chunk that raised it, any held start-up
 * samples and the conditioning pool are discarded, the tests restart, and a
 * new start-up test must pass before output resumes; the `maxHealthFailures`-th
 * alarm of the session throws `EntropyError('health_test')`. In raw mode,
 * chunks released before the alarm have already been yielded.
 *
 * Conditioned mode pools raw bytes until the credited min-entropy reaches
 * safetyFactor × 256 bits, then emits SHA-256(block).
 */
export async function* condition(
  raw: AsyncIterable<Uint8Array>,
  config: ConditionerConfig,
): AsyncGenerator<Uint8Array> {
  const { provider, mode, windowSize } = config
  const plan = planConditioner(config)
  const { bytesPerBlock } = plan
  const health = new HealthTests(
    { minEntropyPerSample: plan.healthMinEntropyPerSample, windowSize },
    provider,
  )

  let failures = 0
  let startupLeft = plan.startupSamples
  let held: Uint8Array[] = []
  let pool: Uint8Array[] = []
  let pooled = 0
  for await (const chunk of raw) {
    const alarm = health.check(chunk)
    if (alarm) {
      failures++
      if (plan.onHealthFailure === 'throw' || failures >= plan.maxHealthFailures) {
        throw healthFailure(alarm, failures, plan, provider)
      }
      health.reset()
      held = []
      pool = []
      pooled = 0
      startupLeft = plan.startupSamples
      continue
    }

    let ready: Uint8Array[]
    if (startupLeft > 0) {
      held.push(chunk)
      startupLeft -= chunk.length
      if (startupLeft > 0) continue
      ready = held
      held = []
    } else {
      ready = [chunk]
    }

    if (mode === 'raw') {
      yield* ready
      continue
    }
    for (const part of ready) {
      pool.push(part)
      pooled += part.length
    }
    if (pooled < bytesPerBlock) continue
    // One copy per arrival, then block views by offset (not O(n²) re-concatenation).
    const all = concatBytes(pool)
    const used = Math.floor(all.length / bytesPerBlock) * bytesPerBlock
    pool = used < all.length ? [all.slice(used)] : []
    pooled = all.length - used
    for (let offset = 0; offset < used; offset += bytesPerBlock) {
      const block = all.subarray(offset, offset + bytesPerBlock)
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
