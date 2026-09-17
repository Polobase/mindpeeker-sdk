import { chiSquareP, NegentropyError, session, stoufferZ } from '@mindpeeker/negentropy'
import { binomialPmf, chi2Cdf, normPpf } from '@mindpeeker/negentropy/numerics'
import { PsiError } from '../errors.js'
import { assertBitsPerTrial, assertInteger } from '../internal/validate.js'
import type { TrialSource } from '../types.js'

/** Largest delay `setTimeout` honours (2³¹ − 1 ms); larger values overflow to ~1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647

/** Options shared by the rolling monitors. */
export interface RollingOptions {
  /** Trials (lock-step rounds) per window. Integer ≥ 1. */
  windowSize: number
  /** Trials advanced between emissions. Integer ≥ 1. Default 1 (fully sliding). */
  hopSize?: number
  /** Bits per trial, integer ≥ 8. Default 200 (the GCP convention). */
  bitsPerTrial?: number
  signal?: AbortSignal
  /** Clock override for deterministic tests. */
  now?: () => number
  /**
   * Max wait per lock-step round in ms: finite in (0, 2³¹ − 1], or `Infinity`
   * for no deadline. Passed to negentropy's session (default 30 000).
   */
  stepTimeoutMs?: number
}

/** One dashboard point emitted by a rolling monitor. */
export interface RollingPoint {
  /** Epoch ms of the newest trial in the window. */
  readonly at: number
  /**
   * Normal-equivalent z of the window statistic on one shared N(0,1)
   * dashboard scale. `rollingStouffer` emits the window's Stouffer z;
   * `rollingNetvar` maps the χ² statistic to $\Phi^{-1}(1-p)$ and never
   * reports less than the exact discrete floor (see {@link rollingNetvar}).
   */
  readonly z: number
  /** Trials in the window. */
  readonly n: number
  /** Sources that contributed the newest trial (a source that ends drops out). */
  readonly sourceCount: number
}

function validate(sources: readonly TrialSource[], opts: RollingOptions): void {
  if (!Array.isArray(sources as unknown) || sources.length === 0) {
    throw new PsiError('invalid_plan', 'rolling monitor needs at least one source')
  }
  if (new Set(sources.map((s) => s.name)).size !== sources.length) {
    throw new PsiError('invalid_plan', 'source names must be unique')
  }
  if (typeof opts !== 'object' || opts === null) {
    throw new PsiError('invalid_plan', 'rolling monitor needs options with windowSize')
  }
  assertInteger(opts.windowSize, 1, 'windowSize')
  assertInteger(opts.hopSize ?? 1, 1, 'hopSize')
  if (opts.bitsPerTrial !== undefined) assertBitsPerTrial(opts.bitsPerTrial)
  const timeout = opts.stepTimeoutMs
  if (
    timeout !== undefined &&
    timeout !== Number.POSITIVE_INFINITY &&
    !(Number.isFinite(timeout) && timeout > 0 && timeout <= MAX_TIMEOUT_MS)
  ) {
    throw new PsiError(
      'invalid_plan',
      `stepTimeoutMs must be a finite number in (0, ${MAX_TIMEOUT_MS}] or Infinity, got ${timeout}`,
    )
  }
}

/** A window handed to a statistic: chronological Stouffers plus per-step source counts. */
interface Window {
  readonly stouffers: Float64Array
  readonly sourceCounts: Int32Array
}

/**
 * Shared machinery: run a negentropy lock-step `session` over the sources
 * (theoretical calibration, `missing: 'skip'` so a source that ends drops
 * from the roster instead of killing the dashboard), keep the last
 * `windowSize` per-step Stouffer z's in a ring buffer, and emit `windowStat`
 * over a fresh chronological copy of the window every `hopSize` steps.
 * Recomputing per emission (no incremental shortcut) is what makes windows
 * exactly equal to a batch recomputation over the same recorded trials.
 */
async function* rollingCore(
  sources: readonly TrialSource[],
  opts: RollingOptions,
  windowStat: (window: Window) => number,
): AsyncGenerator<RollingPoint> {
  const size = opts.windowSize
  const hop = opts.hopSize ?? 1
  const live = session({
    sources: [...sources],
    missing: 'skip',
    ...(opts.bitsPerTrial !== undefined && { trial: { bitsPerTrial: opts.bitsPerTrial } }),
    ...(opts.signal && { signal: opts.signal }),
    ...(opts.now && { now: opts.now }),
    ...(opts.stepTimeoutMs !== undefined && { stepTimeoutMs: opts.stepTimeoutMs }),
  })
  const ring = new Float64Array(size)
  const counts = new Int32Array(size)
  let head = 0 // next write position
  let ticks = 0
  try {
    for await (const tick of live) {
      ring[head] = tick.stouffer
      counts[head] = tick.present.length
      head = (head + 1) % size
      ticks++
      if (ticks >= size && (ticks - size) % hop === 0) {
        const stouffers = new Float64Array(size)
        const sourceCounts = new Int32Array(size)
        stouffers.set(ring.subarray(head))
        stouffers.set(ring.subarray(0, head), size - head)
        sourceCounts.set(counts.subarray(head))
        sourceCounts.set(counts.subarray(0, head), size - head)
        yield Object.freeze({
          at: tick.at,
          z: windowStat({ stouffers, sourceCounts }),
          n: size,
          sourceCount: tick.present.length,
        })
      }
    }
    if (opts.signal?.aborted) {
      throw new PsiError('aborted', 'rolling monitor aborted', { cause: opts.signal.reason })
    }
  } catch (error) {
    if (error instanceof NegentropyError && error.code === 'aborted') {
      throw new PsiError('aborted', 'rolling monitor aborted', { cause: error })
    }
    throw error
  }
}

/**
 * Live rolling Stouffer monitor for dashboards. Each emission is the
 * combined z over the window's per-step Stouffer z's:
 * $$Z_w = \frac{1}{\sqrt{w}} \sum_{t \in \text{window}} Z_s(t) \sim N(0,1)
 * \text{ under } H_0,$$
 * where $Z_s(t)$ is the per-step Stouffer across the sources present at step
 * $t$ — sensitive to a sustained mean shift. Windows are exactly reproducible
 * from a batch recomputation over the same trials (Stouffer 1949; the GCP
 * live-display convention). Aborting the signal raises `PsiError('aborted')`
 * (also when a source reacts by ending its stream); breaking out of the loop
 * closes all source streams cleanly.
 *
 * @throws {PsiError} `invalid_plan` eagerly for bad sources or options.
 */
export function rollingStouffer(
  sources: readonly TrialSource[],
  opts: RollingOptions,
): AsyncGenerator<RollingPoint> {
  validate(sources, opts)
  return rollingCore(sources, opts, (window) => stoufferZ(window.stouffers))
}

/** Φ⁻¹(exp(lnP)) without underflow: exact probit above e⁻⁷⁰⁰, Mills-ratio inversion below. */
function probitFromLog(lnP: number): number {
  if (lnP > -700) return normPpf(Math.min(Math.exp(lnP), 0.5))
  // ln Φ(z) ≈ −z²/2 − ln(−z) − ½ln 2π for z ≪ 0; Newton on that relation
  let z = -Math.sqrt(-2 * lnP)
  for (let i = 0; i < 8; i++) {
    const f = -0.5 * z * z - Math.log(-z) - 0.5 * Math.log(2 * Math.PI) - lnP
    const df = -z - 1 / z
    z -= f / df
  }
  return z
}

/**
 * Live rolling netvar monitor. Each window's statistic is the GCP network
 * variance $S = \sum_{t \in \text{window}} Z_s(t)^2 \sim \chi^2(w)$ under H0,
 * reported as its normal-equivalent $z = \Phi^{-1}(1 - p)$ with $p$ the
 * upper-tail $\chi^2$ probability — so both monitors share one N(0,1)
 * dashboard scale (Nelson et al. 2002). Sensitive to variance excess and
 * inter-source correlation, blind to the sign of deviations; it is a
 * variance-*excess* scale, and low values carry little information.
 *
 * Discrete floor: trial sums are integers, so with $N_t$ sources at step $t$
 * the smallest attainable $S$ is reached when every step's pooled deviation
 * $d_t = \sum_i x_i(t) - N_t k/2$ is as small as possible ($0$, or $\pm\tfrac12$
 * when $N_t k$ is odd), with exact probability
 * $P_{\min} = \prod_t P(d_t^2 = \min)$ from the Binomial$(N_t k, \tfrac12)$ pmf.
 * The emitted z never falls below $\Phi^{-1}(P_{\min})$ — e.g. $-1.59$ for one
 * 200-bit source and a one-trial window — where 0.1.x mapped $S = 0$ through a
 * clamp to $z = -8.21$ on ~6% of ticks.
 *
 * @throws {PsiError} `invalid_plan` eagerly for bad sources or options.
 */
export function rollingNetvar(
  sources: readonly TrialSource[],
  opts: RollingOptions,
): AsyncGenerator<RollingPoint> {
  validate(sources, opts)
  const k = opts.bitsPerTrial ?? 200
  const floorCache = new Map<number, { lnP: number; minimum: number; gap: number }>()
  const floorFor = (n: number) => {
    let entry = floorCache.get(n)
    if (!entry) {
      const bits = n * k
      const variance = bits / 4
      const odd = bits % 2 === 1
      const mass = odd
        ? 2 * binomialPmf((bits - 1) / 2, bits, 0.5)
        : binomialPmf(bits / 2, bits, 0.5)
      entry = {
        lnP: Math.log(mass),
        minimum: (odd ? 0.25 : 0) / variance,
        gap: 1 / variance,
      }
      floorCache.set(n, entry)
    }
    return entry
  }
  return rollingCore(sources, opts, ({ stouffers, sourceCounts }) => {
    let statistic = 0
    let lnFloor = 0
    let minimum = 0
    let gap = Number.POSITIVE_INFINITY
    for (let i = 0; i < stouffers.length; i++) {
      const z = stouffers[i] as number
      statistic += z * z
      const floor = floorFor(sourceCounts[i] as number)
      lnFloor += floor.lnP
      minimum += floor.minimum
      gap = Math.min(gap, floor.gap)
    }
    const zFloor = probitFromLog(lnFloor)
    if (statistic <= minimum + 0.5 * gap) return zFloor
    const upper = chiSquareP(statistic, stouffers.length)
    if (upper < 0.5) return -normPpf(upper)
    // lower half: take Φ⁻¹ of the lower tail directly (1 − p would lose it to rounding)
    const lower = chi2Cdf(statistic, stouffers.length)
    return lower > 0 ? Math.max(normPpf(Math.min(lower, 0.5)), zFloor) : zFloor
  })
}
