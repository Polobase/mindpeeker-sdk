import { OracleError } from '../errors.js'
import type { ByteReader } from './reader.js'

/** Largest supported modulus: $2^{48}$, so $256^k \le 2^{48} < 2^{53}$ stays exact in float64. */
export const MAX_UNIFORM = 2 ** 48

/**
 * Draw a uniform integer in $[0, n)$ by rejection sampling — never modulo
 * without rejection (von Neumann, "Various techniques used in connection
 * with random digits", 1951).
 *
 * Exact procedure: with $k = \lceil \log_{256} n \rceil$ bytes per attempt,
 * read $k$ bytes as a big-endian integer $v \in [0, 256^k)$ and accept iff
 * $$v < \left\lfloor 256^k / n \right\rfloor \cdot n,$$
 * returning $v \bmod n$; otherwise discard $v$ and redraw. Every accepted
 * $v$ lies in a prefix that is an exact multiple of $n$, so each residue is
 * hit by exactly $\lfloor 256^k/n \rfloor$ values — the result is exactly
 * uniform for any byte distribution that is itself uniform.
 *
 * Acceptance probability: $\alpha = \lfloor 256^k/n \rfloor \, n / 256^k$,
 * and always $\alpha > 1/2$ — if $n \le 256^k/2$ the rejected tail is
 * $256^k \bmod n < n \le 256^k/2$; if $n > 256^k/2$ then
 * $\lfloor 256^k/n \rfloor = 1$ and the accepted prefix is $n > 256^k/2$
 * (while $n = 256^k$ gives $\alpha = 1$). Attempts are therefore geometric
 * with mean $1/\alpha < 2$: the expected byte consumption is $k/\alpha < 2k$
 * and the worst case is unbounded but exponentially unlikely.
 *
 * `n = 1` consumes zero bytes and returns 0.
 *
 * @throws OracleError `'invalid_input'` unless `n` is an integer in $[1, 2^{48}]$
 */
export async function uniformInt(reader: ByteReader, n: number): Promise<number> {
  if (!Number.isInteger(n) || n < 1 || n > MAX_UNIFORM) {
    throw new OracleError('invalid_input', `uniformInt n must be an integer in [1, 2^48], got ${n}`)
  }
  if (n === 1) return 0
  let k = 1
  let range = 256
  while (range < n) {
    k++
    range *= 256
  }
  const threshold = Math.floor(range / n) * n
  for (;;) {
    let v = 0
    for (let i = 0; i < k; i++) v = v * 256 + (await reader.next())
    if (v < threshold) return v % n
  }
}
