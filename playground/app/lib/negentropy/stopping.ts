// The optional-stopping simulation behind cookbook recipe 1: how often does a
// pure-null path cross the POINTWISE χ² envelope somewhere, and how often does
// it cross the anytime-valid boundary? Chunked per path so the progress bar
// paints and Cancel stays clickable.
//
// CLIENT-ONLY: imports @mindpeeker/negentropy.

import {
  anytimeEnvelope,
  cumulativeDeviation,
  probitBytes,
  significanceEnvelope,
} from '@mindpeeker/negentropy'
import { createYielder } from '~/lib/async'

export interface StoppingOptions {
  paths: number
  steps: number
  alpha: number
  /** Where the null bytes come from — a reproducible DRBG control or the local CSPRNG. */
  draw: (n: number, opts: { signal: AbortSignal }) => Promise<Uint8Array>
  /** Labels the dither stream of each path, so no two paths share one. */
  label: string
  signal: AbortSignal
  setProgress: (value: number | null) => void
}

export interface StoppingResult {
  paths: number
  steps: number
  alpha: number
  /** Paths whose cumulative deviation crossed the pointwise envelope at any step. */
  pointwiseCrossings: number
  /** Paths that crossed the time-uniform (anytime-valid) boundary at any step. */
  anytimeCrossings: number
  /** First crossing step of the pointwise envelope, one entry per crossing path. */
  firstPointwise: Float64Array
  /** The two bands, index t − 1 for step t. */
  pointwiseBand: Float64Array
  anytimeBand: Float64Array
}

/**
 * `paths` independent H0 paths of `steps` probit-normal steps each. probitBytes
 * maps bytes to exactly N(0, 1) under the null, so the crossing rates test the
 * METHOD rather than a lattice approximation.
 */
export async function simulateStopping(opts: StoppingOptions): Promise<StoppingResult> {
  const { paths, steps, alpha, draw, label, signal, setProgress } = opts
  const pointwiseBand = significanceEnvelope(steps, alpha)
  const anytimeBand = anytimeEnvelope(steps, alpha, { sided: 'upper' }).upper
  const tick = createYielder(8, signal)

  let pointwiseCrossings = 0
  let anytimeCrossings = 0
  const firstPointwise: number[] = []

  setProgress(0)
  for (let p = 0; p < paths; p++) {
    const bytes = await draw(steps, { signal })
    const zs = probitBytes(bytes, { source: `${label}/path-${p}` })
    const curve = cumulativeDeviation(zs)
    let first = -1
    let anytime = false
    for (let t = 0; t < steps; t++) {
      const value = curve[t] as number
      if (first < 0 && value > (pointwiseBand[t] as number)) first = t + 1
      if (!anytime && value >= (anytimeBand[t] as number)) anytime = true
      if (first >= 0 && anytime) break
    }
    if (first >= 0) {
      pointwiseCrossings++
      firstPointwise.push(first)
    }
    if (anytime) anytimeCrossings++
    setProgress((p + 1) / paths)
    await tick()
  }

  return {
    paths,
    steps,
    alpha,
    pointwiseCrossings,
    anytimeCrossings,
    firstPointwise: Float64Array.from(firstPointwise),
    pointwiseBand,
    anytimeBand,
  }
}
