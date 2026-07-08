import { FlowError } from '../errors.js'

/**
 * Largest supported alphabet: symbols are stored in Int32Array, so every
 * symbol must fit in a signed 32-bit integer. Requests beyond this throw
 * `alphabet_overflow`.
 */
export const MAX_ALPHABET = 2_147_483_647

export interface ValidatedSymbols {
  readonly symbols: Int32Array
  /** Largest symbol observed; −1 for an empty input. */
  readonly maxSymbol: number
}

/**
 * Validate an alphabet-size option: a positive integer at most
 * {@link MAX_ALPHABET}. Returns `undefined` untouched (inference requested).
 */
export function validateAlphabetOption(alphabet: number | undefined): number | undefined {
  if (alphabet === undefined) return undefined
  if (!Number.isInteger(alphabet) || alphabet < 1) {
    throw new FlowError('invalid_input', `alphabet must be a positive integer, got ${alphabet}`)
  }
  if (alphabet > MAX_ALPHABET) {
    throw new FlowError(
      'alphabet_overflow',
      `alphabet ${alphabet} exceeds the 2^31 − 1 per-symbol limit`,
    )
  }
  return alphabet
}

/**
 * Copy an ArrayLike of symbols into an Int32Array, rejecting anything that
 * is not a non-negative integer (or that falls outside a given alphabet).
 */
export function validateSymbols(
  input: ArrayLike<number>,
  name: string,
  alphabet?: number,
): ValidatedSymbols {
  const n = input.length
  const symbols = new Int32Array(n)
  let max = -1
  for (let i = 0; i < n; i++) {
    const v = input[i] as number
    if (!Number.isInteger(v) || v < 0) {
      throw new FlowError('invalid_input', `${name}[${i}] must be a non-negative integer, got ${v}`)
    }
    if (v >= MAX_ALPHABET) {
      throw new FlowError(
        'alphabet_overflow',
        `${name}[${i}] = ${v} exceeds the 2^31 − 1 per-symbol limit`,
      )
    }
    if (alphabet !== undefined && v >= alphabet) {
      throw new FlowError(
        'invalid_input',
        `${name}[${i}] = ${v} is outside the alphabet [0, ${alphabet})`,
      )
    }
    if (v > max) max = v
    symbols[i] = v
  }
  return { symbols, maxSymbol: max }
}

/** A joint-state key: packed integer when it fits, string otherwise. */
export type StateKey = number | string

export interface StateEncoder {
  /** Which keying strategy {@link makeEncoder} selected. */
  readonly mode: 'integer' | 'string'
  /** Encode the first `length` entries of `buf` into a Map key. */
  encode(buf: Int32Array, length: number): StateKey
}

/**
 * Build a joint-state encoder for tuples of `length` symbols drawn from
 * `[0, alphabet)`. When the state space $A^m$ fits safely in a signed 32-bit
 * integer ($A^m < 2^{31}$) tuples are packed into exact integer keys
 * $\sum_i s_i A^i$ — fast and allocation-free. Otherwise the encoder falls
 * back to comma-joined string keys in the same `Map`, which is slower but
 * correct for any representable symbols. The switch never changes results,
 * only the key representation.
 */
export function makeEncoder(alphabet: number, length: number): StateEncoder {
  let capacity = 1
  let integer = true
  for (let i = 0; i < length; i++) {
    capacity *= alphabet
    if (capacity >= 2 ** 31) {
      integer = false
      break
    }
  }
  if (integer) {
    return {
      mode: 'integer',
      encode(buf, len) {
        let key = 0
        for (let i = 0; i < len; i++) key = key * alphabet + (buf[i] as number)
        return key
      },
    }
  }
  return {
    mode: 'string',
    encode(buf, len) {
      let key = String(buf[0])
      for (let i = 1; i < len; i++) key += `,${buf[i]}`
      return key
    },
  }
}

/**
 * Plug-in Shannon entropy of a count table, in bits:
 * $\hat H = -\sum_i \frac{c_i}{N} \log_2 \frac{c_i}{N}$, optionally with the
 * Miller–Madow bias correction $+\frac{K - 1}{2 N \ln 2}$ where $K$ is the
 * number of occupied cells (Miller 1955).
 */
export function entropyFromCounts(
  counts: Iterable<number>,
  n: number,
  millerMadow: boolean,
): number {
  let h = 0
  let cells = 0
  for (const c of counts) {
    if (c === 0) continue
    cells++
    const p = c / n
    h -= p * Math.log2(p)
  }
  if (millerMadow && cells > 0) h += (cells - 1) / (2 * n * Math.LN2)
  return h
}

/** Count joint tuples across equal-length symbol columns. */
export function tupleCounts(cols: readonly Int32Array[], alphabet: number): Map<StateKey, number> {
  const m = cols.length
  const n = (cols[0] as Int32Array).length
  const encoder = makeEncoder(alphabet, m)
  const buf = new Int32Array(m)
  const counts = new Map<StateKey, number>()
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) buf[j] = (cols[j] as Int32Array)[i] as number
    const key = encoder.encode(buf, m)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
