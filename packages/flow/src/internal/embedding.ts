/**
 * Shared validation and set-up for every embedded estimator: history lengths,
 * lags, alphabets, aligned inputs, and the transfer-entropy tuple range.
 * Validation always runs before any symbol is counted (or, for streams,
 * before any pair is pulled).
 */

import { FlowError } from '../errors.js'
import { type CmiBase, cmiBase } from './cmi.js'
import { type KeyColumn, lagBlock, type SymbolSeries } from './keys.js'
import { validateAlphabetOption, validateSymbols } from './symbols.js'

/** Validate an optional integer option ≥ `min`; returns the default when absent. */
export function integerOption(
  value: number | undefined,
  name: string,
  fallback: number,
  min = 1,
): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < min) {
    throw new FlowError('invalid_input', `${name} must be an integer ≥ ${min}, got ${value}`)
  }
  return value
}

/** Resolved transfer-entropy embedding. */
export interface Embedding {
  readonly k: number
  readonly l: number
  readonly lag: number
}

export function resolveEmbedding(opts: { k?: number; l?: number; lag?: number }): Embedding {
  return {
    k: integerOption(opts.k, 'k', 1),
    l: integerOption(opts.l, 'l', 1),
    lag: integerOption(opts.lag, 'lag', 1),
  }
}

/** Index $t$ of the first embedded tuple: $\max(k - 1,\; u + l - 2)$. */
export function firstTuple(e: Embedding): number {
  return Math.max(e.k - 1, e.lag + e.l - 2)
}

/** Validate symbols and attach their radix (explicit alphabet, else max + 1). */
export function prepareSeries(
  input: ArrayLike<number>,
  name: string,
  alphabet: number | undefined,
): SymbolSeries {
  if (input === null || typeof input !== 'object' || typeof input.length !== 'number') {
    throw new FlowError('invalid_input', `${name} must be an array-like of symbols`)
  }
  const { symbols, maxSymbol } = validateSymbols(input, name, alphabet)
  return { symbols, radix: alphabet ?? Math.max(1, maxSymbol + 1) }
}

/** Throw unless every input has the reference length. */
export function assertAligned(
  what: string,
  inputs: ReadonlyArray<readonly [string, ArrayLike<number>]>,
): number {
  const [refName, ref] = inputs[0] as readonly [string, ArrayLike<number>]
  for (const [name, input] of inputs) {
    if (input === null || typeof input !== 'object' || typeof input.length !== 'number') {
      throw new FlowError('invalid_input', `${what}: ${name} must be an array-like of symbols`)
    }
    if (input.length !== ref.length) {
      throw new FlowError(
        'invalid_input',
        `${what} needs aligned series: ${refName} has ${ref.length} samples, ${name} has ${input.length}`,
      )
    }
  }
  return ref.length
}

/** Throw `insufficient_data` unless at least 2 tuples fit. */
export function assertCount(what: string, count: number, needed: number, got: number): void {
  if (count < 2) {
    throw new FlowError('insufficient_data', `${what} needs at least ${needed} samples, got ${got}`)
  }
}

/** A prepared source→destination problem sharing one counted target/condition base. */
export interface TeSetup {
  readonly xs: SymbolSeries
  readonly ys: SymbolSeries
  readonly embedding: Embedding
  /** $t$ of tuple 0; tuple $i$ predicts `dest[first + 1 + i]`. */
  readonly first: number
  readonly count: number
  readonly base: CmiBase
}

/** Options every TE set-up understands. */
export interface TeSetupOptions {
  k?: number
  l?: number
  lag?: number
  alphabet?: number
}

/**
 * Validate and prepare $\hat I(Y_{t+1}; X^{(l)} \mid Y_t^{(k)})$. `first`
 * overrides the tuple start (lag scans share one range across lags).
 */
export function setupTransferEntropy(
  what: string,
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: TeSetupOptions,
  embedding: Embedding = resolveEmbedding(opts),
  first: number = firstTuple(embedding),
): TeSetup {
  const n = assertAligned(what, [
    ['source', source],
    ['dest', dest],
  ])
  const alphabet = validateAlphabetOption(opts.alphabet)
  const xs = prepareSeries(source, 'source', alphabet)
  const ys = prepareSeries(dest, 'dest', alphabet)
  const count = n - 1 - first
  const { k, l, lag } = embedding
  assertCount(`${what} with k=${k}, l=${l}, lag=${lag}`, count, first + 3, n)
  const base = cmiBase(lagBlock(ys, first, count, -1, 1), lagBlock(ys, first, count, 0, k))
  return { xs, ys, embedding, first, count, base }
}

/** The embedded source block $x^{(l)}$ at `lag` for a set-up's tuple range. */
export function sourceBlock(
  setup: TeSetup,
  xs: SymbolSeries = setup.xs,
  lag: number = setup.embedding.lag,
): KeyColumn {
  return lagBlock(xs, setup.first, setup.count, lag - 1, setup.embedding.l)
}
