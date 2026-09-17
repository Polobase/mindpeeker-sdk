/**
 * Surrogate-data generators (Theiler et al. 1992, "Testing for nonlinearity
 * in time series: the method of surrogate data"). Every generator takes an
 * explicit unit-uniform generator returning numbers in $[0, 1)$ — pair with
 * {@link xoshiro128ss} for reproducible ensembles — copies its input, and
 * documents exactly which structure it keeps (and so which null it encodes).
 */

import { FlowError } from './errors.js'
import { randomInt } from './internal/prng.js'
import { validateSymbols } from './internal/symbols.js'

function fisherYates(out: Int32Array, rng: () => number): Int32Array {
  for (let i = out.length - 1; i >= 1; i--) {
    const j = randomInt(rng, i + 1)
    const tmp = out[i] as number
    out[i] = out[j] as number
    out[j] = tmp
  }
  return out
}

function lengthOption(value: number, name: string, n: number, integer: boolean): number {
  const ok = integer ? Number.isInteger(value) : Number.isFinite(value)
  if (!ok || value < 1 || value > Math.max(1, n)) {
    throw new FlowError(
      'invalid_input',
      `${name} must be ${integer ? 'an integer' : 'a finite number'} in [1, ${Math.max(1, n)}], got ${value}`,
    )
  }
  return value
}

/**
 * Fisher–Yates shuffle of the source symbols. Preserves the marginal
 * distribution $\hat p(x)$ exactly, destroys ALL temporal structure — the
 * strongest null for "does source timing inform the destination at all?"
 * and the surrogate Marschinski–Kantz effective TE is defined against. For
 * source histories $l > 1$ it also destroys the within-vector structure of
 * $x^{(l)}$; the permutation test's `'embeddingShuffle'` keeps it.
 */
export function sourceShuffle(symbols: ArrayLike<number>, rng: () => number): Int32Array {
  return fisherYates(validateSymbols(symbols, 'symbols').symbols, rng)
}

/**
 * Circular shift by a random offset in $[1, n-1]$:
 * `out[i] = symbols[(i + offset) mod n]`. Preserves the source's full
 * autocorrelation structure (up to wraparound), destroys only its alignment
 * with the destination — a stricter null than {@link sourceShuffle} when the
 * source is itself autocorrelated. Only $n - 1$ distinct surrogates exist.
 * Inputs shorter than 2 symbols are returned as unshifted copies.
 */
export function circularShift(symbols: ArrayLike<number>, rng: () => number): Int32Array {
  const { symbols: input } = validateSymbols(symbols, 'symbols')
  const n = input.length
  if (n < 2) return input
  return rotate(input, 1 + randomInt(rng, n - 1))
}

/** `out[i] = input[(i + offset) mod n]`. */
export function rotate(input: Int32Array, offset: number): Int32Array {
  const n = input.length
  const out = new Int32Array(n)
  const split = n - offset
  out.set(input.subarray(offset), 0)
  out.set(input.subarray(0, offset), split)
  return out
}

/** Options for {@link blockShuffle}. */
export interface BlockShuffleOptions {
  /** Block length $b \in [1, n]$. Default $\lceil n^{1/3} \rceil$. */
  blockSize?: number
}

/**
 * Block shuffle: cut the series into consecutive blocks of `blockSize`
 * (the last block may be shorter) and Fisher–Yates the block ORDER. Keeps the
 * symbol multiset exactly and all structure inside each block (short-range
 * autocorrelation up to lag $b - 1$), breaks structure across block
 * boundaries — the usual middle ground between `sourceShuffle` and
 * `circularShift` (Künsch 1989 block resampling; Kantz & Schreiber 2004 §7.1).
 */
export function blockShuffle(
  symbols: ArrayLike<number>,
  rng: () => number,
  opts: BlockShuffleOptions = {},
): Int32Array {
  const { symbols: input } = validateSymbols(symbols, 'symbols')
  const n = input.length
  const b = lengthOption(opts.blockSize ?? defaultBlockLength(n), 'blockSize', n, true)
  const nBlocks = Math.ceil(n / b)
  const order = new Int32Array(nBlocks)
  for (let i = 0; i < nBlocks; i++) order[i] = i
  fisherYates(order, rng)
  const out = new Int32Array(n)
  let pos = 0
  for (let i = 0; i < nBlocks; i++) {
    const start = (order[i] as number) * b
    const block = input.subarray(start, Math.min(n, start + b))
    out.set(block, pos)
    pos += block.length
  }
  return out
}

/** Options for {@link stationaryBootstrap}. */
export interface StationaryBootstrapOptions {
  /** Mean block length $1/p \in [1, n]$ (real). Default $\lceil n^{1/3} \rceil$. */
  meanBlockSize?: number
}

/**
 * Stationary bootstrap (Politis & Romano 1994, JASA 89, 1303): a resample of
 * length $n$ built from blocks with random starts (uniform over $[0, n)$) and
 * geometric lengths of mean `meanBlockSize`, wrapping circularly. Unlike the
 * shuffles it resamples WITH replacement — the multiset is not preserved —
 * but the resampled series is stationary and keeps short-range dependence.
 * Draw order: for each position, one uniform decides "new block" with
 * probability $1/\text{meanBlockSize}$ (always at position 0), and a new
 * block draws one more uniform for its start.
 */
export function stationaryBootstrap(
  symbols: ArrayLike<number>,
  rng: () => number,
  opts: StationaryBootstrapOptions = {},
): Int32Array {
  const { symbols: input } = validateSymbols(symbols, 'symbols')
  const n = input.length
  const mean = lengthOption(opts.meanBlockSize ?? defaultBlockLength(n), 'meanBlockSize', n, false)
  const out = new Int32Array(n)
  const pNew = 1 / mean
  let index = 0
  for (let i = 0; i < n; i++) {
    const u = rng()
    if (!(u >= 0 && u < 1)) {
      throw new FlowError('invalid_input', `rng must return a number in [0, 1), got ${u}`)
    }
    if (i === 0 || u < pNew) index = randomInt(rng, n)
    else index = (index + 1) % n
    out[i] = input[index] as number
  }
  return out
}

/** Options for {@link markovSurrogate}. */
export interface MarkovSurrogateOptions {
  /** Markov order $m \in [1, n - 1]$. Default 1. */
  order?: number
}

/**
 * Order-$m$ Markov surrogate: fit the empirical transition counts
 * $\#(x_{t-m+1..t} \to x_{t+1})$ — taken circularly, so every observed context
 * has a successor — and simulate a same-length realisation of that chain from
 * a start context drawn uniformly among the $n$ circular positions. Keeps
 * the order-$m$ transition structure (hence the marginal and short memory) in
 * distribution, destroys any longer memory and all alignment with other
 * streams — the discrete "constrained realisation" null for autocorrelated
 * sources. Each step draws one uniform and picks the successor by cumulative
 * counts in order of first appearance.
 */
export function markovSurrogate(
  symbols: ArrayLike<number>,
  rng: () => number,
  opts: MarkovSurrogateOptions = {},
): Int32Array {
  const { symbols: input } = validateSymbols(symbols, 'symbols')
  const n = input.length
  const order = opts.order ?? 1
  if (!Number.isInteger(order) || order < 1 || order > Math.max(1, n - 1)) {
    throw new FlowError(
      'invalid_input',
      `order must be an integer in [1, ${Math.max(1, n - 1)}], got ${order}`,
    )
  }
  if (n < 2) return input
  const contextKey = (at: number): string => {
    let key = String(input[at % n])
    for (let j = 1; j < order; j++) key += `,${input[(at + j) % n]}`
    return key
  }
  // successors[context] = [symbol, count, symbol, count, …] in first-appearance order
  const successors = new Map<string, number[]>()
  for (let t = 0; t < n; t++) {
    const key = contextKey(t)
    const next = input[(t + order) % n] as number
    const list = successors.get(key)
    if (list === undefined) {
      successors.set(key, [next, 1])
      continue
    }
    let found = false
    for (let j = 0; j < list.length; j += 2) {
      if (list[j] === next) {
        list[j + 1] = (list[j + 1] as number) + 1
        found = true
        break
      }
    }
    if (!found) list.push(next, 1)
  }
  const out = new Int32Array(n)
  const start = randomInt(rng, n)
  for (let j = 0; j < order && j < n; j++) out[j] = input[(start + j) % n] as number
  let key = contextKey(start)
  for (let i = order; i < n; i++) {
    const list = successors.get(key) as number[]
    let total = 0
    for (let j = 1; j < list.length; j += 2) total += list[j] as number
    let pick = randomInt(rng, total)
    let symbol = list[0] as number
    for (let j = 0; j < list.length; j += 2) {
      pick -= list[j + 1] as number
      if (pick < 0) {
        symbol = list[j] as number
        break
      }
    }
    out[i] = symbol
    key = order === 1 ? String(symbol) : `${key.slice(key.indexOf(',') + 1)},${symbol}`
  }
  return out
}

/** Default block length for block resampling: $\lceil n^{1/3} \rceil$ (at least 1). */
export function defaultBlockLength(n: number): number {
  return Math.max(1, Math.ceil(Math.cbrt(n)))
}
