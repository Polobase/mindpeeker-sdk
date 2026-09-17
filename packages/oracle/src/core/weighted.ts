import { OracleError } from '../errors.js'
import type { BitReader } from './bits.js'
import type { ByteReader } from './reader.js'
import { MAX_UNIFORM, uniformInt } from './uniform.js'

/** Validate integer weights and return their exact sum in $[1, 2^{48}]$. */
function weightTotal(weights: readonly number[], fn: string): number {
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new OracleError('invalid_input', `${fn} needs at least one weight`)
  }
  let total = 0
  for (const w of weights) {
    if (typeof w !== 'number' || !Number.isInteger(w) || w < 0) {
      throw new OracleError('invalid_input', `weights must be non-negative integers, got ${w}`)
    }
    total += w
    // Stop before the running sum can leave the exactly representable range.
    if (total > MAX_UNIFORM) {
      throw new OracleError('invalid_input', `${fn} weights must sum to at most 2^48`)
    }
  }
  if (total < 1) {
    throw new OracleError('invalid_input', `${fn} weights must not all be zero`)
  }
  return total
}

/** Smallest index whose cumulative weight exceeds `v` (requires $v <$ total). */
function cumulativeIndex(weights: readonly number[], v: number): number {
  let cumulative = 0
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i] as number
    if (v < cumulative) return i
  }
  /* unreachable: v < total */
  throw new OracleError('invalid_input', 'weighted draw internal invariant violated')
}

/**
 * Draw an index with EXACT rational probabilities $w_i / 2^k$ — no
 * floating-point thresholds anywhere.
 *
 * `weights` must be non-negative integers summing to a power of two $2^k$
 * with $0 \le k \le 48$; $k = 0$ (a single weight of 1, any number of zero
 * weights) consumes nothing. The power of two is verified arithmetically
 * ($k = \operatorname{round}(\log_2 \text{total})$, then $2^k = \text{total}$
 * exactly), not by trusting `Math.log2` to be exact.
 * The draw reads $k$ bits MSB-first as $v \in [0, 2^k)$ and returns the
 * smallest $i$ with $$v < \sum_{j \le i} w_j,$$ i.e. index $i$ owns exactly
 * $w_i$ of the $2^k$ equiprobable bit patterns:
 * $\Pr[i] = w_i / 2^k$ exactly. This is the flat (depth-$k$) case of the
 * Knuth–Yao discrete distribution generating tree (Knuth & Yao, "The
 * complexity of nonuniform random number generation", 1976), which is
 * optimal here because the distribution is dyadic.
 *
 * Byte cost: exactly $k$ bits per draw, no rejection — e.g. the yarrow-stalk
 * weights $[1,5,7,3]$ over $16$ consume exactly 4 bits. For totals that are
 * not a power of two use {@link weightedIndexRational}.
 *
 * @throws OracleError `'invalid_input'` for empty weights, negative or
 *   non-integer weights, or a total that is not a power of two in $[1, 2^{48}]$
 */
export async function weightedIndex(bits: BitReader, weights: readonly number[]): Promise<number> {
  const total = weightTotal(weights, 'weightedIndex')
  const k = Math.round(Math.log2(total))
  if (2 ** k !== total) {
    throw new OracleError(
      'invalid_input',
      `weights must sum to a power of two in [1, 2^48], got ${total}`,
    )
  }
  return cumulativeIndex(weights, await bits.nextBits(k))
}

/**
 * Draw an index with EXACT rational probabilities $w_i / W$ for any
 * non-negative integer weights with total $W = \sum_i w_i \in [1, 2^{48}]$ —
 * the non-dyadic counterpart of {@link weightedIndex} (astragalus faces
 * $[1,4,4,1]/10$, token models over 38, biased shells, …).
 *
 * Procedure: $v = $ {@link uniformInt}`(reader, W)` (exactly uniform on
 * $[0, W)$ by rejection sampling), then return the smallest $i$ with
 * $$v < \sum_{j \le i} w_j,$$ so index $i$ owns exactly $w_i$ of the $W$
 * equiprobable values: $\Pr[i] = w_i / W$ exactly. Zero weights are never
 * selected.
 *
 * Consumption is that of one `uniformInt(W)`: attempts of
 * $k = \lceil \log_{256} W \rceil$ bytes, each accepted with probability
 * $\alpha = \lfloor 256^k / W \rfloor \, W / 256^k > 1/2$, so the expected
 * cost is $k / \alpha$ bytes (`expectedBytes({ n: W, count: 1 })`) and $W = 1$
 * costs nothing. Byte-level, so it takes a `ByteReader`, not a `BitReader`:
 * when mixing it with bit draws, finish the bit reader's cast first.
 *
 * @throws OracleError `'invalid_input'` for empty weights, negative or
 *   non-integer weights, all-zero weights, or a total above $2^{48}$
 */
export async function weightedIndexRational(
  reader: ByteReader,
  weights: readonly number[],
): Promise<number> {
  const total = weightTotal(weights, 'weightedIndexRational')
  return cumulativeIndex(weights, await uniformInt(reader, total))
}
