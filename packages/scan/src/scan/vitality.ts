import { type ByteReader, uniformInt } from '@mindpeeker/oracle'
import { ScanError } from '../errors.js'
import { openReader } from '../internal/reader.js'
import { toScanError } from '../internal/rethrow.js'
import { abortSignal, byteSource, optionsObject } from '../internal/validate.js'
import type { ByteSource, VitalityOptions } from '../types.js'

/**
 * AetherOnePi's Auto-Mode broadcast threshold: a rate whose GV exceeds 1400
 * (or exceeds the target's GV by 700) is broadcast automatically. It is not a
 * "hit" marker — AetherOnePi's HIT flag marks the entry with the highest GV.
 * Under a fair source $P(\mathrm{GV} > 1400) \approx 0.00225$
 * (`generalVitalitySf(1400)`).
 */
export const GV_AUTO_MODE_THRESHOLD = 1400

/**
 * General Vitality (GV) on a {@link ByteReader}, as AetherOnePy computes it.
 *
 * $$\mathrm{GV} = \max(d_1, d_2, d_3), \qquad d_i \sim \mathcal{U}\{0,\dots,1000\}$$
 *
 * best-of-three uniform draws. If $\mathrm{GV} > 950$ an open-ended
 * "explosion" runs: repeatedly draw $x \sim \mathcal{U}\{0,\dots,100\}$ and
 * while $x \ge 50$ add it to GV. Both draws use `uniformInt` (rejection
 * sampled), never modulo. (AetherOnePi's Java draws `nextInt(1000)` and
 * `nextInt(100)`, i.e. one value less at the top of each range.)
 *
 * The distribution is right-skewed by the max-of-three and heavy-tailed past
 * 1000 by the explosion — and it is **known exactly**: see
 * {@link generalVitalitySf}. A fair source produces every GV at exactly those
 * rates, so a GV carries no information about a target. The caller owns
 * `reader`.
 */
export async function generalVitalityReader(reader: ByteReader): Promise<number> {
  let gv = 0
  for (let i = 0; i < 3; i++) {
    const d = await uniformInt(reader, 1001)
    if (d > gv) gv = d
  }
  if (gv > 950) {
    let dice = await uniformInt(reader, 101)
    while (dice >= 50) {
      gv += dice
      dice = await uniformInt(reader, 101)
    }
  }
  return gv
}

/**
 * {@link generalVitalityReader} over any {@link ByteSource} — the exposed GV
 * primitive. Opens one stream and closes it when done. Deterministic per byte
 * stream.
 *
 * @throws {ScanError} `invalid_options`, `insufficient_entropy`,
 *   `source_error`, `aborted`
 */
export async function generalVitality(
  source: ByteSource,
  opts: VitalityOptions = {},
): Promise<number> {
  const o = optionsObject(opts, 'generalVitality options')
  const src = byteSource(source)
  const reader = openReader(src, abortSignal(o.signal))
  try {
    return await generalVitalityReader(reader)
  } catch (error) {
    throw toScanError(error, src.name, 'general vitality draw')
  } finally {
    await reader.close()
  }
}

/** Beyond this explosion excess the tail is below the smallest double. */
const EXCESS_CAP = 110_000
/** `tail[u]` = P(S > u) for the explosion sum S (grown on demand). */
let tail = new Float64Array(0)

function explosionTail(u: number): number {
  if (u < 0) return 1
  if (u > EXCESS_CAP) return 0
  if (u >= tail.length) {
    const next = new Float64Array(Math.min(EXCESS_CAP + 1, Math.max(u + 1, 2 * tail.length, 1024)))
    next.set(tail)
    for (let v = tail.length; v < next.length; v++) {
      // S > v  ⟺  the first die x ∈ {50..100} continues and x + S' > v
      let sum = 0
      for (let x = 50; x <= 100; x++) sum += v - x < 0 ? 1 : (next[v - x] as number)
      next[v] = sum / 101
    }
    tail = next
  }
  return tail[u] as number
}

/**
 * The exact upper tail of General Vitality under a fair source,
 * $P(\mathrm{GV} > t)$, for the procedure of {@link generalVitalityReader}.
 *
 * With $M = \max(d_1, d_2, d_3)$, $P(M = m) = \big((m+1)^3 - m^3\big)/1001^3$;
 * GV $= M$ for $M \le 950$ and $M + S$ otherwise, where the explosion sum $S$
 * has the renewal tail
 * $$T(u) = P(S > u) = \frac{1}{101}\sum_{x=50}^{100} T(u - x), \qquad T(v) = 1 \text{ for } v < 0,$$
 * so
 * $$P(\mathrm{GV} > t) = \sum_{m} P(M = m)\,\big[m \le 950\ ?\ \mathbf 1(m > t) : T(t - m)\big].$$
 * `t` is floored; $P(\mathrm{GV} > t) = 1$ for $t < 0$. Evaluated in double
 * precision (checked against exact rational arithmetic); tails below the
 * smallest double return 0. Examples: $P(\mathrm{GV} > 950) \approx 0.1425$,
 * $P(\mathrm{GV} > 1000) \approx 0.0720$,
 * $P(\mathrm{GV} > 1400) \approx 0.00225$ — AetherOnePi's Auto-Mode threshold
 * fires for about one fair-source GV in 444 under this procedure.
 *
 * @throws {ScanError} `invalid_options` for a non-number or NaN threshold
 */
export function generalVitalitySf(threshold: number): number {
  if (typeof threshold !== 'number' || Number.isNaN(threshold)) {
    throw new ScanError('invalid_options', `threshold must be a number; got ${String(threshold)}`)
  }
  const t = Math.floor(threshold)
  if (t < 0) return 1
  if (t < 950) {
    const q = (t + 1) / 1001
    return 1 - q * q * q
  }
  const cube = 1001 * 1001 * 1001
  let total = 0
  for (let m = 1000; m > 950; m--) {
    const pm = ((m + 1) * (m + 1) * (m + 1) - m * m * m) / cube
    total += pm * (m > t ? 1 : explosionTail(t - m))
  }
  return total
}
