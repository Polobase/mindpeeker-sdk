import { EphemerisError } from './errors.js'
import {
  createRng,
  type ResolvedTrials,
  resolvePermutations,
  resolveSidereal,
  resolveTrials,
  strataGroups,
} from './internal/lst-trials.js'
import type {
  LstPeak,
  LstPermutationOptions,
  LstPermutationResult,
  LstScanOptions,
  LstScanResult,
  LstTrial,
  LstWindow,
} from './types.js'

const DEFAULT_PERMUTATIONS = 9999
const MAX_WINDOWS = 86400

/**
 * Window geometry over LST-sorted trials. Window $j$ covers positions
 * $[lo_j, hi_j)$ of the padded sequence (sorted trials shifted −24 h, as is,
 * +24 h); a position $k = qn + r$ is copy $q$ of sorted trial $r$, so a
 * window sum is $(q_{hi} - q_{lo})\,S + P_{r_{hi}} - P_{r_{lo}}$ with $P$ the
 * prefix sums of one copy and $S = P_n$.
 */
interface Geometry {
  readonly n: number
  /** Trial index (input order) at each sorted position. */
  readonly order: Int32Array
  /** Length of the padded sequence (n or 3n). */
  readonly length: number
  readonly centers: Float64Array
  readonly lo: Int32Array
  readonly hi: Int32Array
  readonly loCopy: Int32Array
  readonly loRest: Int32Array
  readonly hiCopy: Int32Array
  readonly hiRest: Int32Array
}

function resolveScanOptions(opts: LstScanOptions): Required<LstScanOptions> {
  const windowHours = opts.windowHours ?? 2
  if (typeof windowHours !== 'number' || !(windowHours > 0 && windowHours <= 24)) {
    throw new EphemerisError(
      'invalid_options',
      `windowHours must be in (0, 24], got ${String(windowHours)}`,
    )
  }
  const stepHours = opts.stepHours ?? 0.1
  const count = typeof stepHours === 'number' ? Math.round(24 / stepHours) : Number.NaN
  if (
    typeof stepHours !== 'number' ||
    !(stepHours > 0 && stepHours <= 24) ||
    !(count >= 1 && count <= MAX_WINDOWS) ||
    Math.abs(count * stepHours - 24) > 1e-9
  ) {
    throw new EphemerisError(
      'invalid_options',
      `stepHours must divide 24 into 1–${MAX_WINDOWS} windows, got ${String(stepHours)}`,
    )
  }
  const pad = opts.pad ?? true
  if (typeof pad !== 'boolean') {
    throw new EphemerisError('invalid_options', `pad must be a boolean, got ${String(pad)}`)
  }
  const minTrials = opts.minTrials ?? 1
  if (!Number.isSafeInteger(minTrials) || minTrials < 1) {
    throw new EphemerisError(
      'invalid_options',
      `minTrials must be a positive integer, got ${String(minTrials)}`,
    )
  }
  return { windowHours, stepHours, pad, minTrials, sidereal: resolveSidereal(opts.sidereal) }
}

function buildGeometry(trials: ResolvedTrials, options: Required<LstScanOptions>): Geometry {
  const { lstHours } = trials
  const n = lstHours.length
  const order = Int32Array.from({ length: n }, (_, i) => i)
  order.sort((a, b) => (lstHours[a] as number) - (lstHours[b] as number) || a - b)
  const sorted = Float64Array.from(order, (i) => lstHours[i] as number)
  const length = options.pad ? 3 * n : n
  const value = options.pad
    ? (p: number) => (sorted[p % n] as number) + 24 * (Math.floor(p / n) - 1)
    : (p: number) => sorted[p] as number
  const lowerBound = (x: number): number => {
    let a = 0
    let b = length
    while (a < b) {
      const mid = (a + b) >>> 1
      if (value(mid) < x) a = mid + 1
      else b = mid
    }
    return a
  }
  const count = Math.round(24 / options.stepHours)
  const centers = new Float64Array(count)
  const lo = new Int32Array(count)
  const hi = new Int32Array(count)
  const loCopy = new Int32Array(count)
  const loRest = new Int32Array(count)
  const hiCopy = new Int32Array(count)
  const hiRest = new Int32Array(count)
  const half = options.windowHours / 2
  for (let j = 0; j < count; j++) {
    const c = (j * 24) / count
    centers[j] = c
    const a = lowerBound(c - half)
    const b = lowerBound(c + half)
    lo[j] = a
    hi[j] = b
    loCopy[j] = Math.floor(a / n)
    loRest[j] = a % n
    hiCopy[j] = Math.floor(b / n)
    hiRest[j] = b % n
  }
  return { n, order, length, centers, lo, hi, loCopy, loRest, hiCopy, hiRest }
}

/** Prefix sums of one copy of `values` into `prefix` (length n + 1). */
function fillPrefix(values: Float64Array, prefix: Float64Array): void {
  let acc = 0
  prefix[0] = 0
  for (let p = 0; p < values.length; p++) {
    acc += values[p] as number
    prefix[p + 1] = acc
  }
}

/** Sum of window `j` from one-copy prefix sums (see {@link Geometry}). */
function windowSum(geometry: Geometry, prefix: Float64Array, j: number): number {
  const total = prefix[geometry.n] as number
  return (
    ((geometry.hiCopy[j] as number) - (geometry.loCopy[j] as number)) * total +
    (prefix[geometry.hiRest[j] as number] as number) -
    (prefix[geometry.loRest[j] as number] as number)
  )
}

/** Largest window mean (ties → first window) via prefix sums of the arrangement. */
function peakIndex(
  geometry: Geometry,
  values: Float64Array,
  prefix: Float64Array,
  minTrials: number,
): { index: number; mean: number } {
  const { lo, hi } = geometry
  fillPrefix(values, prefix)
  let index = -1
  let best = Number.NEGATIVE_INFINITY
  for (let j = 0; j < lo.length; j++) {
    const count = (hi[j] as number) - (lo[j] as number)
    if (count < minTrials) continue
    const mean = windowSum(geometry, prefix, j) / count
    if (mean > best) {
      best = mean
      index = j
    }
  }
  return { index, mean: best }
}

function describePeak(
  windows: readonly LstWindow[],
  index: number,
  overallMean: number,
  options: Required<LstScanOptions>,
): LstPeak {
  const peak = windows[index] as LstWindow
  const mean = peak.mean as number
  const gain = overallMean > 0 ? mean / overallMean : null
  const count = windows.length
  const base = { centerHours: peak.centerHours, mean, n: peak.n, gain }
  if (!(mean > overallMean)) return { ...base, centroidHours: peak.centerHours, halfWidthHours: 0 }
  const level = overallMean + (mean - overallMean) / 2
  const qualifies = (j: number): boolean => {
    const w = windows[j] as LstWindow
    return w.n >= options.minTrials && w.mean !== null && w.mean >= level
  }
  const at = (offset: number): number | null => {
    const j = index + offset
    if (options.pad) return ((j % count) + count) % count
    return j >= 0 && j < count ? j : null
  }
  let left = 0
  while (left + 1 < count) {
    const j = at(-(left + 1))
    if (j === null || !qualifies(j)) break
    left++
  }
  let right = 0
  while (left + right + 1 < count) {
    const j = at(right + 1)
    if (j === null || !qualifies(j)) break
    right++
  }
  const runLength = left + right + 1
  if (runLength >= count) return { ...base, centroidHours: peak.centerHours, halfWidthHours: 12 }
  let weight = 0
  let moment = 0
  for (let offset = -left; offset <= right; offset++) {
    const w = windows[at(offset) as number] as LstWindow
    const excess = (w.mean as number) - level
    weight += excess
    moment += excess * (peak.centerHours + offset * options.stepHours)
  }
  const centroid = weight > 0 ? moment / weight : peak.centerHours
  return {
    ...base,
    centroidHours: ((centroid % 24) + 24) % 24,
    halfWidthHours: (runLength * options.stepHours) / 2,
  }
}

function scanResolved(
  trials: ResolvedTrials,
  options: Required<LstScanOptions>,
): { result: LstScanResult; geometry: Geometry; values: Float64Array } {
  const geometry = buildGeometry(trials, options)
  const { n, order, lo, hi, centers } = geometry
  const values = Float64Array.from(order, (i) => trials.effects[i] as number)
  const prefix = new Float64Array(n + 1)
  const peak = peakIndex(geometry, values, prefix, options.minTrials)
  if (peak.index < 0) {
    throw new EphemerisError(
      'insufficient_data',
      `no window holds at least minTrials = ${options.minTrials} trials`,
    )
  }
  let total = 0
  for (const v of values) total += v
  const overallMean = total / n
  const windows: LstWindow[] = []
  for (let j = 0; j < centers.length; j++) {
    const a = lo[j] as number
    const b = hi[j] as number
    const count = b - a
    const mean = count > 0 ? windowSum(geometry, prefix, j) / count : null
    let sd: number | null = null
    if (count >= 2 && mean !== null) {
      let ss = 0
      for (let p = a; p < b; p++) {
        const d = (values[p % n] as number) - mean
        ss += d * d
      }
      sd = Math.sqrt(ss / (count - 1))
    }
    windows.push({
      centerHours: centers[j] as number,
      n: count,
      mean,
      sd,
      standardError: sd === null ? null : sd / Math.sqrt(count),
    })
  }
  const result: LstScanResult = {
    n,
    overallMean,
    windows,
    peak: describePeak(windows, peak.index, overallMean, options),
    options,
  }
  return { result, geometry, values }
}

/**
 * Spottiswoode's local-sidereal-time profile (J. Sci. Explor. 11(2), 1997;
 * reprinted in McMoneagle, *Remote Viewing Secrets*, App. B): the mean effect
 * inside a boxcar window of `windowHours` whose centre moves around the
 * sidereal day in `stepHours` steps, with the data padded by copies shifted
 * ±24 h so every window spans its full width. Defaults reproduce the paper:
 * 2 h windows, 0.1 h steps, padding on.
 *
 * Window $j$ is centred at $c_j = 24j/N$ ($N = 24/\text{step}$) and holds the
 * trials with $c_j - w/2 \le \mathrm{LST} < c_j + w/2$ (half-open, so a 24 h
 * window counts each trial exactly once). The peak is the window with the
 * largest mean among those with at least `minTrials` trials.
 *
 * This is descriptive. A peak found by scanning 240 windows needs the
 * scan-aware null of {@link lstPermutationTest}; a window chosen in advance
 * is tested with {@link lstWindowTest}.
 *
 * @throws {EphemerisError} `invalid_input` for malformed trials,
 *   `invalid_time` for a bad trial time, `invalid_options` for bad options,
 *   `insufficient_data` for no trials or no admissible window.
 */
export function lstWindowScan(
  trials: readonly LstTrial[],
  opts: LstScanOptions = {},
): LstScanResult {
  const options = resolveScanOptions(opts)
  const resolved = resolveTrials(trials, options.sidereal, 1)
  return scanResolved(resolved, options).result
}

/**
 * Permutation test for "some LST window has a higher mean effect than
 * chance", with the peak search inside the statistic. Following Spottiswoode
 * (1997), effects are randomly permuted against the LST labels; each
 * relabeling is scanned with the same windows, and its largest window mean is
 * compared with the observed largest window mean:
 *
 * $p = \dfrac{1 + \#\{b : \max_j \bar e^{(b)}_j \ge \max_j \bar e_j\}}{1 + m}$.
 *
 * Because every relabeling searches all windows, the family of 240 looks is
 * already paid for: under exchangeability $P(p \le \alpha) \le \alpha$ for
 * every $m$ (the add-one estimator; Spottiswoode reported $b/m = 14/10\,000$,
 * which this formula turns into 0.0015). Ties within $4 L \varepsilon \sum|e|$
 * count as exceedances. The overall mean is invariant under relabeling, so
 * the largest mean and the largest gain are the same test.
 *
 * With `stratum` on the trials, effects move only within strata. Stratify by
 * study to keep between-study differences out of the null (Spottiswoode's
 * study-mix concern), or by local clock-time bin (see
 * {@link localMeanSolarTime}) to ask whether LST explains anything beyond time
 * of day — a sidereal peak can arise from a clock-time effect combined with
 * an uneven spread of trials over the year. To test for a trough, negate the
 * effects.
 *
 * Deterministic: the seeded xoshiro128** generator shuffles each stratum's
 * effects (in LST order, strata by first appearance) with Fisher–Yates.
 *
 * @throws {EphemerisError} as {@link lstWindowScan}, plus `invalid_options`
 *   for a bad `permutations` or `seed` and `insufficient_data` for fewer than
 *   two trials.
 */
export function lstPermutationTest(
  trials: readonly LstTrial[],
  opts: LstPermutationOptions = {},
): LstPermutationResult {
  const options = resolveScanOptions(opts)
  const permutations = resolvePermutations(opts.permutations, DEFAULT_PERMUTATIONS)
  const rng = createRng(opts.seed)
  const resolved = resolveTrials(trials, options.sidereal, 2)
  const { result, geometry, values } = scanResolved(resolved, options)
  const statistic = result.peak.mean

  const sortedStrata = Int32Array.from(geometry.order, (i) => resolved.strata[i] as number)
  const groups = strataGroups(sortedStrata, resolved.strataCount)
  const pools = groups.map((positions) => Float64Array.from(positions, (p) => values[p] as number))
  const arrangement = new Float64Array(values.length)
  const prefix = new Float64Array(values.length + 1)
  let sumAbs = 0
  for (const v of values) sumAbs += Math.abs(v)
  const tolerance = 4 * geometry.length * Number.EPSILON * sumAbs

  let exceedances = 0
  for (let b = 0; b < permutations; b++) {
    for (let g = 0; g < groups.length; g++) {
      const positions = groups[g] as Int32Array
      const pool = rng.shuffle(pools[g] as Float64Array)
      for (let i = 0; i < positions.length; i++) {
        arrangement[positions[i] as number] = pool[i] as number
      }
    }
    const { mean } = peakIndex(geometry, arrangement, prefix, options.minTrials)
    if (mean >= statistic - tolerance) exceedances++
  }
  return {
    scan: result,
    statistic,
    permutations,
    exceedances,
    pValue: (1 + exceedances) / (1 + permutations),
    stratified: resolved.stratified,
    strata: resolved.strataCount,
  }
}
