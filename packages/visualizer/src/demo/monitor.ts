/**
 * Per-step statistics behind the demo's trial channels, computed
 * incrementally in O(1) per step from the running Stouffer Z series. Pure:
 * the same Z's always give the same values, live or replayed.
 *
 * Exact mathematics: the cumulative deviation, both envelopes and the test
 * martingale below are deterministic functions of the Z's. Whether a
 * deviation means anything beyond chance is the hypothesis under test; the
 * envelopes only say how unusual a path is under H0 (independent fair bits).
 */
import { anytimeP, netvarBoundary, netvarLogM } from '@mindpeeker/negentropy'
import { chi2Isf, KahanSum, normPpf } from '@mindpeeker/negentropy/numerics'
import { VisualizerError } from '../errors.js'
import type { SeriesSample } from '../types.js'

/** Upper-tail probability of the pointwise band's upper edge (two-sided 90%). */
export const POINTWISE_UPPER_P = 0.05
/** Upper-tail probability of the pointwise band's lower edge. */
export const POINTWISE_LOWER_P = 0.95
/** Level of the time-uniform boundary and of the anytime p-value's rejection. */
export const ANYTIME_ALPHA = 0.05
/**
 * Gamma(a = 1, b = 1) mixture over the precision τ < 1 (variance excess only,
 * the GCP hypothesis). The one-sided mixture is an exact test supermartingale
 * for Z's built from independent fair bits (negentropy `netvarMartingale`).
 */
export const ANYTIME_PRIOR = Object.freeze({ a: 1, b: 1, sided: 'upper' as const })

/** Legend labels of the two envelopes, stating exactly what each band is. */
export const BAND_LABELS = Object.freeze({
  pointwise: 'two-sided 90% pointwise',
  anytime: `anytime-valid (α = ${ANYTIME_ALPHA})`,
})

/** $\Phi^{-1}(0.95)$: edge of the two-sided 90% pointwise band on the netvar Z scale. */
const Z_POINTWISE = -normPpf(POINTWISE_UPPER_P)

/** Everything the trial channels plot for one step. */
export interface MonitorPoint {
  /** 1-based step count. */
  readonly t: number
  /** This step's Stouffer Z. */
  readonly z: number
  /** $D_t = \sum_{s \le t}(Z_s^2 - 1)$, Neumaier-compensated like negentropy's `cumulativeDeviation`. */
  readonly deviation: number
  /**
   * Two-sided 90% pointwise χ² envelope of $D_t$:
   * `[chi2Isf(0.95, t) − t, chi2Isf(0.05, t) − t]`, bit-identical to
   * negentropy's `significanceEnvelope(T, 0.95)` / `(T, 0.05)` at step t.
   */
  readonly pointwise: readonly [number, number]
  /** `netvarBoundary(t, α, ANYTIME_PRIOR)`: `lower` is −∞ for the one-sided mixture. */
  readonly anytime: { readonly upper: number; readonly lower: number }
  /** `netvarLogM(t, D_t, ANYTIME_PRIOR)`: ln of the test martingale. */
  readonly logM: number
  /** Running anytime-valid p: `anytimeP` of the ln M path, i.e. min(1, 1/max M). */
  readonly anytimeP: number
  /**
   * Netvar Z $= D_t / \sqrt{v\,t}$ with $v = 2 - 2/n$ the exact per-step
   * variance of $Z^2 - 1$ for a Stouffer Z over n fair bits: mean 0 and
   * variance 1 under H0 exactly, approximately N(0, 1) for large t (CLT).
   */
  readonly netvarZ: number
}

/**
 * Incremental monitor over a Stouffer Z series. `bitsPerStep` is the number
 * of fair bits behind each step's Z (sources × bits per trial), which fixes
 * the netvar Z standardization.
 */
export class NetvarMonitor {
  readonly bitsPerStep: number
  readonly #deviation = new KahanSum()
  readonly #variance: number
  #t = 0
  #maxLogM = Number.NEGATIVE_INFINITY

  constructor(bitsPerStep: number) {
    if (!Number.isSafeInteger(bitsPerStep) || bitsPerStep < 8) {
      throw new VisualizerError(
        'invalid_options',
        `bits per step must be an integer ≥ 8, got ${bitsPerStep}`,
      )
    }
    this.bitsPerStep = bitsPerStep
    this.#variance = 2 - 2 / bitsPerStep
  }

  /** Steps seen so far. */
  get steps(): number {
    return this.#t
  }

  /** Add one step's Stouffer Z (finite) and return the step's statistics. */
  add(z: number): MonitorPoint {
    if (typeof z !== 'number' || !Number.isFinite(z)) {
      throw new VisualizerError('invalid_options', `a Stouffer Z must be finite, got ${z}`)
    }
    this.#deviation.add(z * z - 1)
    const t = ++this.#t
    const deviation = this.#deviation.value
    const logM = netvarLogM(t, deviation, ANYTIME_PRIOR)
    if (logM > this.#maxLogM) this.#maxLogM = logM
    return {
      t,
      z,
      deviation,
      pointwise: [chi2Isf(POINTWISE_LOWER_P, t) - t, chi2Isf(POINTWISE_UPPER_P, t) - t],
      anytime: netvarBoundary(t, ANYTIME_ALPHA, ANYTIME_PRIOR),
      logM,
      anytimeP: anytimeP([this.#maxLogM])[0] as number,
      netvarZ: deviation / Math.sqrt(this.#variance * t),
    }
  }
}

/** The cumulative-deviation sample: pointwise band shaded, anytime-valid boundary as a line. */
export function cumdevSample(point: MonitorPoint): SeriesSample {
  return {
    t: point.t,
    value: point.deviation,
    bands: [
      { lo: point.pointwise[0], hi: point.pointwise[1], label: BAND_LABELS.pointwise },
      { lo: point.anytime.lower, hi: point.anytime.upper, label: BAND_LABELS.anytime },
    ],
  }
}

/** The netvar Z sample with its two-sided 90% pointwise normal band. */
export function netvarSample(point: MonitorPoint): SeriesSample {
  return {
    t: point.t,
    value: point.netvarZ,
    bands: [{ lo: -Z_POINTWISE, hi: Z_POINTWISE, label: BAND_LABELS.pointwise }],
  }
}

/** Two significant digits, exponent notation below 0.01. */
function formatP(p: number): string {
  return p >= 0.01 ? p.toFixed(2) : p.toExponential(1)
}

/** Caption text for the netvar channel, e.g. `anytime p = 0.41`. */
export function anytimeNote(point: MonitorPoint): string {
  const reject = point.anytimeP <= ANYTIME_ALPHA ? ` ≤ α = ${ANYTIME_ALPHA}` : ''
  return `anytime p = ${formatP(point.anytimeP)}${reject}`
}

/** Run a monitor over a Stouffer Z stream. */
export async function* monitorPoints(
  zs: AsyncIterable<number>,
  bitsPerStep: number,
): AsyncGenerator<MonitorPoint> {
  const monitor = new NetvarMonitor(bitsPerStep)
  for await (const z of zs) yield monitor.add(z)
}
