import { chi2Sf } from '@mindpeeker/negentropy/numerics'
import { benjaminiHochberg, holm } from '@mindpeeker/psi'
import type { AdjustedDeviationResult, DeviationResult, MultiplicitySummary } from '../types.js'

/**
 * Put a family of $M$ per-item deviation tests on an honest footing: attach
 * Bonferroni, Holm (Holm 1979, via psi's `holm`) and Benjamini–Hochberg
 * (Benjamini & Hochberg 1995, via psi's `benjaminiHochberg`) adjusted p-values
 * to every item, and summarise the family — expected false positives
 * $M\alpha$, counts at level $\alpha$, and the omnibus
 * $S = \sum_i z_i^2$ with its $\chi^2(M)$ upper tail.
 *
 * Under a fair source the item counts are independent
 * $\mathrm{Binomial}(N, \tfrac12)$, so each $z_i^2$ has mean exactly 1 and
 * variance $2 - 2/N$ (slightly below the $\chi^2_1$ value 2): the $\chi^2(M)$
 * reference is the de Moivre–Laplace approximation and errs on the
 * conservative side. A small omnibus p says the *source* departs from a fair
 * coin somewhere — which is what a stuck or biased device looks like — not
 * that a particular item is special.
 *
 * `results` must be non-empty; `alpha` in $(0, 1)$ (validated by callers).
 */
export function adjustFamily(
  results: readonly DeviationResult[],
  alpha: number,
): {
  readonly adjusted: readonly AdjustedDeviationResult[]
  readonly summary: MultiplicitySummary
} {
  const m = results.length
  const ps = results.map((r) => r.p)
  const holmP = holm(ps, { alpha }).adjusted
  const bhQ = benjaminiHochberg(ps, { q: alpha }).adjusted
  let statistic = 0
  let nominalHits = 0
  let holmRejections = 0
  let bhRejections = 0
  const adjusted = results.map((r, i) => {
    statistic += r.z * r.z
    const pHolm = holmP[i] as number
    const qBH = bhQ[i] as number
    if (r.p <= alpha) nominalHits++
    if (pHolm <= alpha) holmRejections++
    if (qBH <= alpha) bhRejections++
    return Object.freeze({ ...r, pBonferroni: Math.min(1, m * r.p), pHolm, qBH })
  })
  const summary: MultiplicitySummary = Object.freeze({
    tests: m,
    alpha,
    bonferroniAlpha: alpha / m,
    expectedFalsePositives: m * alpha,
    nominalHits,
    holmRejections,
    bhRejections,
    omnibus: Object.freeze({ statistic, df: m, p: chi2Sf(statistic, m) }),
  })
  return { adjusted, summary }
}
