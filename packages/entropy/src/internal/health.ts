import { EntropyError } from '../errors.js'

const ALPHA = 2 ** -20 // false-positive rate for both tests (SP 800-90B recommendation)

export interface HealthConfig {
  /** Assessed min-entropy H in bits per raw sample byte. May be fractional. */
  minEntropyPerSample: number
  /** APT window: 512 (default, non-binary samples) or 1024 (binary sources). */
  windowSize?: 512 | 1024
}

/** SP 800-90B §4.4.1 Repetition Count Test cutoff: C = 1 + ceil(20 / H) at alpha 2^-20. */
export function rctCutoff(h: number): number {
  return 1 + Math.ceil(20 / h)
}

/**
 * SP 800-90B §4.4.2 Adaptive Proportion Test cutoff:
 * 1 + smallest k with P(Binomial(W, 2^-H) <= k) >= 1 - 2^-20,
 * computed via the iterative pmf recurrence (exact enough for W <= 1024).
 */
export function aptCutoff(h: number, windowSize: number): number {
  const p = 2 ** -h
  let pmf = (1 - p) ** windowSize
  let cdf = pmf
  let k = 0
  while (cdf < 1 - ALPHA && k < windowSize) {
    pmf *= ((windowSize - k) / (k + 1)) * (p / (1 - p))
    k++
    cdf += pmf
  }
  return 1 + k
}

/**
 * Continuous health tests over RAW samples (run in both conditioning modes).
 * Throws EntropyError('health_test') the moment either test fails — a failing
 * source must never silently degrade to pseudo-randomness.
 */
export class HealthTests {
  readonly #rctCutoff: number
  readonly #aptCutoff: number
  readonly #windowSize: number
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
    if (!(minEntropyPerSample > 0)) {
      throw new TypeError('minEntropyPerSample must be > 0')
    }
    this.#rctCutoff = rctCutoff(minEntropyPerSample)
    this.#aptCutoff = aptCutoff(minEntropyPerSample, windowSize)
    this.#windowSize = windowSize
    this.#provider = provider
  }

  test(samples: Uint8Array): void {
    for (const sample of samples) {
      // Repetition Count Test
      if (sample === this.#lastSample) {
        this.#runLength++
        if (this.#runLength >= this.#rctCutoff) {
          throw new EntropyError(
            'health_test',
            `repetition count test failed: ${this.#runLength} identical samples (cutoff ${this.#rctCutoff})`,
            { provider: this.#provider },
          )
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
          if (this.#referenceCount >= this.#aptCutoff) {
            throw new EntropyError(
              'health_test',
              `adaptive proportion test failed: value ${this.#reference} seen ${this.#referenceCount}× in a ${this.#windowSize}-sample window (cutoff ${this.#aptCutoff})`,
              { provider: this.#provider },
            )
          }
        }
        this.#windowIndex++
        if (this.#windowIndex === this.#windowSize) this.#windowIndex = 0
      }
    }
  }
}
