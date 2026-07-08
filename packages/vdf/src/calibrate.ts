import { VdfError } from './errors.js'
import { hashToGroup } from './hash.js'
import { assertModulus, MAX_T } from './internal/validate.js'
import { RSA2048 } from './moduli.js'
import type { RsaModulus } from './types.js'

export interface CalibrateOptions {
  /** Group to measure in — throughput depends on the modulus size. Default {@link RSA2048}. */
  modulus?: RsaModulus
}

/** What `calibrate` measured, plus a helper to turn a wall-clock target into a $T$. */
export interface CalibrationResult {
  /** Measured sequential squarings per second at the calibrated modulus. */
  readonly squaringsPerSecond: number
  /**
   * Delay parameter for a target wall-clock delay:
   * $T = \mathrm{round}(\mathrm{sps} \cdot \mathrm{wallMs} / 1000)$, clamped
   * to $[1, 2^{32} - 1]$. Remember this is *this machine's* speed — a
   * faster adversary finishes sooner (see the README's calibration section).
   */
  suggestT(wallMs: number): number
}

const encoder = new TextEncoder()

/**
 * Measure sequential-squaring throughput on the current machine by timing
 * $y \leftarrow y^2 \bmod n$ in 1024-squaring batches for at least
 * `sampleMs` milliseconds (`performance.now()` clock, after a short JIT
 * warm-up).
 *
 * $T$ **must** be sized per deployment: native-bigint squaring speed varies
 * by an order of magnitude across CPUs and runtimes, and the delay any
 * verifier can *infer* from a proof is $T$ squarings on the **fastest**
 * hardware anyone owns, not on yours. Calibrate where you evaluate, and pick
 * safety margins accordingly.
 *
 * @param sampleMs Minimum measurement window (default 200 ms; longer = steadier).
 */
export async function calibrate(
  sampleMs = 200,
  opts: CalibrateOptions = {},
): Promise<CalibrationResult> {
  if (typeof sampleMs !== 'number' || !Number.isFinite(sampleMs) || sampleMs <= 0) {
    throw new VdfError(
      'invalid_input',
      `sampleMs must be a positive finite number, got ${sampleMs}`,
    )
  }
  const modulus = opts.modulus ?? RSA2048
  const n = assertModulus(modulus)
  let y = await hashToGroup(encoder.encode('mindpeeker-vdf calibration'), modulus)
  for (let i = 0; i < 256; i++) y = (y * y) % n // JIT / allocator warm-up, unmeasured
  const start = performance.now()
  let count = 0
  let elapsed = 0
  do {
    for (let i = 0; i < 1024; i++) y = (y * y) % n
    count += 1024
    elapsed = performance.now() - start
  } while (elapsed < sampleMs)
  const squaringsPerSecond = (count / elapsed) * 1000
  return Object.freeze({
    squaringsPerSecond,
    suggestT(wallMs: number): number {
      if (typeof wallMs !== 'number' || !Number.isFinite(wallMs) || wallMs <= 0) {
        throw new VdfError(
          'invalid_input',
          `wallMs must be a positive finite number, got ${wallMs}`,
        )
      }
      return Math.min(MAX_T, Math.max(1, Math.round((squaringsPerSecond * wallMs) / 1000)))
    },
  })
}
