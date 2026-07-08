import { chiSquareP, NegentropyError, session, stoufferZ } from '@mindpeeker/negentropy'
import { normPpf } from '@mindpeeker/negentropy/numerics'
import { PsiError } from '../errors.js'
import type { TrialSource } from '../types.js'

/** Options shared by the rolling monitors. */
export interface RollingOptions {
  /** Trials per window. Integer ≥ 1. */
  windowTrials: number
  /** Trials advanced between emissions. Integer ≥ 1. Default 1 (fully sliding). */
  hopTrials?: number
  /** Bits per trial. Default 200 (the GCP convention). */
  bitsPerTrial?: number
  signal?: AbortSignal
  /** Clock override for deterministic tests. */
  now?: () => number
  /** Max wait per lock-step round, passed to the underlying negentropy session. */
  stepTimeoutMs?: number
}

/** One dashboard point emitted by a rolling monitor. */
export interface RollingPoint {
  /** Epoch ms of the newest trial in the window. */
  readonly at: number
  /** Normal-equivalent z of the window statistic — N(0,1) under H0 for both monitors. */
  readonly z: number
  /** Trials in the window. */
  readonly n: number
}

function validate(sources: readonly TrialSource[], opts: RollingOptions): void {
  if (sources.length === 0) {
    throw new PsiError('invalid_plan', 'rolling monitor needs at least one source')
  }
  if (new Set(sources.map((s) => s.name)).size !== sources.length) {
    throw new PsiError('invalid_plan', 'source names must be unique')
  }
  if (!Number.isInteger(opts.windowTrials) || opts.windowTrials < 1) {
    throw new PsiError(
      'invalid_plan',
      `windowTrials must be an integer ≥ 1, got ${opts.windowTrials}`,
    )
  }
  const hop = opts.hopTrials ?? 1
  if (!Number.isInteger(hop) || hop < 1) {
    throw new PsiError('invalid_plan', `hopTrials must be an integer ≥ 1, got ${opts.hopTrials}`)
  }
}

/**
 * Shared machinery: run a negentropy lock-step `session` over the sources
 * (theoretical calibration, `missing: 'skip'` so a source that ends drops
 * from the roster instead of killing the dashboard), keep the last
 * `windowTrials` per-step Stouffer z's, and emit `windowStat` over a fresh
 * chronological copy of the window every `hopTrials` steps. Recomputing per
 * emission (no incremental shortcut) is what makes windows exactly equal to
 * a batch recomputation over the same recorded trials.
 */
async function* rollingCore(
  sources: readonly TrialSource[],
  opts: RollingOptions,
  windowStat: (window: Float64Array) => number,
): AsyncGenerator<RollingPoint> {
  const windowTrials = opts.windowTrials
  const hop = opts.hopTrials ?? 1
  const live = session({
    sources: [...sources],
    missing: 'skip',
    ...(opts.bitsPerTrial !== undefined && { trial: { bitsPerTrial: opts.bitsPerTrial } }),
    ...(opts.signal && { signal: opts.signal }),
    ...(opts.now && { now: opts.now }),
    ...(opts.stepTimeoutMs !== undefined && { stepTimeoutMs: opts.stepTimeoutMs }),
  })
  const buffer: number[] = []
  let ticks = 0
  try {
    for await (const tick of live) {
      buffer.push(tick.stouffer)
      if (buffer.length > windowTrials) buffer.shift()
      ticks++
      if (ticks >= windowTrials && (ticks - windowTrials) % hop === 0) {
        yield Object.freeze({
          at: tick.at,
          z: windowStat(Float64Array.from(buffer)),
          n: buffer.length,
        })
      }
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
 * where $Z_s(t)$ is the per-step Stouffer across sources — sensitive to a
 * sustained mean shift. Windows are exactly reproducible from a batch
 * recomputation over the same trials (Stouffer 1949; the GCP live-display
 * convention). Aborting the signal raises `PsiError('aborted')`; breaking
 * out of the loop closes all source streams cleanly.
 */
export function rollingStouffer(
  sources: readonly TrialSource[],
  opts: RollingOptions,
): AsyncGenerator<RollingPoint> {
  validate(sources, opts)
  return rollingCore(sources, opts, (window) => stoufferZ(window))
}

/**
 * Live rolling netvar monitor. Each window's statistic is the GCP network
 * variance $\sum_{t \in \text{window}} Z_s(t)^2 \sim \chi^2(w)$ under H0,
 * reported as its normal-equivalent z, $z = \Phi^{-1}(1 - p)$ with $p$ the
 * upper-tail $\chi^2$ probability — so both monitors share one N(0,1)
 * dashboard scale (Nelson et al. 2002). Sensitive to variance excess and
 * inter-source correlation, blind to the sign of deviations.
 */
export function rollingNetvar(
  sources: readonly TrialSource[],
  opts: RollingOptions,
): AsyncGenerator<RollingPoint> {
  validate(sources, opts)
  return rollingCore(sources, opts, (window) => {
    let statistic = 0
    for (let i = 0; i < window.length; i++) {
      const z = window[i] as number
      statistic += z * z
    }
    // clamp: chiSquareP already floors at P_FLOOR; the upper clamp keeps normPpf finite
    return -normPpf(Math.min(chiSquareP(statistic, window.length), 1 - 1e-16))
  })
}
