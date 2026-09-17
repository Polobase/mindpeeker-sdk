import { normalP, stoufferZ, theoreticalCalibration, zScores } from '@mindpeeker/negentropy'
import { binomialPmf, chi2Cdf, chi2Sf, normPpf } from '@mindpeeker/negentropy/numerics'
import { PsiError } from '../errors.js'
import { assertSeries } from '../internal/validate.js'
import type { Intention } from '../types.js'
import type { TripolarRun } from './tripolar.js'
import { INTENTIONS, type RegisteredTripolar, TRIPOLAR_SCHEMA } from './tripolar-schedule.js'

/** $z_{0.975} = \Phi^{-1}(0.975)$ — the 95% two-sided normal critical value. */
const Z_975 = normPpf(0.975)

/**
 * Variance ("bind") test of one intention's trials. PEAR reported baseline
 * runs whose mean sat at chance but with "a statistically significant surplus
 * of scores at the precise theoretical mean" — a variance *deficit* a
 * mean-shift test cannot see.
 */
export interface VarianceSummary {
  /** $S = \sum_i z_i^2$. */
  readonly statistic: number
  /** Trials $n$: $S \sim \chi^2(n)$ under H0. */
  readonly df: number
  /** Lower tail $P(\chi^2_n \le S)$ — small for a variance deficit (the bind). */
  readonly pLower: number
  /** Upper tail $P(\chi^2_n \ge S)$ — small for a variance excess. */
  readonly pUpper: number
  /** `varianceZ` $= \Phi^{-1}(p_\text{lower})$: negative for a deficit, positive for an excess. */
  readonly z: number
  /** Trials whose sum is exactly $k/2$. */
  readonly atMean: number
  /** Expected such trials under H0: $n \cdot \binom{k}{k/2} 2^{-k}$ (0 for odd $k$). */
  readonly atMeanExpected: number
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
  /** Variance ("bind") test over the same trials. */
  readonly variance: VarianceSummary
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
   * with $N$ the bit counts. It reduces to $(z_H - z_L)/\sqrt{2}$ only for
   * balanced designs ($N_H = N_L$); for unequal budgets the naive form is wrong.
   */
  readonly deltaZ: number
  /** One-sided p of `deltaZ` (H1: high > low — the pre-stated direction). */
  readonly deltaP: number
  /** $\varepsilon_H - \varepsilon_L$, the per-bit effect separation. */
  readonly deltaEffect: number
  /** 95% CI on `deltaEffect` via the normal approximation. */
  readonly deltaCi95: readonly [number, number]
  /** Schedule digest shared by every run (absent for hand-built runs without one). */
  readonly scheduleDigest?: string
  /** Hash of the registration the runs were checked against. */
  readonly registration?: string
  /** Divergences from the registration (only with `deviations: 'report'`; empty when conforming). */
  readonly deviations?: readonly string[]
}

/** Options for {@link analyzeTripolar}. */
export interface AnalyzeTripolarOptions {
  /** Check the runs against this pre-registration ({@link registerTripolar}). */
  registration?: RegisteredTripolar
  /** `'throw'` (default) raises `plan_mismatch` on any divergence; `'report'` lists them in the result. */
  deviations?: 'throw' | 'report'
}

function varianceOf(zs: readonly number[], k: number): VarianceSummary {
  let statistic = 0
  for (const z of zs) statistic += z * z
  const n = zs.length
  const pLower = chi2Cdf(statistic, n)
  const pUpper = chi2Sf(statistic, n)
  const z =
    pLower < 0.5
      ? normPpf(Math.max(pLower, Number.MIN_VALUE))
      : -normPpf(Math.max(Math.min(pUpper, 0.5), Number.MIN_VALUE))
  return Object.freeze({
    statistic,
    df: n,
    pLower,
    pUpper,
    z,
    atMean: 0,
    atMeanExpected: k % 2 === 0 ? n * binomialPmf(k / 2, k, 0.5) : 0,
  })
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
  let atMean = 0
  for (const run of group) {
    for (const z of zScores(run.series, cal)) pooled.push(z)
    for (const sum of run.series.sums) if (sum === bitsPerTrial / 2) atMean++
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
    variance: Object.freeze({ ...varianceOf(pooled, bitsPerTrial), atMean }),
  })
}

/** Every divergence of `runs` from the registered plan, as human-readable strings. */
function registrationDeviations(
  runs: readonly TripolarRun[],
  registration: RegisteredTripolar,
  bitsPerTrial: number,
): string[] {
  if (
    typeof registration !== 'object' ||
    registration === null ||
    registration.schema !== TRIPOLAR_SCHEMA ||
    typeof registration.hash !== 'string' ||
    typeof registration.plan !== 'object'
  ) {
    throw new PsiError('invalid_plan', 'registration must come from registerTripolar')
  }
  const plan = registration.plan
  const out: string[] = []
  if (bitsPerTrial !== plan.bitsPerTrial) {
    out.push(`bitsPerTrial ${bitsPerTrial} ≠ registered ${plan.bitsPerTrial}`)
  }
  const counts: Record<Intention, number> = { high: 0, low: 0, baseline: 0 }
  const sequences = new Set<number>()
  const total = 3 * plan.runsPerIntention
  for (const run of runs) {
    counts[run.intention]++
    if (run.series.sums.length !== plan.trialsPerRun) {
      out.push(
        `run ${run.sequence} has ${run.series.sums.length} trials ≠ registered ${plan.trialsPerRun}`,
      )
    }
    if (!Number.isInteger(run.sequence) || run.sequence < 0 || run.sequence >= total) {
      out.push(`run sequence ${run.sequence} is outside the registered 0…${total - 1}`)
    } else if (sequences.has(run.sequence)) {
      out.push(`run sequence ${run.sequence} appears twice`)
    } else {
      sequences.add(run.sequence)
      const expected = registration.schedule?.[run.sequence]
      if (expected !== undefined && expected !== run.intention) {
        out.push(
          `run ${run.sequence} is '${run.intention}' but the registered schedule says '${expected}'`,
        )
      }
    }
    if (run.scheduleDigest !== undefined && run.scheduleDigest !== registration.scheduleDigest) {
      out.push(`run ${run.sequence} carries a different schedule digest`)
    }
    if (run.order !== undefined && run.order !== plan.order) {
      out.push(`run ${run.sequence} used order '${run.order}' ≠ registered '${plan.order}'`)
    }
    if (run.xorSafeguard !== undefined && run.xorSafeguard !== plan.xorSafeguard) {
      out.push(
        `run ${run.sequence} xorSafeguard ${run.xorSafeguard} ≠ registered ${plan.xorSafeguard}`,
      )
    }
  }
  for (const intention of INTENTIONS) {
    if (counts[intention] !== plan.runsPerIntention) {
      out.push(
        `${counts[intention]} '${intention}' runs ≠ registered ${plan.runsPerIntention}${counts[intention] < plan.runsPerIntention ? ' (stopped early?)' : ''}`,
      )
    }
  }
  return out
}

/**
 * Analyze completed tripolar runs. Pools each intention's trials, normalizes
 * with negentropy's theoretical $\mathrm{Binomial}(k,\tfrac12)$ calibration
 * ($z = (x - k/2)/\sqrt{k/4}$), and combines per intention with Stouffer's
 * method (Jahn, Dunne et al. 1997; Radin & Nelson 1989 meta-analysis).
 * The primary statistic is `deltaZ` (high minus low) on the per-bit scale,
 * whose standard error $\sqrt{1/N_H + 1/N_L}$ is the bit-level form of Rhine &
 * Pratt's $SD_\text{diff} = SD_\text{run}\sqrt{1/R_1 + 1/R_2}$ for unequal
 * groups. A *constant* bias shared by both intentions cancels in the
 * difference; time-varying drift cancels only as far as the schedule allows
 * (see `TripolarOrder`). CIs use the normal approximation to the binomial —
 * excellent for $N_{\text{bits}} \gtrsim 10^3$. Each intention also reports
 * a variance ("bind") test; the χ² law of $\sum z^2$ is the de Moivre–Laplace
 * approximation ($\mathrm{Var}(z^2) = 2 - 2/k$ for Binomial trials, so it is
 * very slightly conservative).
 *
 * Requires at least one `high` and one `low` run; `baseline` is optional but
 * recommended (it is the drift control). All runs must come from one source
 * and arm at one `bitsPerTrial`; analyze a control arm separately and compare
 * with `controlContrast`. With `registration`, the runs must match the
 * registered plan exactly — run counts, run length, trial size, schedule,
 * schedule digest, order, and XOR safeguard.
 *
 * @throws {PsiError} `invalid_plan` (unknown intention labels, malformed
 *   series, mixed arms, bad registration), `source_mismatch` (mixed sources or
 *   `bitsPerTrial`), `plan_mismatch` (mixed schedule digests, or divergence from
 *   the registration), `insufficient_data` (no runs, no high or no low runs).
 */
export function analyzeTripolar(
  runs: readonly TripolarRun[],
  opts: AnalyzeTripolarOptions = {},
): TripolarAnalysis {
  if (!Array.isArray(runs as unknown) || runs.length === 0) {
    throw new PsiError('insufficient_data', 'analyzeTripolar needs at least one run')
  }
  const mode = opts.deviations ?? 'throw'
  if (mode !== 'throw' && mode !== 'report') {
    throw new PsiError(
      'invalid_plan',
      `deviations must be 'throw' or 'report', got ${String(mode)}`,
    )
  }
  runs.forEach((run, i) => {
    if (typeof run !== 'object' || run === null) {
      throw new PsiError('invalid_plan', `run ${i} is not an object`)
    }
    if (!INTENTIONS.includes(run.intention)) {
      throw new PsiError(
        'invalid_plan',
        `run ${i} has unknown intention ${JSON.stringify(run.intention)} — expected high, low, or baseline`,
      )
    }
    assertSeries(run.series, `run ${i} series`)
  })
  const first = runs[0] as TripolarRun
  const source = first.series.source
  const bitsPerTrial = first.series.bitsPerTrial
  const arm = first.arm ?? 'experimental'
  const digests = new Set<string | undefined>()
  for (const run of runs) {
    if ((run.arm ?? 'experimental') !== arm) {
      throw new PsiError(
        'invalid_plan',
        'runs mix experimental and control arms — analyze each arm separately',
      )
    }
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
    digests.add(run.scheduleDigest)
  }
  const defined = [...digests].filter((d): d is string => d !== undefined)
  if (defined.length > 1) {
    throw new PsiError('plan_mismatch', 'runs carry different schedule digests', { source })
  }
  const digest = digests.size === 1 ? defined[0] : undefined
  let deviations: string[] | undefined
  if (opts.registration !== undefined) {
    deviations = registrationDeviations(runs, opts.registration, bitsPerTrial)
    if (mode === 'throw' && deviations.length > 0) {
      throw new PsiError(
        'plan_mismatch',
        `runs diverge from registration ${opts.registration.hash.slice(0, 12)}…: ${deviations[0]}${deviations.length > 1 ? ` (+${deviations.length - 1} more)` : ''}`,
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
      {
        source,
      },
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
    ...(digest !== undefined && { scheduleDigest: digest }),
    ...(opts.registration !== undefined && { registration: opts.registration.hash }),
    ...(mode === 'report' && deviations !== undefined && { deviations: Object.freeze(deviations) }),
  })
}
