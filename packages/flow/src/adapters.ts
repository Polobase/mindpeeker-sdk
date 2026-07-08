/**
 * Input adapters: turn bytes and continuous measurements into the integer
 * symbol arrays every estimator in this package consumes.
 */

import { FlowError } from './errors.js'

export interface SymbolsFromBytesOptions {
  /**
   * `256` (default): each byte is one symbol 0–255. `2`: each byte expands
   * to 8 bit-symbols, MSB-first (SDK-wide bit order).
   */
  alphabet?: 2 | 256
}

/**
 * Adapt raw bytes to symbols. With `alphabet: 2` each byte $b$ becomes the
 * bits $b_7, b_6, \dots, b_0$ (MSB-first); with the default `alphabet: 256`
 * the bytes are copied through unchanged. Always returns a fresh array —
 * the input is never aliased.
 */
export function symbolsFromBytes(
  bytes: Uint8Array,
  opts: SymbolsFromBytesOptions = {},
): Uint8Array {
  const alphabet = opts.alphabet ?? 256
  // The `2 | 256` type only guards TS callers; validate at runtime too, since
  // this ships as plain JS and every sibling adapter rejects bad options.
  if (alphabet !== 2 && alphabet !== 256) {
    throw new FlowError('invalid_input', `alphabet must be 2 or 256, got ${alphabet}`)
  }
  if (alphabet === 256) return bytes.slice()
  const out = new Uint8Array(bytes.length * 8)
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number
    for (let j = 0; j < 8; j++) out[i * 8 + j] = (b >>> (7 - j)) & 1
  }
  return out
}

function validateBinInput(values: ArrayLike<number>, nBins: number, name: string): void {
  if (!Number.isInteger(nBins) || nBins < 2) {
    throw new FlowError('invalid_input', `${name} needs an integer nBins ≥ 2, got ${nBins}`)
  }
  if (values.length === 0) {
    throw new FlowError('insufficient_data', `${name} needs at least 1 value`)
  }
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i] as number)) {
      throw new FlowError('invalid_input', `${name}: values[${i}] is not finite`)
    }
  }
}

/**
 * Equal-frequency (quantile) binning: symbol
 * $s_i = \lfloor \mathrm{rank}(v_i) \cdot n_{bins} / n \rfloor$, so each bin
 * holds $\approx n / n_{bins}$ samples — the maximum-entropy discretization
 * of the marginal, the usual choice before a symbolic TE estimate. Ties are
 * broken deterministically by original index (stable rank), so equal values
 * may straddle a bin boundary.
 */
export function quantileBins(values: ArrayLike<number>, nBins: number): Int32Array {
  validateBinInput(values, nBins, 'quantileBins')
  const n = values.length
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const d = (values[a] as number) - (values[b] as number)
    return d !== 0 ? d : a - b
  })
  const out = new Int32Array(n)
  for (let rank = 0; rank < n; rank++) {
    out[order[rank] as number] = Math.floor((rank * nBins) / n)
  }
  return out
}

/**
 * Equal-width binning over the observed range:
 * $s_i = \min\!\left(n_{bins} - 1,\; \left\lfloor \frac{v_i - \min v}{\max v - \min v} \cdot n_{bins} \right\rfloor\right)$.
 * A constant input maps to all zeros. Simpler than {@link quantileBins} but
 * sensitive to outliers, which can crowd the bulk of the data into few bins.
 */
export function equalWidthBins(values: ArrayLike<number>, nBins: number): Int32Array {
  validateBinInput(values, nBins, 'equalWidthBins')
  const n = values.length
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    const v = values[i] as number
    if (v < min) min = v
    if (v > max) max = v
  }
  const out = new Int32Array(n)
  if (min === max) return out
  const scale = nBins / (max - min)
  for (let i = 0; i < n; i++) {
    out[i] = Math.min(nBins - 1, Math.floor(((values[i] as number) - min) * scale))
  }
  return out
}

/** Options for {@link ordinalPatterns}. */
export interface OrdinalPatternOptions {
  /** Embedding delay $\tau \ge 1$ between the samples of one pattern. Default 1. */
  delay?: number
}

const FACTORIALS = Object.freeze([
  1, 1, 2, 6, 24, 120, 720, 5_040, 40_320, 362_880, 3_628_800, 39_916_800,
] as const)

/**
 * Bandt–Pompe ordinal-pattern symbolization (Bandt & Pompe 2002,
 * "Permutation entropy: a natural complexity measure for time series"):
 * each window $(v_t, v_{t+\tau}, \dots, v_{t+(m-1)\tau})$ maps to the Lehmer
 * code of its rank permutation — a symbol in $[0, m!)$. Feeding both streams
 * through this and then into {@link transferEntropy} gives the symbolic
 * transfer entropy of Staniek & Lehnertz (2008, Phys. Rev. Lett. 100,
 * 158101). Ties are broken by temporal order (stable ranks, the standard
 * convention). Output length is $n - (m-1)\tau$. Orders above 12 throw
 * `alphabet_overflow` ($13! > 2^{31}$, past the package's symbol limit —
 * and no realistic series populates $13!$ patterns anyway).
 */
export function ordinalPatterns(
  values: ArrayLike<number>,
  order: number,
  opts: OrdinalPatternOptions = {},
): Int32Array {
  if (!Number.isInteger(order) || order < 2) {
    throw new FlowError('invalid_input', `order must be an integer ≥ 2, got ${order}`)
  }
  if (order > 12) {
    throw new FlowError(
      'alphabet_overflow',
      `order ${order} needs an alphabet of ${order}! > 2^31 − 1 symbols; the maximum order is 12`,
    )
  }
  const delay = opts.delay ?? 1
  if (!Number.isInteger(delay) || delay < 1) {
    throw new FlowError('invalid_input', `delay must be an integer ≥ 1, got ${delay}`)
  }
  const n = values.length
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(values[i] as number)) {
      throw new FlowError('invalid_input', `ordinalPatterns: values[${i}] is not finite`)
    }
  }
  const count = n - (order - 1) * delay
  if (count < 1) {
    throw new FlowError(
      'insufficient_data',
      `ordinalPatterns with order ${order} and delay ${delay} needs at least ${(order - 1) * delay + 1} values, got ${n}`,
    )
  }
  const out = new Int32Array(count)
  const window = new Float64Array(order)
  const ranks = new Int32Array(order)
  for (let s = 0; s < count; s++) {
    for (let j = 0; j < order; j++) window[j] = values[s + j * delay] as number
    // stable ranks: rank_j = #{i : v_i < v_j, or v_i = v_j with i < j}
    for (let j = 0; j < order; j++) {
      let r = 0
      const vj = window[j] as number
      for (let i = 0; i < order; i++) {
        const vi = window[i] as number
        if (vi < vj || (vi === vj && i < j)) r++
      }
      ranks[j] = r
    }
    // Lehmer code of the rank vector in the factorial number system
    let code = 0
    for (let j = 0; j < order - 1; j++) {
      let smallerAfter = 0
      const rj = ranks[j] as number
      for (let i = j + 1; i < order; i++) if ((ranks[i] as number) < rj) smallerAfter++
      code += smallerAfter * (FACTORIALS[order - 1 - j] as number)
    }
    out[s] = code
  }
  return out
}
