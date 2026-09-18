// SP 800-90B §4.4 health-test cutoffs, computed with the same exact functions
// the entropy package's conditioner uses.
// CLIENT-ONLY (it imports @mindpeeker/negentropy/numerics).

import { aptCutoff, rctCutoff } from '@mindpeeker/negentropy/numerics'
import { createYielder } from '~/lib/async'

export type WindowSize = 512 | 1024

export interface CutoffRow {
  /** Credited min-entropy in bits per sample. */
  readonly h: number
  readonly label: string
  readonly windowSize: WindowSize
  /** The value asserted in the package docs or tests. */
  readonly documented: number
  readonly test: 'RCT' | 'APT'
  readonly source: string
}

/**
 * Reference values published by the packages themselves. The page recomputes
 * each one live and shows both, so a drift would be visible rather than
 * assumed. (SP 800-90B's own Table 2 is not reproduced in the READMEs, so
 * these are the SDK's documented anchors, not a transcription of the table.)
 */
export const CUTOFF_REFERENCES: readonly CutoffRow[] = [
  {
    h: 7,
    label: 'serial / hwRng credit (7 b/B)',
    windowSize: 512,
    documented: 4,
    test: 'RCT',
    source: 'entropy README — “credited at 7 or 8 b/B … has an RCT cutoff of 4”',
  },
  {
    h: 8,
    label: 'ideal byte source (8 b/B)',
    windowSize: 512,
    documented: 4,
    test: 'RCT',
    source: 'entropy README — same row',
  },
  {
    h: 1,
    label: 'one bit per sample',
    windowSize: 512,
    documented: 21,
    test: 'RCT',
    source: 'negentropy test — rctCutoff(1) === 21',
  },
  {
    h: 0.0625,
    label: 'jitter credit (1/16 b/delta)',
    windowSize: 512,
    documented: 321,
    test: 'RCT',
    source: 'jitterEntropy doc comment — “RCT cutoff 321, APT cutoff 509/512”',
  },
  {
    h: 1,
    label: 'one bit per sample',
    windowSize: 512,
    documented: 311,
    test: 'APT',
    source: 'negentropy test — aptCutoff(1, 512) === 311',
  },
  {
    h: 0.0625,
    label: 'jitter credit (1/16 b/delta)',
    windowSize: 512,
    documented: 509,
    test: 'APT',
    source: 'entropy README — “509 of 512 at jitter’s 1/16 bit”',
  },
  {
    h: 0.0625,
    label: 'jitter credit (1/16 b/delta)',
    windowSize: 1024,
    documented: 1009,
    test: 'APT',
    source: 'negentropy README — “H = 1/16 → 509 at W = 512, 1009 at W = 1024”',
  },
  {
    h: 0.03,
    label: 'below 20/W — the APT cannot fire',
    windowSize: 512,
    documented: 513,
    test: 'APT',
    source: 'negentropy README — “a cutoff of W + 1 is the true answer for H < 20/W (0.039 at W = 512)”',
  },
  {
    h: 0.015,
    label: 'below 20/W — the APT cannot fire',
    windowSize: 1024,
    documented: 1025,
    test: 'APT',
    source: 'negentropy README — “… 0.0195 at W = 1024”',
  },
]

export interface CutoffResult {
  readonly rct: number
  readonly apt: number
  readonly aptFires: boolean
  /** Expected proportion of the most common value under the credit: 2⁻ᴴ. */
  readonly expectedProportion: number
  /** Cut-off as a share of the window. */
  readonly aptShare: number
  readonly error?: string
}

/** Both continuous cutoffs at one credit, or the validation error for a bad H. */
export function cutoffsAt(h: number, windowSize: WindowSize): CutoffResult {
  try {
    const apt = aptCutoff(h, windowSize)
    return {
      rct: rctCutoff(h),
      apt,
      aptFires: apt <= windowSize,
      expectedProportion: 2 ** -h,
      aptShare: apt / windowSize,
    }
  } catch (error) {
    return {
      rct: Number.NaN,
      apt: Number.NaN,
      aptFires: false,
      expectedProportion: Number.NaN,
      aptShare: Number.NaN,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export interface CutoffCurve {
  readonly h: number[]
  readonly apt512: number[]
  readonly apt1024: number[]
}

/**
 * APT cutoff as a share of the window over the credited-H range, computed in
 * yielded slices (each `aptCutoff` call is O(W)).
 */
export async function cutoffCurve(
  points = 56,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<CutoffCurve> {
  const tick = createYielder(8, signal)
  const h: number[] = []
  const apt512: number[] = []
  const apt1024: number[] = []
  // Log spacing: everything interesting happens below 1 bit per sample.
  const lo = Math.log(0.02)
  const hi = Math.log(8)
  for (let i = 0; i < points; i++) {
    const value = Math.exp(lo + ((hi - lo) * i) / (points - 1))
    h.push(value)
    apt512.push(aptCutoff(value, 512) / 512)
    apt1024.push(aptCutoff(value, 1024) / 1024)
    onProgress?.((i + 1) / points)
    await tick()
  }
  return { h, apt512, apt1024 }
}

export const CUTOFF_SNIPPET = `import { aptCutoff, rctCutoff } from '@mindpeeker/negentropy/numerics'

// SP 800-90B §4.4 at the recommended false-positive rate α = 2⁻²⁰ per sample.
rctCutoff(7)             // 4    — 1 + ⌈20/H⌉
aptCutoff(1, 512)        // 311  — 1 + CRITBINOM(W, 2⁻ᴴ, 1 − α)
aptCutoff(1 / 16, 512)   // 509  — jitter's credit; still active
aptCutoff(0.03, 512)     // 513  — W + 1: below H = 20/W the test cannot fire`
