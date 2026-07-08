import { OracleError } from '../errors.js'
import type { BitReader } from './bits.js'

/**
 * Draw an index with EXACT rational probabilities $w_i / 2^k$ — no
 * floating-point thresholds anywhere.
 *
 * `weights` must be non-negative integers summing to a power of two
 * $2^k$ (with $1 \le k \le 48$… $k = 0$ is allowed and consumes nothing).
 * The draw reads $k$ bits MSB-first as $v \in [0, 2^k)$ and returns the
 * smallest $i$ with $$v < \sum_{j \le i} w_j,$$ i.e. index $i$ owns exactly
 * $w_i$ of the $2^k$ equiprobable bit patterns:
 * $\Pr[i] = w_i / 2^k$ exactly. This is the flat (depth-$k$) case of the
 * Knuth–Yao discrete distribution generating tree (Knuth & Yao, "The
 * complexity of nonuniform random number generation", 1976), which is
 * optimal here because the distribution is dyadic.
 *
 * Byte cost: exactly $k$ bits per draw, no rejection — e.g. the yarrow-stalk
 * weights $[1,5,7,3]$ over $16$ consume exactly 4 bits.
 *
 * @throws OracleError `'invalid_input'` for empty weights, negative or
 *   non-integer weights, or a total that is not a power of two $\le 2^{48}$
 */
export async function weightedIndex(bits: BitReader, weights: readonly number[]): Promise<number> {
  if (weights.length === 0) {
    throw new OracleError('invalid_input', 'weightedIndex needs at least one weight')
  }
  let total = 0
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0) {
      throw new OracleError('invalid_input', `weights must be non-negative integers, got ${w}`)
    }
    total += w
  }
  const k = Math.log2(total)
  if (!Number.isInteger(k) || k < 0 || k > 48) {
    throw new OracleError(
      'invalid_input',
      `weights must sum to a power of two in [1, 2^48], got ${total}`,
    )
  }
  const v = await bits.nextBits(k)
  let cumulative = 0
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i] as number
    if (v < cumulative) return i
  }
  /* unreachable: v < 2^k = total */
  throw new OracleError('invalid_input', 'weightedIndex internal invariant violated')
}
