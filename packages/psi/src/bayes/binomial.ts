import { lnGamma } from '@mindpeeker/negentropy/numerics'
import { PsiError } from '../errors.js'

/**
 * Beta prior on the per-bit probability under H1. The default
 * $\mathrm{Beta}(1,1)$ is uniform on $[0,1]$; symmetric choices with
 * $a = b > 1$ concentrate the prior near $\tfrac12$ (small anticipated
 * effects), which is the honest choice for MMI-sized deviations.
 */
export interface BetaPrior {
  /** Shape $\alpha > 0$. Default 1. */
  a?: number
  /** Shape $\beta > 0$. Default 1. */
  b?: number
}

/** $\ln B(x, y) = \ln\Gamma(x) + \ln\Gamma(y) - \ln\Gamma(x+y)$. */
function lnBeta(x: number, y: number): number {
  return lnGamma(x) + lnGamma(y) - lnGamma(x + y)
}

/**
 * Bayes factor $BF_{10}$ for $k$ one-bits in $n$ Bernoulli trials, testing
 * $H_1: p \sim \mathrm{Beta}(a, b)$ against the chance point null
 * $H_0: p = \tfrac12$. Closed form via the beta function:
 * $$BF_{10} = \frac{\int_0^1 p^k (1-p)^{n-k}\,\mathrm{Beta}(p; a, b)\,dp}
 * {2^{-n}} = \frac{B(k+a,\; n-k+b)}{B(a,b)}\, 2^n,$$
 * computed in log space via `lnGamma` so intermediate terms never overflow
 * (Jeffreys 1961, *Theory of Probability*; Wagenmakers 2007). $BF_{10} > 1$
 * favors a biased coin, $BF_{10} < 1$ favors chance — and unlike a p-value
 * it can *quantify support for the null*, the property that makes it the
 * right summary for MMI claims. The returned `Math.exp` may round to
 * `Infinity` for overwhelming evidence ($\ln BF_{10} > 709$).
 */
export function binomialBayesFactor(k: number, n: number, prior: BetaPrior = {}): number {
  const a = prior.a ?? 1
  const b = prior.b ?? 1
  if (!Number.isInteger(n) || n < 1) {
    throw new PsiError('invalid_plan', `n must be an integer ≥ 1, got ${n}`)
  }
  if (!Number.isInteger(k) || k < 0 || k > n) {
    throw new PsiError('invalid_plan', `k must be an integer in [0, ${n}], got ${k}`)
  }
  if (!(a > 0) || !Number.isFinite(a) || !(b > 0) || !Number.isFinite(b)) {
    throw new PsiError('invalid_plan', `prior shapes must be finite and > 0, got a=${a}, b=${b}`)
  }
  return Math.exp(lnBeta(k + a, n - k + b) - lnBeta(a, b) + n * Math.LN2)
}
