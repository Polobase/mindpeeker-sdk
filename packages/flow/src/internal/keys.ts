/**
 * Joint-state keys for embedded tuples. A {@link KeyColumn} holds one key per
 * embedded tuple (one per predicted sample): an exact mixed-radix integer while
 * the variable's state space fits in $2^{53}$ (every packed value is then an
 * exactly representable double), comma/pipe-joined strings beyond. The key
 * representation never changes an estimate — only equal tuples share a key.
 */

/** Largest state space packed into exact integer keys: $2^{53}$. */
export const MAX_EXACT_KEY_SPACE = 9_007_199_254_740_992

export type KeyColumn =
  | {
      readonly kind: 'number'
      readonly keys: Float64Array
      /** Size of the variable's state space (product of radices). */
      readonly cardinality: number
    }
  | { readonly kind: 'string'; readonly keys: readonly string[]; readonly cardinality: number }

/** A series of symbols in $[0, radix)$ (validated upstream). */
export interface SymbolSeries {
  readonly symbols: Int32Array
  readonly radix: number
}

/**
 * Embed a block of `length` consecutive symbols of `series` for the tuples
 * $t = first, \dots, first + count - 1$: the parts are
 * `symbols[t − delay], symbols[t − delay − 1], …` (most recent first), with
 * `delay = −1` meaning the sample after $t$ (a predicted future).
 */
export function lagBlock(
  series: SymbolSeries,
  first: number,
  count: number,
  delay: number,
  length: number,
): KeyColumn {
  const { symbols, radix } = series
  let cardinality = 1
  for (let j = 0; j < length; j++) cardinality *= radix
  const base = first - delay
  if (cardinality <= MAX_EXACT_KEY_SPACE) {
    const keys = new Float64Array(count)
    if (length === 1) {
      for (let i = 0; i < count; i++) keys[i] = symbols[base + i] as number
    } else {
      for (let i = 0; i < count; i++) {
        let key = 0
        for (let j = 0; j < length; j++) key = key * radix + (symbols[base + i - j] as number)
        keys[i] = key
      }
    }
    return { kind: 'number', keys, cardinality }
  }
  const keys = new Array<string>(count)
  for (let i = 0; i < count; i++) {
    let key = String(symbols[base + i])
    for (let j = 1; j < length; j++) key += `,${symbols[base + i - j]}`
    keys[i] = key
  }
  return { kind: 'string', keys, cardinality }
}

/** The empty variable: one state, key 0 for every tuple. */
export function constantKeys(count: number): KeyColumn {
  return { kind: 'number', keys: new Float64Array(count), cardinality: 1 }
}

/** Joint key of two columns over the same tuples (pairing is injective). */
export function joinKeys(a: KeyColumn, b: KeyColumn): KeyColumn {
  const count = a.keys.length
  const cardinality = a.cardinality * b.cardinality
  if (a.kind === 'number' && b.kind === 'number') {
    if (b.cardinality === 1) return { kind: 'number', keys: a.keys, cardinality }
    if (a.cardinality === 1) return { kind: 'number', keys: b.keys, cardinality }
    if (cardinality <= MAX_EXACT_KEY_SPACE) {
      const keys = new Float64Array(count)
      const radix = b.cardinality
      const ak = a.keys
      const bk = b.keys
      for (let i = 0; i < count; i++) keys[i] = (ak[i] as number) * radix + (bk[i] as number)
      return { kind: 'number', keys, cardinality }
    }
  }
  const keys = new Array<string>(count)
  for (let i = 0; i < count; i++) keys[i] = `${a.keys[i]}|${b.keys[i]}`
  return { kind: 'string', keys, cardinality }
}

/** Reorder a column's tuples: `out[i] = col[perm[i]]`. */
export function permuteKeys(col: KeyColumn, perm: Int32Array): KeyColumn {
  const count = perm.length
  if (col.kind === 'number') {
    const keys = new Float64Array(count)
    for (let i = 0; i < count; i++) keys[i] = col.keys[perm[i] as number] as number
    return { kind: 'number', keys, cardinality: col.cardinality }
  }
  const keys = new Array<string>(count)
  for (let i = 0; i < count; i++) keys[i] = col.keys[perm[i] as number] as string
  return { kind: 'string', keys, cardinality: col.cardinality }
}

/** Per-tuple occurrence counts of a column's keys plus the number of occupied cells. */
export interface TupleCounts {
  /** `perTuple[i]` = how many tuples share tuple i's key. */
  readonly perTuple: Float64Array
  /** Number of distinct keys (occupied cells). */
  readonly cells: number
}

/** Dense counting is used while the state space is at most this large (and ≲ 4·count). */
const DENSE_LIMIT = 1 << 22

export function countTuples(col: KeyColumn): TupleCounts {
  const count = col.keys.length
  const perTuple = new Float64Array(count)
  if (
    col.kind === 'number' &&
    col.cardinality <= DENSE_LIMIT &&
    col.cardinality <= Math.max(65_536, 4 * count)
  ) {
    const table = new Int32Array(col.cardinality)
    const keys = col.keys
    let cells = 0
    for (let i = 0; i < count; i++) {
      const key = keys[i] as number
      if (table[key] === 0) cells++
      table[key] = (table[key] as number) + 1
    }
    for (let i = 0; i < count; i++) perTuple[i] = table[keys[i] as number] as number
    return { perTuple, cells }
  }
  const table = new Map<number | string, number>()
  const keys = col.keys
  for (let i = 0; i < count; i++) {
    const key = keys[i] as number | string
    table.set(key, (table.get(key) ?? 0) + 1)
  }
  for (let i = 0; i < count; i++) perTuple[i] = table.get(keys[i] as number | string) as number
  return { perTuple, cells: table.size }
}
