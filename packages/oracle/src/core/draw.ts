import { OracleError } from '../errors.js'
import type { ByteReader } from './reader.js'
import { uniformInt } from './uniform.js'

/**
 * Draw `count` distinct indices from $\{0, \dots, n-1\}$ without
 * replacement via the Fisher–Yates shuffle (Knuth, TAOCP vol. 2,
 * Algorithm 3.4.2P), stopping after the first `count` positions — an
 * unbiased permutation prefix.
 *
 * Each swap index is drawn with {@link uniformInt}, so every one of the
 * $$\frac{n!}{(n-\texttt{count})!}$$ ordered prefixes has exactly equal
 * probability — provided the input bytes are uniform, the mapping adds no
 * bias of its own (unlike modulo reduction). Draw $i$ consumes a uniform
 * integer in $[0, n-i)$; the final draw over a single remaining slot
 * consumes zero bytes.
 *
 * Memory is $O(\texttt{count})$ regardless of `n` (a sparse swap map stands in
 * for the identity array), so e.g. 3 of $2^{32}$ ids is cheap.
 *
 * @throws OracleError `'invalid_input'` unless `n`, `count` are integers
 *   with $0 \le \texttt{count} \le n \le 2^{32}$
 */
export async function drawWithoutReplacement(
  reader: ByteReader,
  n: number,
  count: number,
): Promise<readonly number[]> {
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 32) {
    throw new OracleError(
      'invalid_input',
      `drawWithoutReplacement n must be an integer in [0, 2^32], got ${n}`,
    )
  }
  if (!Number.isInteger(count) || count < 0 || count > n) {
    throw new OracleError(
      'invalid_input',
      `drawWithoutReplacement count must be an integer in [0, n=${n}], got ${count}`,
    )
  }
  // Sparse Fisher–Yates: `displaced` holds only slots whose value differs
  // from their index (the virtual identity array elsewhere), so memory is
  // O(count) for any n — and the swap sequence, output, and byte
  // consumption are identical to the dense in-place shuffle.
  const displaced = new Map<number, number>()
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const j = i + (await uniformInt(reader, n - i))
    out.push(displaced.get(j) ?? j)
    displaced.set(j, displaced.get(i) ?? i)
    // Slot i is final from here on (every later j > i): drop it.
    displaced.delete(i)
  }
  return out
}
