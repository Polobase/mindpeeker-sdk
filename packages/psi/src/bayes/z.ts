import { normCdf, normSf } from '@mindpeeker/negentropy/numerics'
import { PsiError } from '../errors.js'
import type { TripolarAnalysis } from '../protocol/tripolar-analysis.js'

/** Options for {@link zBayesFactor}. */
export interface ZBayesFactorOptions {
  /**
   * Prior variance of the standardized effect $\mu$ under H1, in units of
   * the statistic's own variance: $\mu \sim N(0, g)$. Finite, $> 0$.
   */
  g: number
  /**
   * `true`: H1 is the half-normal $\mu > 0$ (a pre-stated positive
   * direction). Default `false` (two-sided).
   */
  oneSided?: boolean
}

/** A Bayes factor for a standard-normal test statistic. */
export interface ZBayesFactor {
  /** The observed statistic. */
  readonly z: number
  /** Prior variance $g$ of the standardized effect. */
  readonly g: number
  readonly oneSided: boolean
  /** $\ln BF_{10}$ (or $\ln BF_{+0}$ when one-sided) — finite for every finite `z`. */
  readonly lnBf10: number
  /** $BF_{10} = e^{\ln BF_{10}}$; rounds to `Infinity`/`0` beyond double range. */
  readonly bf10: number
  /** $BF_{01} = 1/BF_{10}$: evidence *for* chance. */
  readonly bf01: number
}

const LN_SQRT_2PI = 0.9189385332046727

/** ln Φ(x), finite for every finite x (asymptotic series below −30, log1p above 0). */
function lnNormCdf(x: number): number {
  if (x > 0) return Math.log1p(-normSf(x))
  if (x >= -30) return Math.log(normCdf(x))
  // Φ(x) = φ(x)/|x| · (1 − 1/x² + 3/x⁴ − 15/x⁶ + 105/x⁸ − 945/x¹⁰ + …); next term < 2e-14 at x = −30
  const inv = 1 / (x * x)
  const series = 1 - inv * (1 - 3 * inv * (1 - 5 * inv * (1 - 7 * inv * (1 - 9 * inv))))
  return -0.5 * x * x - Math.log(-x) - LN_SQRT_2PI + Math.log(series)
}

function assertFinite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PsiError('invalid_plan', `${what} must be a finite number, got ${String(value)}`)
  }
  return value
}

/**
 * Closed-form Bayes factor for an (approximately) standard-normal test
 * statistic $z$. Model: $z \mid \mu \sim N(\mu, 1)$ with $H_0: \mu = 0$ and
 * $H_1: \mu \sim N(0, g)$, so $z \sim N(0, 1+g)$ marginally under H1 and
 * $$BF_{10} = \frac{\varphi(z;\,0,\,1+g)}{\varphi(z;\,0,\,1)}
 * = (1+g)^{-1/2} \exp\!\Big(\frac{z^2\,g}{2(1+g)}\Big).$$
 * One-sided (`oneSided: true`, H1: $\mu \sim$ half-normal on $\mu > 0$) the
 * posterior mass on $\mu > 0$ enters:
 * $$BF_{+0} = 2\,BF_{10}\;\Phi\!\Big(z\sqrt{\tfrac{g}{1+g}}\Big).$$
 * Elementary normal–normal marginalization (Johnson 2005; Held & Ott 2018,
 * *Annu. Rev. Stat. Appl.*); computed in log space (an asymptotic $\ln\Phi$
 * in the far lower tail), so `lnBf10` is finite for every finite $z$.
 *
 * `g` is the whole prior: choose it from the effect you would find
 * plausible *before* seeing data — {@link tripolarBayesFactor} derives it from
 * a per-bit effect scale. A diffuse $g$ always favors H0 for small $z$
 * (Lindley's paradox); that is a property of the prior, not of the data.
 *
 * @throws {PsiError} `invalid_plan` for a non-finite `z` or `g ≤ 0`.
 */
export function zBayesFactor(z: number, opts: ZBayesFactorOptions): ZBayesFactor {
  assertFinite(z, 'z')
  if (opts === null || typeof opts !== 'object') {
    throw new PsiError('invalid_plan', 'zBayesFactor needs options { g }')
  }
  const g = assertFinite(opts.g, 'g')
  if (!(g > 0)) throw new PsiError('invalid_plan', `g must be > 0, got ${g}`)
  const oneSided = opts.oneSided ?? false
  if (typeof oneSided !== 'boolean') {
    throw new PsiError('invalid_plan', `oneSided must be a boolean, got ${String(oneSided)}`)
  }
  const shrink = g / (1 + g)
  let lnBf10 = -0.5 * Math.log1p(g) + 0.5 * z * z * shrink
  if (oneSided) lnBf10 += Math.LN2 + lnNormCdf(z * Math.sqrt(shrink))
  return Object.freeze({
    z,
    g,
    oneSided,
    lnBf10,
    bf10: Math.exp(lnBf10),
    bf01: Math.exp(-lnBf10),
  })
}

/** Options for {@link tripolarBayesFactor}. */
export interface TripolarBayesFactorOptions {
  /**
   * Prior standard deviation $\sigma$ of the per-bit effect separation
   * $\Delta\varepsilon = \varepsilon_H - \varepsilon_L$ under H1 (where
   * $\varepsilon$ estimates $2(p - \tfrac12)$). PEAR-scale expectations are
   * $\sigma \approx 10^{-4}$ (Radin & Nelson 1989: $(3.0 \pm 0.5)\times10^{-4}$
   * per bit). Finite, $> 0$.
   */
  perBitEffectSd: number
  /**
   * Test the pre-stated direction high > low only. Default `true` — the
   * tripolar hypothesis is directional by design.
   */
  oneSided?: boolean
}

/** {@link zBayesFactor} of a tripolar analysis, with the prior mapping made explicit. */
export interface TripolarBayesFactor extends ZBayesFactor {
  readonly perBitEffectSd: number
  /** Bits behind the high and low intentions. */
  readonly highBits: number
  readonly lowBits: number
}

/**
 * Bayes factor for the PEAR primary statistic $\Delta z$ of
 * `analyzeTripolar`, under a prior stated on the per-bit scale. With
 * $\Delta z = \Delta\varepsilon/\mathrm{SE}$, $\mathrm{SE} = \sqrt{1/N_H + 1/N_L}$
 * ($N$ the bit counts), a prior $\Delta\varepsilon \sim N(0, \sigma^2)$ is
 * $\mu = \Delta\varepsilon/\mathrm{SE} \sim N(0, g)$ with
 * $$g = \frac{\sigma^2}{1/N_H + 1/N_L},$$
 * which {@link zBayesFactor} then evaluates (one-sided in the high > low
 * direction by default). The same $\sigma$ gives more decisive evidence as
 * the bit budget grows — the way to let PEAR-scale expectations
 * ($\sigma \sim 10^{-4}$) speak instead of a diffuse default, the crux of the
 * Bem–Utts–Johnson vs Wagenmakers dispute over default priors.
 *
 * @throws {PsiError} `invalid_plan` for a malformed analysis (non-finite
 *   `deltaZ`, bit counts < 1) or `perBitEffectSd` ≤ 0.
 */
export function tripolarBayesFactor(
  analysis: TripolarAnalysis,
  opts: TripolarBayesFactorOptions,
): TripolarBayesFactor {
  if (analysis === null || typeof analysis !== 'object') {
    throw new PsiError('invalid_plan', 'tripolarBayesFactor needs a TripolarAnalysis')
  }
  if (opts === null || typeof opts !== 'object') {
    throw new PsiError('invalid_plan', 'tripolarBayesFactor needs options { perBitEffectSd }')
  }
  const deltaZ = assertFinite(analysis.deltaZ, 'analysis.deltaZ')
  const highBits = analysis.high?.bits
  const lowBits = analysis.low?.bits
  for (const [bits, what] of [
    [highBits, 'analysis.high.bits'],
    [lowBits, 'analysis.low.bits'],
  ] as const) {
    if (typeof bits !== 'number' || !Number.isSafeInteger(bits) || bits < 1) {
      throw new PsiError('invalid_plan', `${what} must be an integer ≥ 1, got ${String(bits)}`)
    }
  }
  const sigma = assertFinite(opts.perBitEffectSd, 'perBitEffectSd')
  if (!(sigma > 0)) {
    throw new PsiError('invalid_plan', `perBitEffectSd must be > 0, got ${sigma}`)
  }
  const h = highBits as number
  const l = lowBits as number
  const g = (sigma * sigma) / (1 / h + 1 / l)
  if (!(g > 0) || !Number.isFinite(g)) {
    throw new PsiError('invalid_plan', `perBitEffectSd ${sigma} gives a non-representable g = ${g}`)
  }
  const bf = zBayesFactor(deltaZ, { g, oneSided: opts.oneSided ?? true })
  return Object.freeze({ ...bf, perBitEffectSd: sigma, highBits: h, lowBits: l })
}
