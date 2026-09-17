/**
 * The law of truly large numbers (Diaconis & Mosteller 1989): with a large
 * enough number of opportunities, any outrageous thing is likely to happen.
 * These are two lines of arithmetic; they are exported so a synchronicity log
 * can state its denominator next to its anecdote.
 *
 * Littlewood's "law of miracles" is the same arithmetic with invented but
 * plausible inputs (Littlewood, *A Mathematician's Miscellany*, 1953; named by
 * Dyson, 2004): count one noticed event per second for eight waking hours a
 * day, call a one-in-a-million event a miracle, and 35 days hold
 * 35 · 8 · 3600 = 1,008,000 events — `expectedCoincidences(1_008_000, 1e-6)`
 * ≈ 1.008 miracles a month. The inputs are illustrative, not measured.
 */
import { oneMinusExp } from './internal/numerics.js'
import { nonNegativeFinite, probability } from './internal/validate.js'

/**
 * Expected number of coincidences among N opportunities that each succeed
 * with probability `pPerOpportunity`: $N p$. Linearity of expectation holds
 * whether or not the opportunities are independent.
 *
 * @param opportunities number of chances N, a finite number ≥ 0
 * @param pPerOpportunity probability per chance, in [0, 1]
 */
export function expectedCoincidences(opportunities: number, pPerOpportunity: number): number {
  nonNegativeFinite('opportunities', opportunities)
  probability('pPerOpportunity', pPerOpportunity)
  return opportunities * pPerOpportunity
}

/**
 * Probability that at least one of N **independent** opportunities succeeds:
 * $1 - (1-p)^N$, formed as $-\mathrm{expm1}(N\,\mathrm{log1p}(-p))$ so
 * one-in-a-billion chances keep their digits. A "one in a million" event for
 * one person is close to certain for someone among ten million
 * (`probabilityAtLeastOne(1e7, 1e-6)` ≈ 0.99995).
 *
 * @param opportunities number of independent chances N, a finite number ≥ 0
 * @param pPerOpportunity probability per chance, in [0, 1]
 */
export function probabilityAtLeastOne(opportunities: number, pPerOpportunity: number): number {
  nonNegativeFinite('opportunities', opportunities)
  probability('pPerOpportunity', pPerOpportunity)
  if (opportunities === 0) return 0
  if (pPerOpportunity === 1) return 1
  return oneMinusExp(opportunities * Math.log1p(-pPerOpportunity))
}
