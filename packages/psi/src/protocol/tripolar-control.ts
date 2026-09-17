import { normCdf, normPpf, normSf } from '@mindpeeker/negentropy/numerics'
import { PsiError } from '../errors.js'
import { assertOpenInterval } from '../internal/validate.js'
import type { IntentionSummary, TripolarAnalysis } from './tripolar-analysis.js'

const Z_975 = normPpf(0.975)

/** The experimental-vs-control contrast — see {@link controlContrast}. */
export interface TripolarContrast {
  /** $\Delta\varepsilon_E - \Delta\varepsilon_C$, the difference of per-bit high−low separations. */
  readonly deltaEffectDifference: number
  /** Standard error $\sqrt{s_E^2 + s_C^2}$, $s = \sqrt{1/N_H + 1/N_L}$ per arm. */
  readonly se: number
  /** $z = (\Delta\varepsilon_E - \Delta\varepsilon_C)/\mathrm{se} \sim N(0,1)$ under the joint null. */
  readonly z: number
  /** One-sided p (H1: the experimental separation exceeds the control's). */
  readonly pValue: number
  readonly pTwoSided: number
  /** 95% CI on `deltaEffectDifference`. */
  readonly ci95: readonly [number, number]
}

function armSe(analysis: TripolarAnalysis, which: string): number {
  const nh = analysis?.high?.bits
  const nl = analysis?.low?.bits
  if (!(nh > 0 && nl > 0) || !Number.isFinite(analysis.deltaEffect)) {
    throw new PsiError('invalid_plan', `${which} must be a TripolarAnalysis with high and low bits`)
  }
  return Math.sqrt(1 / nh + 1 / nl)
}

/**
 * Contrast an experimental tripolar analysis with its yoked control arm
 * (`runTripolar(…, { control })`, each arm analyzed with `analyzeTripolar`).
 * Under the joint null — neither source responds to intention — the two
 * separations are independent and
 * $$z = \frac{\Delta\varepsilon_E - \Delta\varepsilon_C}{\sqrt{s_E^2 + s_C^2}} \sim N(0,1),$$
 * which equals $(\Delta z_E - \Delta z_C)/\sqrt2$ when the arms have equal bit
 * budgets (the yoked design). A "significant" effect that the control arm
 * reproduces indicts the pipeline, not the operator (our methodological
 * stance; PEAR reported comparable results on pseudo-random sources and read
 * them differently).
 *
 * @throws {PsiError} `invalid_plan` for malformed analyses or two analyses of
 *   the same source.
 */
export function controlContrast(
  experimental: TripolarAnalysis,
  control: TripolarAnalysis,
): TripolarContrast {
  const se = Math.sqrt(armSe(experimental, 'experimental') ** 2 + armSe(control, 'control') ** 2)
  if (experimental.source === control.source) {
    throw new PsiError(
      'invalid_plan',
      'experimental and control analyses come from the same source',
    )
  }
  const difference = experimental.deltaEffect - control.deltaEffect
  const z = difference / se
  return Object.freeze({
    deltaEffectDifference: difference,
    se,
    z,
    pValue: normSf(z),
    pTwoSided: Math.min(1, 2 * normSf(Math.abs(z))),
    ci95: Object.freeze([difference - Z_975 * se, difference + Z_975 * se] as [number, number]),
  })
}

/** Options for {@link tostEquivalence}. */
export interface EquivalenceTestOptions {
  /** Smallest per-bit effect of interest $\varepsilon_0 > 0$ (e.g. `1e-4`) — pre-register it. */
  eps0: number
  /** Level of each one-sided test. Default 0.05. */
  alpha?: number
}

/** A two one-sided tests (TOST) equivalence result — see {@link tostEquivalence}. */
export interface EquivalenceTest {
  /** Per-bit effect estimate: `deltaEffect` (analysis) or `effectSize` (intention). */
  readonly estimate: number
  readonly se: number
  readonly eps0: number
  readonly alpha: number
  /** p of H0: effect ≤ −ε₀. */
  readonly pLower: number
  /** p of H0: effect ≥ +ε₀. */
  readonly pUpper: number
  /** $\max(p_\text{lower}, p_\text{upper})$ — the TOST p. */
  readonly pValue: number
  /** True iff `pValue < alpha`: the effect lies within $(-\varepsilon_0, \varepsilon_0)$ at level α. */
  readonly equivalent: boolean
  /** The $1 - 2\alpha$ CI; equivalence ⟺ it lies inside $(-\varepsilon_0, \varepsilon_0)$. */
  readonly ci: readonly [number, number]
}

/**
 * Equivalence test by two one-sided tests (Schuirmann 1987; Lakens 2017):
 * does a per-bit effect lie inside $(-\varepsilon_0, \varepsilon_0)$? For a
 * {@link TripolarAnalysis} the effect is `deltaEffect` with
 * $\mathrm{se} = \sqrt{1/N_H + 1/N_L}$; for an {@link IntentionSummary} it is
 * `effectSize` with $\mathrm{se} = 1/\sqrt{N_\text{bits}}$. With
 * $z_- = (\hat\varepsilon + \varepsilon_0)/\mathrm{se}$ and
 * $z_+ = (\hat\varepsilon - \varepsilon_0)/\mathrm{se}$:
 * $p_\text{lower} = 1 - \Phi(z_-)$, $p_\text{upper} = \Phi(z_+)$. This is how a
 * control arm can positively *support* "no effect" at a pre-registered
 * $\varepsilon_0$ instead of merely failing to reject — PEAR-scale effects are
 * $\varepsilon \sim 10^{-4}$, so the bit budget must satisfy
 * $\mathrm{se} \ll \varepsilon_0$ for equivalence to be reachable.
 *
 * @throws {PsiError} `invalid_plan` for a non-positive `eps0`, bad `alpha`, or
 *   an input that is neither an analysis nor an intention summary.
 */
export function tostEquivalence(
  subject: TripolarAnalysis | IntentionSummary,
  opts: EquivalenceTestOptions,
): EquivalenceTest {
  const eps0 = opts?.eps0
  if (!(typeof eps0 === 'number' && Number.isFinite(eps0) && eps0 > 0)) {
    throw new PsiError('invalid_plan', `eps0 must be a finite number > 0, got ${String(eps0)}`)
  }
  const alpha = assertOpenInterval(opts.alpha ?? 0.05, 0, 0.5, 'alpha')
  let estimate: number
  let se: number
  if (typeof subject === 'object' && subject !== null && 'deltaEffect' in subject) {
    estimate = subject.deltaEffect
    se = armSe(subject, 'analysis')
  } else if (
    typeof subject === 'object' &&
    subject !== null &&
    'effectSize' in subject &&
    subject.bits > 0
  ) {
    estimate = subject.effectSize
    se = 1 / Math.sqrt(subject.bits)
  } else {
    throw new PsiError(
      'invalid_plan',
      'tostEquivalence needs a TripolarAnalysis or IntentionSummary',
    )
  }
  if (!Number.isFinite(estimate)) {
    throw new PsiError('invalid_plan', `effect estimate must be finite, got ${estimate}`)
  }
  const pLower = normSf((estimate + eps0) / se)
  const pUpper = normCdf((estimate - eps0) / se)
  const pValue = Math.max(pLower, pUpper)
  const half = normPpf(1 - alpha) * se
  return Object.freeze({
    estimate,
    se,
    eps0,
    alpha,
    pLower,
    pUpper,
    pValue,
    equivalent: pValue < alpha,
    ci: Object.freeze([estimate - half, estimate + half] as [number, number]),
  })
}
