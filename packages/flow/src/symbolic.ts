/**
 * Symbolic transfer entropy (Staniek & Lehnertz 2008, "Symbolic transfer
 * entropy", Phys. Rev. Lett. 100, 158101): transfer entropy between the
 * Bandt–Pompe ordinal-pattern streams of two continuous series.
 */

import { ordinalPatterns } from './adapters.js'
import { FlowError } from './errors.js'
import { assertAligned } from './internal/embedding.js'
import { type TransferEntropyOptions, transferEntropy } from './transfer.js'

const FACTORIAL = Object.freeze([
  1, 1, 2, 6, 24, 120, 720, 5_040, 40_320, 362_880, 3_628_800, 39_916_800, 479_001_600,
] as const)

/** Options for {@link symbolicTransferEntropy}: pattern order/delay plus the TE embedding. */
export interface SymbolicTransferEntropyOptions extends Omit<TransferEntropyOptions, 'alphabet'> {
  /** Ordinal pattern order $m \in [2, 12]$. Required. */
  order: number
  /** Embedding delay $\tau \ge 1$ inside a pattern. Default 1. */
  delay?: number
}

/**
 * Symbolic TE from `x` to `y`, in bits: both series are mapped to ordinal
 * patterns of order $m$ and delay $\tau$ (`ordinalPatterns`), and
 * `transferEntropy` runs on the two pattern streams with alphabet $m!$ and the
 * given `k`, `l`, `lag`. Pattern $s$ covers the raw window
 * $[s, s + (m-1)\tau]$ in BOTH series, so the streams stay aligned by window
 * end: the pattern predicted at $s + 1$ ends one raw sample after the source
 * pattern at $s$ (for lag 1) — a strictly causal step, though the two
 * windows overlap in time. Staniek & Lehnertz use $k = l = 1$ (the defaults).
 * Series must be finite, aligned, and at least $(m-1)\tau + 3$ long.
 */
export function symbolicTransferEntropy(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: SymbolicTransferEntropyOptions,
): number {
  if (opts === null || typeof opts !== 'object' || opts.order === undefined) {
    throw new FlowError('invalid_input', 'symbolicTransferEntropy needs an order option')
  }
  assertAligned('symbolicTransferEntropy', [
    ['x', x],
    ['y', y],
  ])
  const patternOpts = opts.delay !== undefined ? { delay: opts.delay } : {}
  const px = ordinalPatterns(x, opts.order, patternOpts)
  const py = ordinalPatterns(y, opts.order, patternOpts)
  const { order: _order, delay: _delay, ...teOpts } = opts
  return transferEntropy(px, py, { ...teOpts, alphabet: FACTORIAL[opts.order] as number })
}
