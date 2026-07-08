import { type ByteReader, byteReader, uniformInt } from '@mindpeeker/oracle'
import type { ByteSource, VitalityOptions } from '../types.js'

/**
 * General Vitality (GV) on a {@link ByteReader}, faithful to AetherOne.
 *
 * $$\mathrm{GV} = \max(d_1, d_2, d_3), \qquad d_i \sim \mathcal{U}\{0,\dots,1000\}$$
 *
 * best-of-three uniform draws. If $\mathrm{GV} > 950$ an open-ended
 * "explosion" runs: repeatedly draw $x \sim \mathcal{U}\{0,\dots,100\}$ and
 * while $x \ge 50$ add it to GV. Both draws use `uniformInt` (rejection
 * sampled), never modulo.
 *
 * The distribution is heavily right-skewed by the max-of-three, and the
 * explosion gives it a heavy tail past 1000. **AetherOne treats
 * $\mathrm{GV} > 1400$ as a "hit"; that threshold has no chance baseline —
 * a fair source produces exactly these values at exactly these rates.** GV is
 * reported for context; the honest evidence lives in the deviation model.
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
 * primitive. Deterministic per byte stream.
 */
export async function generalVitality(
  source: ByteSource,
  opts: VitalityOptions = {},
): Promise<number> {
  const reader = byteReader(source, opts.signal ? { signal: opts.signal } : {})
  return generalVitalityReader(reader)
}
