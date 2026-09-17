import { EntropyError } from '../errors.js'
import { aptCutoff, rctCutoff } from './health-cutoffs.js'

export { aptCutoff, HEALTH_ALPHA, rctCutoff } from './health-cutoffs.js'

export interface HealthConfig {
  /** Assessed min-entropy H in bits per raw sample byte: finite, 0 < H ≤ 8. May be fractional. */
  minEntropyPerSample: number
  /** APT window: 512 (default, non-binary samples) or 1024 (binary sources). */
  windowSize?: 512 | 1024
}

/** One tripped continuous test. */
export interface HealthAlarm {
  readonly test: 'rct' | 'apt'
  /** Run length (RCT) or in-window count of the reference value (APT) at the alarm. */
  readonly count: number
  readonly cutoff: number
  readonly message: string
}

/**
 * SP 800-90B §4.4 continuous health tests (Repetition Count + Adaptive
 * Proportion) over RAW samples, run in both conditioning modes. Each test has
 * a false-positive probability of at most α = 2⁻²⁰ per sample when the source
 * really delivers the assessed min-entropy H.
 */
export class HealthTests {
  readonly rctCutoff: number
  readonly aptCutoff: number
  readonly windowSize: 512 | 1024
  readonly #provider: string

  // Repetition Count Test state
  #lastSample = -1
  #runLength = 0

  // Adaptive Proportion Test state
  #windowIndex = 0
  #reference = -1
  #referenceCount = 0

  constructor(config: HealthConfig, provider: string) {
    const { minEntropyPerSample, windowSize = 512 } = config
    if (
      typeof minEntropyPerSample !== 'number' ||
      !Number.isFinite(minEntropyPerSample) ||
      !(minEntropyPerSample > 0 && minEntropyPerSample <= 8)
    ) {
      throw new EntropyError(
        'invalid_request',
        `health-test minEntropyPerSample must be a finite number in (0, 8] bits per byte, got ${String(minEntropyPerSample)}`,
        { provider },
      )
    }
    if (windowSize !== 512 && windowSize !== 1024) {
      throw new EntropyError(
        'invalid_request',
        `health-test windowSize must be 512 or 1024, got ${String(windowSize)}`,
        { provider },
      )
    }
    this.rctCutoff = rctCutoff(minEntropyPerSample)
    this.aptCutoff = aptCutoff(minEntropyPerSample, windowSize)
    this.windowSize = windowSize
    this.#provider = provider
  }

  /** Forget all test state: the next sample starts a fresh RCT run and APT window. */
  reset(): void {
    this.#lastSample = -1
    this.#runLength = 0
    this.#windowIndex = 0
    this.#reference = -1
    this.#referenceCount = 0
  }

  /**
   * Feed raw samples; returns the first alarm they raise, or null when the
   * chunk is healthy. After an alarm the state is mid-chunk: call `reset()`
   * before feeding further samples.
   */
  check(samples: Uint8Array): HealthAlarm | null {
    for (const sample of samples) {
      // Repetition Count Test
      if (sample === this.#lastSample) {
        this.#runLength++
        if (this.#runLength >= this.rctCutoff) {
          return {
            test: 'rct',
            count: this.#runLength,
            cutoff: this.rctCutoff,
            message: `repetition count test failed: ${this.#runLength} identical samples (cutoff ${this.rctCutoff})`,
          }
        }
      } else {
        this.#lastSample = sample
        this.#runLength = 1
      }

      // Adaptive Proportion Test
      if (this.#windowIndex === 0) {
        this.#reference = sample
        this.#referenceCount = 1
        this.#windowIndex = 1
      } else {
        if (sample === this.#reference) {
          this.#referenceCount++
          if (this.#referenceCount >= this.aptCutoff) {
            return {
              test: 'apt',
              count: this.#referenceCount,
              cutoff: this.aptCutoff,
              message: `adaptive proportion test failed: value ${this.#reference} seen ${this.#referenceCount}× in a ${this.windowSize}-sample window (cutoff ${this.aptCutoff})`,
            }
          }
        }
        this.#windowIndex++
        if (this.#windowIndex === this.windowSize) this.#windowIndex = 0
      }
    }
    return null
  }

  /** Like `check`, but throws `EntropyError('health_test')` on the first alarm. */
  test(samples: Uint8Array): void {
    const alarm = this.check(samples)
    if (alarm) throw new EntropyError('health_test', alarm.message, { provider: this.#provider })
  }
}
