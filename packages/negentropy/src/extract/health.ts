import { NegentropyError } from '../errors.js'
import { aptCutoff, rctCutoff } from '../internal/health-cutoffs.js'

export { aptCutoff, rctCutoff } from '../internal/health-cutoffs.js'

export interface HealthConfig {
  /**
   * Assessed min-entropy H in bits per raw sample byte: finite, 0 < H ≤ 8
   * (a byte cannot carry more). May be fractional. Below 20/W bits the APT
   * cutoff is W + 1 and that test cannot fire (see `aptCutoff`); the RCT
   * still runs.
   */
  minEntropyPerSample: number
  /** APT window: 512 (default, non-binary samples) or 1024 (binary sources). Other values throw. */
  windowSize?: 512 | 1024
  /**
   * strict: throw NegentropyError('health_test') on the first alarm — the
   * randomness-supplier behavior. Default false: record alarms and keep
   * running — the anomaly-logger behavior (an alarm resets that test's
   * counter so one long run is one alarm, not one per sample).
   */
  strict?: boolean
}

export interface HealthAlarm {
  test: 'rct' | 'apt'
  /** Global index of the sample that tripped the test (0-based). */
  sample: number
  count: number
  cutoff: number
}

/**
 * SP 800-90B §4.4 continuous health tests (Repetition Count + Adaptive
 * Proportion) over raw samples, in an observational shell.
 */
export class ContinuousHealth {
  readonly rctCutoff: number
  readonly aptCutoff: number
  readonly #windowSize: number
  readonly #strict: boolean
  readonly #source?: string
  readonly #alarms: HealthAlarm[] = []
  #samplesSeen = 0

  // Repetition Count Test state
  #lastSample = -1
  #runLength = 0

  // Adaptive Proportion Test state
  #windowIndex = 0
  #reference = -1
  #referenceCount = 0

  constructor(config: HealthConfig, source?: string) {
    const { minEntropyPerSample, windowSize = 512, strict = false } = config
    if (
      typeof minEntropyPerSample !== 'number' ||
      !Number.isFinite(minEntropyPerSample) ||
      !(minEntropyPerSample > 0 && minEntropyPerSample <= 8)
    ) {
      throw new NegentropyError(
        'invalid_config',
        `minEntropyPerSample must be a finite number in (0, 8] bits per byte, got ${minEntropyPerSample}`,
        { source },
      )
    }
    if (windowSize !== 512 && windowSize !== 1024) {
      throw new NegentropyError(
        'invalid_config',
        `windowSize must be 512 or 1024 (SP 800-90B §4.4.2), got ${windowSize}`,
        { source },
      )
    }
    this.rctCutoff = rctCutoff(minEntropyPerSample)
    this.aptCutoff = aptCutoff(minEntropyPerSample, windowSize)
    this.#windowSize = windowSize
    this.#strict = strict
    this.#source = source
  }

  get alarms(): readonly HealthAlarm[] {
    return this.#alarms
  }

  get samplesSeen(): number {
    return this.#samplesSeen
  }

  #alarm(test: 'rct' | 'apt', count: number, cutoff: number): HealthAlarm {
    const alarm: HealthAlarm = { test, sample: this.#samplesSeen, count, cutoff }
    this.#alarms.push(alarm)
    if (this.#strict) {
      throw new NegentropyError(
        'health_test',
        test === 'rct'
          ? `repetition count test failed: ${count} identical samples (cutoff ${cutoff})`
          : `adaptive proportion test failed: value seen ${count}× in a ${this.#windowSize}-sample window (cutoff ${cutoff})`,
        { source: this.#source },
      )
    }
    return alarm
  }

  /** Feed raw samples; returns the alarms THIS call raised ([] = healthy). */
  push(samples: Uint8Array): HealthAlarm[] {
    const raised: HealthAlarm[] = []
    for (const sample of samples) {
      // Repetition Count Test
      if (sample === this.#lastSample) {
        this.#runLength++
        if (this.#runLength >= this.rctCutoff) {
          raised.push(this.#alarm('rct', this.#runLength, this.rctCutoff))
          this.#runLength = 1 // observational: restart the run so alarms don't flood
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
            raised.push(this.#alarm('apt', this.#referenceCount, this.aptCutoff))
            this.#windowIndex = 0 // observational: restart the window
            this.#samplesSeen++
            continue
          }
        }
        this.#windowIndex++
        if (this.#windowIndex === this.#windowSize) this.#windowIndex = 0
      }
      this.#samplesSeen++
    }
    return raised
  }
}
