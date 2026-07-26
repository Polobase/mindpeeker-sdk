/**
 * The `@mindpeeker/gematria/oracle` subpath — an opt-in entropy bridge that
 * turns the deterministic engine into a divinatory draw by composing
 * `@mindpeeker/oracle`. The root `.` entry stays a zero-dep leaf; only this
 * subpath pulls the dependency (itself zero-dep and browser-safe, so the
 * bridge is too).
 *
 * Every draw is exactly uniform (rejection-sampled `uniformInt`, never modulo)
 * and every result carries oracle's honest {@link EntropyAccounting}
 * `{ bytesConsumed, bitsUsed }` for the draw alone — a snapshot delta of the
 * reader, so identical bytes reproduce an identical reading. All draws here are
 * byte-level, hence `bitsUsed = 8 · bytesConsumed`.
 *
 * `castByValue` inverts the others: instead of drawing a word and reporting
 * its value, it draws the *value* itself from raw entropy and reports which
 * lexicon words happen to share it. Read that number honestly — it is random
 * entropy, full stop; the returned words are merely whatever the lexicon
 * happens to share that value with, a reflection, not a message. In its
 * default `'lexicon'` mode the draw is uniform over the lexicon's own
 * distinct realized values, so it always resolves to at least one word; in
 * `'range'` mode it is uniform over an arbitrary numeric range and may
 * resolve to none.
 *
 * The lexicon is caller-supplied — this package ships no word corpus. Errors:
 * `GematriaError('invalid_input')` for an empty lexicon, `('no_match')` when a
 * value filter leaves no candidates; entropy/abort errors from the source
 * propagate unchanged as `OracleError`.
 */

import type { EntropyAccounting, OracleInput } from '@mindpeeker/oracle'
import { type ByteReader, byteReader, uniformInt } from '@mindpeeker/oracle'
import { GematriaError } from './errors.js'
import { getDefaultLexicon, matches } from './match.js'
import { numberProperties } from './numbers.js'
import { resolveCipherId } from './registry.js'
import type {
  CipherId,
  CipherRef,
  GematriaProfile,
  GematriaResult,
  NumberProperties,
} from './types.js'
import { analyze, profile, value } from './value.js'

/** Options common to every bridge draw. */
export interface DrawOptions {
  /** Abort the draw with an `OracleError('aborted')`. */
  signal?: AbortSignal
}

/** A uniform word draw with its entropy accounting. */
export interface DrawWordResult extends EntropyAccounting {
  readonly word: string
}

/** A value-filtered word draw with the drawn word's full single-cipher result. */
export interface DrawByValueResult extends EntropyAccounting {
  readonly word: string
  readonly cipher: CipherId
  readonly targetValue: number
  readonly result: GematriaResult
}

/** A "gematria reading": a drawn word, its full profile, and equal-value peers. */
export interface GematriaCast extends EntropyAccounting {
  readonly word: string
  readonly cipher: CipherId
  readonly value: number
  readonly reduced: number
  readonly profile: GematriaProfile
  /** Lexicon words sharing the drawn word's value under `cipher`. */
  readonly matches: readonly string[]
  /** Fraction of the lexicon at that value — honest commonness in $[0, 1]$. */
  readonly commonness: number
}

function requireLexicon(lexicon: readonly string[]): void {
  if (!Array.isArray(lexicon) || lexicon.length === 0) {
    throw new GematriaError('invalid_input', 'lexicon must be a non-empty array of words')
  }
}

function reader(source: OracleInput, opts: DrawOptions): ByteReader {
  return byteReader(source, opts.signal ? { signal: opts.signal } : {})
}

function account(r: ByteReader, start: number): EntropyAccounting {
  const bytesConsumed = r.bytesConsumed - start
  return { bytesConsumed, bitsUsed: bytesConsumed * 8 }
}

/**
 * Draw one word from `lexicon` uniformly at random from `source`.
 *
 * @throws GematriaError `'invalid_input'` for an empty lexicon
 */
export async function drawWord(
  lexicon: readonly string[],
  source: OracleInput,
  opts: DrawOptions = {},
): Promise<DrawWordResult> {
  requireLexicon(lexicon)
  const r = reader(source, opts)
  const start = r.bytesConsumed
  const index = await uniformInt(r, lexicon.length)
  return Object.freeze({ word: lexicon[index] as string, ...account(r, start) })
}

/**
 * Draw one word uniformly among the `lexicon` words whose value under `cipher`
 * equals `targetValue`. Returns the word and its {@link GematriaResult}.
 *
 * @throws GematriaError `'invalid_input'` for an empty lexicon or non-integer target
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 * @throws GematriaError `'no_match'` if no lexicon word has that value
 */
export async function drawByValue(
  lexicon: readonly string[],
  cipher: CipherId,
  targetValue: number,
  source: OracleInput,
  opts: DrawOptions = {},
): Promise<DrawByValueResult> {
  requireLexicon(lexicon)
  if (!Number.isInteger(targetValue)) {
    throw new GematriaError('invalid_input', `targetValue must be an integer, got ${targetValue}`)
  }
  const candidates = lexicon.filter((word) => value(word, cipher) === targetValue)
  if (candidates.length === 0) {
    throw new GematriaError('no_match', `no lexicon word has ${cipher} value ${targetValue}`, {
      cipher,
    })
  }
  const r = reader(source, opts)
  const start = r.bytesConsumed
  const index = await uniformInt(r, candidates.length)
  const word = candidates[index] as string
  return Object.freeze({
    word,
    cipher,
    targetValue,
    result: analyze(word, cipher),
    ...account(r, start),
  })
}

/**
 * A full "gematria oracle reading": draw a word uniformly, then return its
 * complete {@link profile}, its value/reduction under `cipher`, and every
 * equal-value peer in the lexicon with the honest `commonness`.
 *
 * @throws GematriaError `'invalid_input'` for an empty lexicon
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export async function castGematria(
  lexicon: readonly string[],
  cipher: CipherId,
  source: OracleInput,
  opts: DrawOptions = {},
): Promise<GematriaCast> {
  requireLexicon(lexicon)
  const r = reader(source, opts)
  const start = r.bytesConsumed
  const index = await uniformInt(r, lexicon.length)
  const word = lexicon[index] as string
  const result = analyze(word, cipher)
  const found = matches(word, lexicon, cipher)
  return Object.freeze({
    word,
    cipher,
    value: result.value,
    reduced: result.reduced,
    profile: profile(word),
    matches: found.matches,
    commonness: found.commonness,
    ...account(r, start),
  })
}

/** Options for {@link castByValue}. */
export interface CastByValueOptions extends DrawOptions {
  /**
   * `'lexicon'` (default) draws uniformly among the lexicon's own distinct
   * realized values under `cipher`, so the draw always resolves to at least
   * one word. `'range'` instead draws uniformly over `[min, max]`, an
   * arbitrary numeric range that may contain no lexicon word at all.
   */
  mode?: 'lexicon' | 'range'
  /** Inclusive lower bound for `'range'` mode. Default `1`. */
  min?: number
  /** Inclusive upper bound for `'range'` mode. Default the lexicon's max value. */
  max?: number
}

/**
 * The result of {@link castByValue}: an entropy-drawn number, honestly framed
 * as a number and nothing more, plus whichever lexicon words happen to share it.
 */
export interface ValueCast extends EntropyAccounting {
  /** The randomly drawn target value. Entropy, not a message. */
  readonly value: number
  /** Every lexicon word whose value under `cipher` equals `value` (may be empty). */
  readonly words: readonly string[]
  /** Fraction of the lexicon at that value, in $[0, 1]$. */
  readonly commonness: number
  readonly cipher: CipherId
  /** The number-lore portrait of the drawn value (triangular?, factors, …). */
  readonly numbers: NumberProperties
}

/**
 * The entropy→number→words oracle: draw a numeric value at random from
 * `source`, then report every `lexicon` word that happens to share it. This
 * is the honest inverse of `castGematria` — there the entropy picks a word
 * and the value follows; here the entropy picks the value and the words are
 * whatever the lexicon happens to share it with. A reflection, not a
 * message: nothing about the draw asserts these words are connected beyond
 * the arithmetic coincidence.
 *
 * Default `'lexicon'` mode draws uniformly among the distinct values actually
 * realized in `lexicon` under `cipher`, so `words` is never empty. `'range'`
 * mode draws uniformly over `[opts.min ?? 1, opts.max ?? <lexicon's max value>]`
 * instead, and may resolve to a value no lexicon word has. The result carries a
 * {@link NumberProperties} portrait of the drawn value. The lexicon may be
 * omitted to use the registered default (see `useDefaultLexicon`).
 *
 * @throws GematriaError `'invalid_input'` for an empty lexicon
 * @throws GematriaError `'invalid_input'` for an invalid `'range'` (max < min, non-integer bounds)
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function castByValue(
  cipher: CipherRef,
  source: OracleInput,
  opts?: CastByValueOptions,
): Promise<ValueCast>
export function castByValue(
  lexicon: readonly string[],
  cipher: CipherRef,
  source: OracleInput,
  opts?: CastByValueOptions,
): Promise<ValueCast>
export async function castByValue(
  first: CipherRef | readonly string[],
  second: CipherRef | OracleInput,
  third?: OracleInput | CastByValueOptions,
  fourth?: CastByValueOptions,
): Promise<ValueCast> {
  const hasLexicon = Array.isArray(first)
  const lexicon = hasLexicon ? (first as readonly string[]) : getDefaultLexicon()
  const cipher = (hasLexicon ? second : first) as CipherRef
  const source = (hasLexicon ? third : second) as OracleInput
  const opts = ((hasLexicon ? fourth : third) as CastByValueOptions | undefined) ?? {}
  requireLexicon(lexicon)
  const values = lexicon.map((word) => value(word, cipher))
  const canonicalCipher = resolveCipherId(cipher)

  const r = reader(source, opts)
  const start = r.bytesConsumed

  let target: number
  if (opts.mode === 'range') {
    const min = opts.min ?? 1
    const max = opts.max ?? Math.max(...values)
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new GematriaError('invalid_input', `invalid range [${min}, ${max}]`)
    }
    target = min + (await uniformInt(r, max - min + 1))
  } else {
    const distinct = [...new Set(values)].sort((a, b) => a - b)
    const index = await uniformInt(r, distinct.length)
    target = distinct[index] as number
  }

  const words = lexicon.filter((_, i) => values[i] === target)
  return Object.freeze({
    value: target,
    words: Object.freeze(words),
    commonness: words.length / lexicon.length,
    cipher: canonicalCipher,
    numbers: numberProperties(target),
    ...account(r, start),
  })
}
