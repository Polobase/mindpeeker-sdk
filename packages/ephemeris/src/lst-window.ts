import { EphemerisError } from './errors.js'
import {
  createRng,
  resolvePermutations,
  resolveSidereal,
  resolveTrials,
  strataGroups,
} from './internal/lst-trials.js'
import type { LstTrial, LstWindowTestOptions, LstWindowTestResult } from './types.js'

const DEFAULT_PERMUTATIONS = 9999

/**
 * Confirmatory test of one **pre-registered** LST window: is the mean effect
 * of trials with LST in $[c - h,\ c + h)$ (on the 24 h circle) higher than
 * that of the remaining trials? No window is searched, so there is no
 * multiplicity to pay — which is why the window must be fixed before the data
 * exist (e.g. Spottiswoode's 13.47 h ± 1 h for new data; never a window read
 * off the same data's scan).
 *
 * Statistic: $D = \bar e_\mathrm{in} - \bar e_\mathrm{out}$. Null: effects
 * exchangeable across trials (within strata when given). Each of the $m$
 * relabelings draws, per stratum, the stratum's inside count of effects
 * uniformly without replacement (partial Fisher–Yates with the seeded
 * xoshiro128** generator); with the group sizes fixed, $D$ is monotone in the
 * inside sum, so exceedances are counted on that sum (ties within
 * $4 n \varepsilon \sum|e|$ count). One-sided add-one p-value
 * $(1 + b)/(1 + m)$.
 *
 * @throws {EphemerisError} `invalid_options` for a bad centre, half width,
 *   permutation count or seed; `invalid_input`/`invalid_time` for malformed
 *   trials; `insufficient_data` when the window or its complement is empty.
 */
export function lstWindowTest(
  trials: readonly LstTrial[],
  opts: LstWindowTestOptions,
): LstWindowTestResult {
  if (opts === null || typeof opts !== 'object') {
    throw new EphemerisError(
      'invalid_options',
      'options { centerHours, halfWidthHours } are required',
    )
  }
  const { centerHours, halfWidthHours } = opts
  if (typeof centerHours !== 'number' || !(centerHours >= 0 && centerHours < 24)) {
    throw new EphemerisError(
      'invalid_options',
      `centerHours must be in [0, 24), got ${String(centerHours)}`,
    )
  }
  if (typeof halfWidthHours !== 'number' || !(halfWidthHours > 0 && halfWidthHours < 12)) {
    throw new EphemerisError(
      'invalid_options',
      `halfWidthHours must be in (0, 12), got ${String(halfWidthHours)}`,
    )
  }
  const permutations = resolvePermutations(opts.permutations, DEFAULT_PERMUTATIONS)
  const rng = createRng(opts.seed)
  const resolved = resolveTrials(trials, resolveSidereal(opts.sidereal), 2)
  const { lstHours, effects } = resolved
  const n = effects.length

  const inside = new Uint8Array(n)
  let nIn = 0
  let sumIn = 0
  let total = 0
  let sumAbs = 0
  for (let i = 0; i < n; i++) {
    const e = effects[i] as number
    total += e
    sumAbs += Math.abs(e)
    const shifted = ((((lstHours[i] as number) - centerHours + halfWidthHours) % 24) + 24) % 24
    if (shifted < 2 * halfWidthHours) {
      inside[i] = 1
      nIn++
      sumIn += e
    }
  }
  const nOut = n - nIn
  if (nIn === 0 || nOut === 0) {
    throw new EphemerisError(
      'insufficient_data',
      `the window holds ${nIn} of ${n} trials; both it and its complement must be non-empty`,
    )
  }
  const meanIn = sumIn / nIn
  const meanOut = (total - sumIn) / nOut
  const overallMean = total / n

  const groups = strataGroups(resolved.strata, resolved.strataCount)
  const pools = groups.map((positions) => Float64Array.from(positions, (p) => effects[p] as number))
  const draws = groups.map((positions) => {
    let count = 0
    for (const p of positions) count += inside[p] as number
    return count
  })
  const tolerance = 4 * n * Number.EPSILON * sumAbs
  let exceedances = 0
  for (let b = 0; b < permutations; b++) {
    let s = 0
    for (let g = 0; g < groups.length; g++) {
      const pool = pools[g] as Float64Array
      const size = pool.length
      const k = draws[g] as number
      for (let i = 0; i < k; i++) {
        const j = i + rng.uniformInt(size - i)
        const drawn = pool[j] as number
        pool[j] = pool[i] as number
        pool[i] = drawn
        s += drawn
      }
    }
    if (s >= sumIn - tolerance) exceedances++
  }
  return {
    centerHours,
    halfWidthHours,
    inside: { n: nIn, mean: meanIn },
    outside: { n: nOut, mean: meanOut },
    overallMean,
    difference: meanIn - meanOut,
    gain: overallMean > 0 ? meanIn / overallMean : null,
    permutations,
    exceedances,
    pValue: (1 + exceedances) / (1 + permutations),
    stratified: resolved.stratified,
    strata: resolved.strataCount,
  }
}
