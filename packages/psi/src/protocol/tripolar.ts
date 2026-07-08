import {
  NegentropyError,
  normalP,
  stoufferZ,
  theoreticalCalibration,
  trialStream,
  zScores,
} from '@mindpeeker/negentropy'
import { normPpf } from '@mindpeeker/negentropy/numerics'
import { PsiError } from '../errors.js'
import type { Intention, TrialSeries, TrialSource } from '../types.js'

/** Canonical collection order of the three intentions within one interleaved cycle. */
export const INTENTIONS: readonly Intention[] = Object.freeze(['high', 'low', 'baseline'])

/** $z_{0.975} = \Phi^{-1}(0.975)$ — the 95% two-sided normal critical value. */
const Z_975 = normPpf(0.975)

/**
 * A PEAR-style tripolar REG plan. The full protocol collects
 * $3 \times \text{runsPerIntention}$ runs of `trialsPerRun` trials each; a
 * trial is the number of one-bits among `bitsPerTrial` consecutive bits
 * (MSB-first), $\mathrm{Binomial}(k, \tfrac12)$ under H0.
 */
export interface TripolarPlan {
  /** Trials collected per run. Integer ≥ 1. */
  trialsPerRun: number
  /** Bits summed per trial. Integer ≥ 8 (PEAR used 200-bit trials). */
  bitsPerTrial: number
  /** Runs collected per intention. Integer ≥ 1. */
  runsPerIntention: number
  /**
   * `'interleaved'` (default) cycles high → low → baseline each round. This
   * cancels *constant* common-mode device bias exactly and suppresses slow
   * drift to first order — but does NOT fully cancel time-varying drift: the
   * fixed high-before-low ordering leaves a residual ≈ one run's worth of
   * drift in the high−low difference. Only ABBA-style counterbalancing or
   * randomized ordering removes linear drift exactly. `'fixed'` collects all
   * high runs, then all low, then all baseline (drift maximally confounded).
   */
  order?: 'fixed' | 'interleaved'
}

/** One completed, intention-tagged run of a tripolar protocol. */
export interface TripolarRun {
  readonly intention: Intention
  /** 0-based index of this run within its intention. */
  readonly run: number
  /** 0-based global collection order — preserves the counterbalancing schedule. */
  readonly sequence: number
  /** The run's recorded trial data (sums + completion timestamps). */
  readonly series: TrialSeries
}

/** Options for {@link runTripolar}. */
export interface RunTripolarOptions {
  signal?: AbortSignal
  /** Desired chunk size passed through to the source's stream. */
  chunkBytes?: number
  /** Clock override for deterministic tests — stamps each trial's completion time. */
  now?: () => number
}

function validatePlan(plan: TripolarPlan): void {
  if (!Number.isInteger(plan.trialsPerRun) || plan.trialsPerRun < 1) {
    throw new PsiError(
      'invalid_plan',
      `trialsPerRun must be an integer ≥ 1, got ${plan.trialsPerRun}`,
    )
  }
  if (!Number.isInteger(plan.runsPerIntention) || plan.runsPerIntention < 1) {
    throw new PsiError(
      'invalid_plan',
      `runsPerIntention must be an integer ≥ 1, got ${plan.runsPerIntention}`,
    )
  }
  if (!Number.isInteger(plan.bitsPerTrial) || plan.bitsPerTrial < 8) {
    throw new PsiError(
      'invalid_plan',
      `bitsPerTrial must be an integer ≥ 8, got ${plan.bitsPerTrial}`,
    )
  }
  const order = plan.order ?? 'interleaved'
  if (order !== 'fixed' && order !== 'interleaved') {
    throw new PsiError(
      'invalid_plan',
      `order must be 'fixed' or 'interleaved', got ${String(order)}`,
    )
  }
}

function buildSchedule(plan: TripolarPlan): Intention[] {
  const schedule: Intention[] = []
  if ((plan.order ?? 'interleaved') === 'fixed') {
    for (const intention of INTENTIONS) {
      for (let r = 0; r < plan.runsPerIntention; r++) schedule.push(intention)
    }
  } else {
    for (let r = 0; r < plan.runsPerIntention; r++) {
      for (const intention of INTENTIONS) schedule.push(intention)
    }
  }
  return schedule
}

/**
 * Execute a tripolar protocol live: consume `source` through negentropy's
 * `trialStream` and yield one intention-tagged {@link TripolarRun} as each
 * run completes. Lazy and pull-based — no source I/O before the first
 * `next()` — and deterministic: the same bytes produce the same runs.
 *
 * The intention *schedule* is fixed by the plan, not by the data: this
 * package tags which trials belong to which intention, it does not (cannot)
 * verify that an operator actually held that intention. Errors: a source
 * that ends mid-protocol raises `insufficient_data`; a fired `signal`
 * raises `aborted`.
 */
export async function* runTripolar(
  source: TrialSource,
  plan: TripolarPlan,
  opts: RunTripolarOptions = {},
): AsyncGenerator<TripolarRun> {
  validatePlan(plan)
  const schedule = buildSchedule(plan)
  const trials = trialStream(source, {
    bitsPerTrial: plan.bitsPerTrial,
    ...(opts.signal && { signal: opts.signal }),
    ...(opts.chunkBytes !== undefined && { chunkBytes: opts.chunkBytes }),
    ...(opts.now && { now: opts.now }),
  })
  const runCount: Record<Intention, number> = { high: 0, low: 0, baseline: 0 }
  try {
    for (let sequence = 0; sequence < schedule.length; sequence++) {
      const intention = schedule[sequence] as Intention
      const sums = new Float64Array(plan.trialsPerRun)
      const timestamps = new Float64Array(plan.trialsPerRun)
      for (let i = 0; i < plan.trialsPerRun; i++) {
        const next = await trials.next()
        if (next.done) {
          throw new PsiError(
            'insufficient_data',
            `${source.name} ended in run ${sequence + 1}/${schedule.length} after ${i} of ${plan.trialsPerRun} trials`,
            { source: source.name },
          )
        }
        sums[i] = next.value.sum
        timestamps[i] = next.value.at ?? Number.NaN
      }
      const run = runCount[intention]
      runCount[intention] = run + 1
      yield Object.freeze({
        intention,
        run,
        sequence,
        series: Object.freeze({
          source: source.name,
          bitsPerTrial: plan.bitsPerTrial,
          sums,
          timestamps,
        }),
      })
    }
  } catch (error) {
    if (error instanceof NegentropyError && error.code === 'aborted') {
      throw new PsiError('aborted', 'tripolar protocol aborted', {
        source: source.name,
        cause: error,
      })
    }
    throw error
  } finally {
    void trials.return(undefined).catch(() => {})
  }
}

/**
 * Per-intention pooled statistics. `z` is Stouffer's combined z over the
 * intention's per-trial z-scores; `effectSize` is PEAR's per-bit effect
 * $\varepsilon = z/\sqrt{N_{\text{bits}}}$, which estimates $2(p - \tfrac12)$
 * for per-bit probability $p$. `pValue` is one-sided in the *intended*
 * direction (upper for `high`, lower for `low`) and two-sided for
 * `baseline` — the tripolar hypotheses are directional by design.
 */
export interface IntentionSummary {
  readonly intention: Intention
  readonly runs: number
  readonly trials: number
  /** Total raw bits behind this intention: trials × bitsPerTrial. */
  readonly bits: number
  /** Mean per-trial z, $\bar z = z/\sqrt{n}$. */
  readonly meanZ: number
  /** Stouffer's combined z, $z = \sum_i z_i / \sqrt{n} \sim N(0,1)$ under H0. */
  readonly z: number
  readonly pValue: number
  /** $\varepsilon = z/\sqrt{N_{\text{bits}}}$, the per-bit effect size. */
  readonly effectSize: number
  /** Normal-approximation 95% CI on $\varepsilon$: $\varepsilon \pm z_{0.975}/\sqrt{N_{\text{bits}}}$. */
  readonly ci95: readonly [number, number]
}

/** The full tripolar analysis — see {@link analyzeTripolar}. */
export interface TripolarAnalysis {
  readonly source: string
  readonly bitsPerTrial: number
  readonly high: IntentionSummary
  readonly low: IntentionSummary
  /** Present when the runs include baseline data. */
  readonly baseline?: IntentionSummary
  /**
   * The PEAR primary statistic, high minus low:
   * $$\Delta z = \frac{\varepsilon_H - \varepsilon_L}{\sqrt{1/N_H + 1/N_L}} \sim N(0,1)
   * \text{ under } H_0,$$
   * which reduces to $(z_H - z_L)/\sqrt{2}$ for balanced designs.
   */
  readonly deltaZ: number
  /** One-sided p of `deltaZ` (H1: high > low — the pre-stated direction). */
  readonly deltaP: number
  /** $\varepsilon_H - \varepsilon_L$, the per-bit effect separation. */
  readonly deltaEffect: number
  /** 95% CI on `deltaEffect` via the normal approximation. */
  readonly deltaCi95: readonly [number, number]
}

function summarize(
  intention: Intention,
  group: readonly TripolarRun[],
  source: string,
  bitsPerTrial: number,
): IntentionSummary | undefined {
  if (group.length === 0) return undefined
  const cal = theoreticalCalibration(source, bitsPerTrial)
  const pooled: number[] = []
  for (const run of group) {
    for (const z of zScores(run.series, cal)) pooled.push(z)
  }
  if (pooled.length === 0) {
    throw new PsiError('insufficient_data', `intention '${intention}' has runs but no trials`, {
      source,
    })
  }
  const n = pooled.length
  const z = stoufferZ(pooled)
  const bits = n * bitsPerTrial
  const effectSize = z / Math.sqrt(bits)
  const half = Z_975 / Math.sqrt(bits)
  const tail = intention === 'high' ? 'upper' : intention === 'low' ? 'lower' : 'two'
  return Object.freeze({
    intention,
    runs: group.length,
    trials: n,
    bits,
    meanZ: z / Math.sqrt(n),
    z,
    pValue: normalP(z, tail),
    effectSize,
    ci95: Object.freeze([effectSize - half, effectSize + half] as [number, number]),
  })
}

/**
 * Analyze completed tripolar runs. Pools each intention's trials, normalizes
 * with negentropy's theoretical $\mathrm{Binomial}(k,\tfrac12)$ calibration
 * ($z = (x - k/2)/\sqrt{k/4}$), and combines per intention with Stouffer's
 * method (Jahn, Dunne et al. 1997; Radin & Nelson 1989 meta-analysis).
 * The primary statistic is `deltaZ` (high minus low): under H0 it is
 * standard normal regardless of any common-mode bias shared by the two
 * intentions, because the shared shift cancels in the difference.
 * CIs use the normal approximation to the binomial — excellent for
 * $N_{\text{bits}} \gtrsim 10^3$.
 *
 * Requires at least one `high` and one `low` run; `baseline` is optional
 * but recommended (it is the drift control). All runs must come from one
 * source at one `bitsPerTrial` — anything else is a `source_mismatch`.
 */
export function analyzeTripolar(runs: readonly TripolarRun[]): TripolarAnalysis {
  if (runs.length === 0) {
    throw new PsiError('insufficient_data', 'analyzeTripolar needs at least one run')
  }
  const first = runs[0] as TripolarRun
  const source = first.series.source
  const bitsPerTrial = first.series.bitsPerTrial
  for (const run of runs) {
    if (run.series.source !== source) {
      throw new PsiError(
        'source_mismatch',
        `runs mix sources: '${run.series.source}' and '${source}'`,
      )
    }
    if (run.series.bitsPerTrial !== bitsPerTrial) {
      throw new PsiError(
        'source_mismatch',
        `runs mix bitsPerTrial: ${run.series.bitsPerTrial} and ${bitsPerTrial}`,
        { source },
      )
    }
  }
  const grouped: Record<Intention, TripolarRun[]> = { high: [], low: [], baseline: [] }
  for (const run of runs) grouped[run.intention].push(run)
  const high = summarize('high', grouped.high, source, bitsPerTrial)
  const low = summarize('low', grouped.low, source, bitsPerTrial)
  if (!high || !low) {
    throw new PsiError(
      'insufficient_data',
      "analyzeTripolar needs at least one 'high' and one 'low' run",
      { source },
    )
  }
  const baseline = summarize('baseline', grouped.baseline, source, bitsPerTrial)
  const se = Math.sqrt(1 / high.bits + 1 / low.bits)
  const deltaEffect = high.effectSize - low.effectSize
  const deltaZ = deltaEffect / se
  return Object.freeze({
    source,
    bitsPerTrial,
    high,
    low,
    ...(baseline && { baseline }),
    deltaZ,
    deltaP: normalP(deltaZ, 'upper'),
    deltaEffect,
    deltaCi95: Object.freeze([deltaEffect - Z_975 * se, deltaEffect + Z_975 * se] as [
      number,
      number,
    ]),
  })
}
