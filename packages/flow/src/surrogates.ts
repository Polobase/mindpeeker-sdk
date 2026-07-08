/**
 * Surrogate-data generators (Theiler et al. 1992, "Testing for nonlinearity
 * in time series: the method of surrogate data"). Both take an explicit
 * unit-uniform generator — pair with {@link xorshift32} for reproducible
 * surrogate ensembles.
 */

import { randomInt } from './internal/prng.js'
import { validateSymbols } from './internal/symbols.js'

/**
 * Fisher–Yates shuffle of the source symbols. Preserves the marginal
 * distribution $\hat p(x)$ exactly, destroys ALL temporal structure — the
 * strongest null for "does source timing inform the destination at all?"
 * and the surrogate Marschinski–Kantz effective TE is defined against.
 * The input is copied, never mutated.
 */
export function sourceShuffle(symbols: ArrayLike<number>, rng: () => number): Int32Array {
  const { symbols: out } = validateSymbols(symbols, 'symbols')
  for (let i = out.length - 1; i >= 1; i--) {
    const j = randomInt(rng, i + 1)
    const tmp = out[i] as number
    out[i] = out[j] as number
    out[j] = tmp
  }
  return out
}

/**
 * Circular shift by a random offset in $[1, n-1]$:
 * `out[i] = symbols[(i + offset) mod n]`. Preserves the source's full
 * autocorrelation structure (up to wraparound), destroys only its alignment
 * with the destination — a stricter null than {@link sourceShuffle} when the
 * source is itself autocorrelated. Inputs shorter than 2 symbols are
 * returned as unshifted copies (no nontrivial rotation exists).
 */
export function circularShift(symbols: ArrayLike<number>, rng: () => number): Int32Array {
  const { symbols: input } = validateSymbols(symbols, 'symbols')
  const n = input.length
  if (n < 2) return input
  const offset = 1 + randomInt(rng, n - 1)
  const out = new Int32Array(n)
  for (let i = 0; i < n; i++) out[i] = input[(i + offset) % n] as number
  return out
}
