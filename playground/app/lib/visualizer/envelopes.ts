/**
 * The two envelopes the cumulative-deviation panel draws, away from the live
 * panel: the pointwise χ² band (`chi2Isf`) and the time-uniform, anytime-valid
 * boundary (`netvarBoundary`), plus a seeded H₀ check of what each level
 * actually buys when you watch the whole path.
 *
 * Every number here is the same function of $t$ the panel plots — the panel
 * evaluates it per step, this module evaluates it on a grid.
 *
 * CLIENT-ONLY: imports `@mindpeeker/*` and `@viz/*`.
 */
import { netvarBoundary } from '@mindpeeker/negentropy'
import { chi2Isf, POPCOUNT } from '@mindpeeker/negentropy/numerics'
import {
  ANYTIME_ALPHA,
  ANYTIME_PRIOR,
  POINTWISE_LOWER_P,
  POINTWISE_UPPER_P,
} from '@viz/src/demo/monitor'
import { createYielder } from '~/lib/async'
import { BITS_PER_TRIAL } from './driver'

export { ANYTIME_ALPHA, ANYTIME_PRIOR, POINTWISE_LOWER_P, POINTWISE_UPPER_P }

/** One step of both envelopes. */
export interface EnvelopeRow {
  readonly t: number
  /** `chi2Isf(0.95, t) − t` — lower edge of the two-sided 90% pointwise band. */
  readonly pointwiseLo: number
  /** `chi2Isf(0.05, t) − t` — upper edge. */
  readonly pointwiseHi: number
  /** `netvarBoundary(t, 0.05, { a: 1, b: 1, sided: 'upper' }).upper`. */
  readonly anytimeUpper: number
  /** How much wider the anytime-valid boundary is than the pointwise edge. */
  readonly ratio: number
}

/** Both envelopes at one step. */
export function envelopeAt(t: number): EnvelopeRow {
  const pointwiseLo = chi2Isf(POINTWISE_LOWER_P, t) - t
  const pointwiseHi = chi2Isf(POINTWISE_UPPER_P, t) - t
  const anytimeUpper = netvarBoundary(t, ANYTIME_ALPHA, ANYTIME_PRIOR).upper
  return { t, pointwiseLo, pointwiseHi, anytimeUpper, ratio: anytimeUpper / pointwiseHi }
}

/** Both envelopes sampled on a grid of steps. */
export interface EnvelopeCurve {
  readonly t: number[]
  readonly lo: number[]
  readonly hi: number[]
  readonly anytime: number[]
}

/**
 * Both envelopes on a grid of `points` steps up to `maxT` (t ≥ 1). `chi2Isf`
 * inverts a χ² CDF per call, so a 240-point grid costs ~100 ms — enough to
 * drop a frame. The loop yields to the event loop every 16 points.
 */
export async function envelopeCurve(
  maxT: number,
  points: number,
  signal: AbortSignal,
): Promise<EnvelopeCurve> {
  const tick = createYielder(8, signal)
  const t: number[] = []
  const lo: number[] = []
  const hi: number[] = []
  const anytime: number[] = []
  for (let i = 0; i < points; i++) {
    const step = Math.max(1, Math.round(1 + (i * (maxT - 1)) / Math.max(1, points - 1)))
    if (t[t.length - 1] === step) continue
    const row = envelopeAt(step)
    t.push(step)
    lo.push(row.pointwiseLo)
    hi.push(row.pointwiseHi)
    anytime.push(row.anytimeUpper)
    if ((i & 15) === 0) await tick()
  }
  return { t, lo, hi, anytime }
}

/** How often an H₀ path touches each boundary anywhere in `steps` steps. */
export interface CrossingReport {
  readonly paths: number
  readonly steps: number
  /** Paths that left the two-sided 90% pointwise band at least once. */
  readonly pointwise: number
  /** Paths that touched the pointwise band's upper edge at least once. */
  readonly pointwiseUpper: number
  /** Paths that touched the anytime-valid boundary at least once. */
  readonly anytime: number
  readonly bitsPerStep: number
  readonly bytesUsed: number
  /** Where the H₀ bits came from, named in the read-out. */
  readonly sourceName: string
}

/**
 * Simulate `paths` independent H₀ paths of `steps` trials each and count how
 * many touch each boundary *anywhere* along the way. Both envelopes depend
 * only on t, so they are evaluated once per step and shared across paths.
 *
 * Under H₀ each step is $\mathrm{Binomial}(200, \tfrac12)$, so
 * $z = (S - 100)/\sqrt{50}$ and $D(t) = \sum (z^2 - 1)$ — the same statistic
 * the live panel accumulates.
 */
export async function simulateCrossings(opts: {
  readonly paths: number
  readonly steps: number
  readonly bytes: (n: number) => Promise<Uint8Array>
  readonly sourceName: string
  readonly signal: AbortSignal
  readonly onProgress: (fraction: number) => void
}): Promise<CrossingReport> {
  const { paths, steps, signal } = opts
  const bytesPerTrial = BITS_PER_TRIAL / 8
  const tick = createYielder(8, signal)

  const hi = new Float64Array(steps)
  const lo = new Float64Array(steps)
  const bound = new Float64Array(steps)
  for (let i = 0; i < steps; i++) {
    const row = envelopeAt(i + 1)
    lo[i] = row.pointwiseLo
    hi[i] = row.pointwiseHi
    bound[i] = row.anytimeUpper
    if ((i & 255) === 0) {
      opts.onProgress((0.15 * i) / steps)
      await tick()
    }
  }

  let pointwise = 0
  let pointwiseUpper = 0
  let anytime = 0
  let bytesUsed = 0
  for (let p = 0; p < paths; p++) {
    const chunk = await opts.bytes(steps * bytesPerTrial)
    bytesUsed += chunk.length
    let deviation = 0
    let crossedBand = false
    let crossedUpper = false
    let crossedBound = false
    for (let s = 0; s < steps; s++) {
      let ones = 0
      const from = s * bytesPerTrial
      for (let b = 0; b < bytesPerTrial; b++) ones += POPCOUNT[chunk[from + b] ?? 0] ?? 0
      const z = (ones - BITS_PER_TRIAL / 2) / Math.sqrt(BITS_PER_TRIAL / 4)
      deviation += z * z - 1
      if (deviation >= (hi[s] as number)) {
        crossedUpper = true
        crossedBand = true
      } else if (deviation <= (lo[s] as number)) {
        crossedBand = true
      }
      if (deviation >= (bound[s] as number)) crossedBound = true
      if ((s & 511) === 0) await tick()
    }
    if (crossedBand) pointwise++
    if (crossedUpper) pointwiseUpper++
    if (crossedBound) anytime++
    opts.onProgress(0.15 + (0.85 * (p + 1)) / paths)
    await tick()
  }

  return {
    paths,
    steps,
    pointwise,
    pointwiseUpper,
    anytime,
    bitsPerStep: BITS_PER_TRIAL,
    bytesUsed,
    sourceName: opts.sourceName,
  }
}
