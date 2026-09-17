import { VdfError } from './errors.js'
import { hashToGroupSync } from './hash.js'
import { sequentialSquare } from './internal/squaring.js'
import { assertModulus, MAX_T } from './internal/validate.js'
import { PROGRESS_INTERVAL, Work } from './internal/work.js'
import { RSA2048 } from './moduli.js'
import type { RsaModulus } from './types.js'

export interface CalibrateOptions {
  /** Group to measure in — throughput depends on the modulus size. Default {@link RSA2048}. */
  modulus?: RsaModulus
  /** Number of timing windows; the reported rate is their median. Integer in $[1, 101]$, default 5. */
  samples?: number
  /** Cooperative cancellation — `VdfError('aborted')`. */
  signal?: AbortSignal
}

export interface SuggestTOptions {
  /**
   * How many times faster than *this machine* the fastest adversary squares, a
   * finite number $\ge 1$ (default 1 = this machine's speed). Reference points
   * for 2048-bit squaring, relative to this package's ≈ $5 \times 10^4$/s on its
   * development machine: optimized CPU code $0.5$–$0.85 \times 10^6$/s (≈ 10–17×),
   * FPGA designs ≈ $4 \times 10^7$ 1024-bit squarings/s (hundreds of × even after
   * the size difference). See the README's calibration table; ~1000 is a prudent
   * margin against dedicated hardware.
   */
  adversarySpeedup?: number
}

/** What `calibrate` measured, plus a helper to turn a wall-clock target into a $T$. */
export interface CalibrationResult {
  /** Median sequential squarings per second across the timing windows. */
  readonly squaringsPerSecond: number
  /** Per-window rates (squarings per second), in measurement order. */
  readonly samples: readonly number[]
  /**
   * Delay parameter such that an adversary `adversarySpeedup`× faster than this
   * machine still needs `wallMs` milliseconds:
   * $T = \mathrm{round}(\mathrm{sps} \cdot \mathrm{speedup} \cdot \mathrm{wallMs} / 1000)$,
   * clamped to $[1, 2^{32} - 1]$. Evaluating that $T$ locally takes about
   * `speedup × wallMs`.
   */
  suggestT(wallMs: number, opts?: SuggestTOptions): number
}

const encoder = new TextEncoder()

/**
 * Measure sequential-squaring throughput on the current machine *through the
 * same code path `evaluate` uses*: `sequentialSquare` blocks of 1024 squarings
 * with their abort checks and cooperative yields (one shared work meter, so a
 * yield lands every 16 blocks), after a short unmeasured warm-up. The budget
 * `sampleMs` is split into `samples` windows of at least one block each; each
 * window's rate is recorded and the median is reported, which resists scheduler
 * and garbage-collector noise better than one long mean.
 *
 * $T$ **must** be sized per deployment: native-bigint squaring speed varies by an
 * order of magnitude across CPUs and runtimes, and the delay a proof certifies is
 * $T$ squarings on the **fastest** hardware anyone owns — use
 * `suggestT(wallMs, { adversarySpeedup })` to budget for it.
 *
 * @param sampleMs Total measurement budget in milliseconds (default 200; longer = steadier).
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
  const count = opts.samples ?? 5
  if (!Number.isInteger(count) || count < 1 || count > 101) {
    throw new VdfError('invalid_input', `samples must be an integer in [1, 101], got ${count}`)
  }
  const n = assertModulus(opts.modulus ?? RSA2048)
  const work = new Work(Number.POSITIVE_INFINITY, opts.signal)
  let y = hashToGroupSync(encoder.encode('mindpeeker-vdf calibration'), n)
  y = await sequentialSquare(y, 256, n, work) // JIT / allocator warm-up, unmeasured
  const windowMs = sampleMs / count
  const rates: number[] = []
  for (let s = 0; s < count; s++) {
    const start = performance.now()
    let squarings = 0
    let elapsed = 0
    do {
      y = await sequentialSquare(y, PROGRESS_INTERVAL, n, work)
      squarings += PROGRESS_INTERVAL
      elapsed = performance.now() - start
    } while (elapsed < windowMs)
    // A coarse clock can report 0 ms for a fast block; charge at least 1 µs.
    rates.push((squarings / Math.max(elapsed, 1e-3)) * 1000)
  }
  const sorted = rates.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const squaringsPerSecond =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
  return Object.freeze({
    squaringsPerSecond,
    samples: Object.freeze(rates),
    suggestT(wallMs: number, suggestOpts: SuggestTOptions = {}): number {
      if (typeof wallMs !== 'number' || !Number.isFinite(wallMs) || wallMs <= 0) {
        throw new VdfError(
          'invalid_input',
          `wallMs must be a positive finite number, got ${wallMs}`,
        )
      }
      const speedup = suggestOpts.adversarySpeedup ?? 1
      if (typeof speedup !== 'number' || !Number.isFinite(speedup) || speedup < 1) {
        throw new VdfError(
          'invalid_input',
          `adversarySpeedup must be a finite number >= 1, got ${speedup}`,
        )
      }
      const T = Math.round((squaringsPerSecond * speedup * wallMs) / 1000)
      return Math.min(MAX_T, Math.max(1, T))
    },
  })
}
