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
  const indices = Array.from({ length: n }, (_, i) => i)
  for (let i = 0; i < count; i++) {
    const j = i + (await uniformInt(reader, n - i))
    const tmp = indices[i] as number
    indices[i] = indices[j] as number
    indices[j] = tmp
  }
  return indices.slice(0, count)
}
