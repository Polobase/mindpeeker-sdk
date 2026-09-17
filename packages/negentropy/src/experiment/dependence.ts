import type { EventStatistic } from './types.js'

/**
 * H0 correlation between event statistics that share analysed steps — the
 * input to Brown's composite. Per step t with nₜ present, standardized,
 * independent, symmetric source z's of excess kurtosis κ (κ = −2/k exactly
 * for Binomial(k, ½) trials; E z³ = 0), the per-step terms of the four
 * statistics are
 *   netvar  Xₜ = Zₛ(t)²,   devvar  Yₜ = Σᵢ zᵢ²,   correlation  Sₜ = Σᵢ<ⱼ zᵢzⱼ,
 *   covar   Cₜ = Σᵢ<ⱼ uᵢuⱼ with uᵢ = zᵢ² − 1 and v = Var u = 2 + κ,
 * with exact moments (all odd cross-moments vanish):
 *   Var X = 2 + κ/n,  Var Y = n(2 + κ),  Var S = n(n − 1)/2,
 *   Var C = v²·n(n − 1)/2,
 *   Cov(X, Y) = 2 + κ,  Cov(X, S) = n − 1,  Cov(Y, S) = 0,
 *   Cov(C, X) = Cov(C, Y) = Cov(C, S) = 0.
 * (Every product of C with another term leaves some uᵢ or zᵢ of its own in an
 * expectation: E[uᵢuⱼ] = 0 for i ≠ j, and E[zᵢzⱼuᵢuⱼ] = (E z³)² = 0.) A covar
 * event is therefore uncorrelated with every other statistic; it correlates
 * only with covar events it overlaps.
 * Steps are independent, so for events A, B with step sets 𝒜, ℬ:
 *   ρ_AB = Σ_{t∈𝒜∩ℬ} Cov_ab(nₜ) / √(Σ_{t∈𝒜} Var_a(nₜ) · Σ_{t∈ℬ} Var_b(nₜ)).
 * Two netvar events over windows of lengths A, B sharing O fully-present
 * steps give O/√(AB). Event z's are monotone transforms of these statistics
 * (exactly linear for correlation, near-linear χ² probits for large df), so
 * ρ is the large-window correlation of the z's.
 */

export interface WindowedEvent {
  readonly statistic: EventStatistic
  readonly start: number
  readonly end: number
}

function variance(statistic: EventStatistic, n: number, kappa: number): number {
  switch (statistic) {
    case 'netvar':
      return 2 + kappa / n
    case 'devvar':
      return n * (2 + kappa)
    case 'correlation':
      return (n * (n - 1)) / 2
    case 'covar':
      return ((n * (n - 1)) / 2) * (2 + kappa) ** 2
  }
}

function covariance(a: EventStatistic, b: EventStatistic, n: number, kappa: number): number {
  if (a === b) return variance(a, n, kappa)
  if (a === 'covar' || b === 'covar') return 0
  const pair = new Set([a, b])
  if (pair.has('netvar') && pair.has('devvar')) return 2 + kappa
  if (pair.has('netvar')) return n - 1 // netvar × correlation
  return 0 // devvar × correlation
}

/** Steps shared by two [start, end) windows. */
export function sharedSteps(a: WindowedEvent, b: WindowedEvent): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

/** Symmetric correlation matrix (unit diagonal) of the event statistics under H0. */
export function eventCorrelations(
  events: readonly WindowedEvent[],
  counts: Uint32Array,
  kappa: number,
): number[][] {
  const totals = events.map((event) => {
    let total = 0
    for (let t = event.start; t < event.end; t++) {
      const n = counts[t] as number
      if (n > 0) total += variance(event.statistic, n, kappa)
    }
    return total
  })
  return events.map((a, i) =>
    events.map((b, j) => {
      if (i === j) return 1
      const from = Math.max(a.start, b.start)
      const to = Math.min(a.end, b.end)
      let shared = 0
      for (let t = from; t < to; t++) {
        const n = counts[t] as number
        if (n > 0) shared += covariance(a.statistic, b.statistic, n, kappa)
      }
      const scale = Math.sqrt((totals[i] as number) * (totals[j] as number))
      return scale > 0 ? Math.max(-1, Math.min(1, shared / scale)) : 0
    }),
  )
}
