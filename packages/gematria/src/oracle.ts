/**
 * The `@mindpeeker/gematria/oracle` subpath — an opt-in entropy bridge that
 * turns the deterministic engine into a divinatory draw by composing
 * `@mindpeeker/oracle`. The root `.` entry stays a zero-dep leaf; only this
 * subpath pulls the dependency (itself zero-dep and browser-safe, so the
 * bridge is too).
 *
 * Every draw is exactly uniform (rejection-sampled `uniformInt`, never modulo)
 * and every result carries oracle's honest {@link EntropyAccounting}
 * `{ bytesConsumed, bitsUsed, bytesFetched? }` for the draw alone — a snapshot
 * delta of the reader, so identical bytes reproduce an identical reading. All
 * draws here are byte-level, hence `bitsUsed = 8 · bytesConsumed`.
 *
 * `castByValue` inverts the others: instead of drawing a word and reporting
 * its value, it draws the *value* itself from raw entropy and reports which
 * lexicon words happen to share it. Read that number honestly — it is random
 * entropy, full stop; the returned words are merely whatever the lexicon
 * happens to share that value with, a reflection, not a message.
 *
 * **Lexicons.** Pass a lexicon (words or `{ word, script }` entries), or — for
 * `castByValue` — omit it to use the registered default; the
 * `@mindpeeker/gematria/lexicon` subpath ships and registers the curated
 * Sepher Sephiroth. The cipher-bound draws (`drawByValue`, `castGematria`,
 * `castByValue`) only ever consider *admissible* words: written in the cipher's
 * script, with at least one scoring letter (see `LexiconWord`). `colel` /
 * `tolerance` widen the value window exactly as in `matches`.
 *
 * **Lifecycle.** Each draw validates all of its arguments *before* touching the
 * entropy input, then reads through `byteReader(source, { signal })` and closes
 * that reader in `finally` — so a live stream or provider opened for the draw is
 * released whether it resolves, throws or aborts. A `ByteReader` you pass in is
 * never closed (with a `signal`, the draw reads through an abortable view of it).
 * A signal that is already aborted rejects the draw even when it would need no
 * bytes (a one-word lexicon).
 *
 * **Errors.** Everything rejects with `GematriaError`: `invalid_input` for bad
 * arguments (including an unrecognized entropy input), `unknown_cipher`,
 * `no_match` when the admissible lexicon or the value filter is empty, and the
 * oracle reader's failures mapped with the original `OracleError` as `cause` —
 * `aborted`, `insufficient_entropy`, `invalid_input` (e.g. a shared reader used
 * concurrently) keep their code; `source_error` and `closed` become
 * `source_error`.
 */

import type { EntropyAccounting, OracleInput } from '@mindpeeker/oracle'
import {
  type ByteReader,
  byteReader,
  MAX_UNIFORM,
  OracleError,
  uniformInt,
} from '@mindpeeker/oracle'
import { GematriaError } from './errors.js'
import {
  checkLexicon,
  defaultLexiconSnapshot,
  type ScoredWord,
  scoreLexicon,
  wordOf,
} from './lexicon-registry.js'
import { matchScored, toleranceOf } from './match.js'
import { MAX_NUMBER, numberProperties } from './numbers.js'
import { getCipher } from './registry.js'
import type {
  Cipher,
  CipherId,
  CipherRef,
  GematriaProfile,
  GematriaResult,
  Lexicon,
  MatchOptions,
  NumberProperties,
} from './types.js'
import { isOptionsObject } from './validate.js'
import { analyze, profile } from './value.js'

/** Anything a draw reads entropy from: an oracle input, or a (shared) `ByteReader`. */
export type EntropyInput = OracleInput | ByteReader

/** Options common to every bridge draw. */
export interface DrawOptions {
  /** Abort the draw with `GematriaError('aborted')`. */
  signal?: AbortSignal
}

/** Options of the cipher-bound draws: abort plus the colel/tolerance window. */
export interface MatchDrawOptions extends DrawOptions, MatchOptions {}

/** A uniform word draw with its entropy accounting. */
export interface DrawWordResult extends EntropyAccounting {
  readonly word: string
}

/** A value-filtered word draw with the drawn word's full single-cipher result. */
export interface DrawByValueResult extends EntropyAccounting {
  readonly word: string
  /** The resolved canonical cipher id (an alias you passed is resolved). */
  readonly cipher: CipherId
  readonly targetValue: number
  /** The ±window the candidates were filtered with. */
  readonly tolerance: number
  readonly result: GematriaResult
}

/** A "gematria reading": a drawn word, its full profile, and equal-value peers. */
export interface GematriaCast extends EntropyAccounting {
  readonly word: string
  /** The resolved canonical cipher id. */
  readonly cipher: CipherId
  readonly value: number
  readonly reduced: number
  readonly profile: GematriaProfile
  /** Admissible lexicon words within tolerance of the drawn word's value. */
  readonly matches: readonly string[]
  /** The subset of `matches` with exactly that value. */
  readonly exact: readonly string[]
  readonly tolerance: number
  /** `matches.length / lexiconSize` — honest commonness in $[0, 1]$. */
  readonly commonness: number
  /** Admissible lexicon words under the cipher (the draw's population). */
  readonly lexiconSize: number
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AbortSignal).aborted === 'boolean' &&
    typeof (value as AbortSignal).addEventListener === 'function'
  )
}

function checkSignal(opts: unknown): AbortSignal | undefined {
  if (opts === undefined) return undefined
  if (!isOptionsObject(opts)) {
    throw new GematriaError('invalid_input', 'draw options must be an object')
  }
  const { signal } = opts
  if (signal !== undefined && !isAbortSignal(signal)) {
    throw new GematriaError('invalid_input', 'signal must be an AbortSignal')
  }
  return signal
}

function nonEmpty(lexicon: unknown): Lexicon {
  checkLexicon(lexicon)
  if (lexicon.length === 0) {
    throw new GematriaError('invalid_input', 'lexicon must be a non-empty array of words')
  }
  return lexicon
}

function admissible(lexicon: Lexicon, cipher: Cipher): readonly ScoredWord[] {
  const scored = scoreLexicon(lexicon, cipher)
  if (scored.length === 0) {
    throw new GematriaError(
      'no_match',
      `no lexicon word is written in the ${cipher.script} script with a letter ${cipher.id} scores`,
      { cipher: cipher.id },
    )
  }
  return scored
}

/** Re-throw a reader failure as a {@link GematriaError} (see the module doc). */
function mapError(error: unknown, cipher: CipherId | undefined): GematriaError {
  if (error instanceof GematriaError) return error
  const opts = { cause: error, ...(cipher !== undefined ? { cipher } : {}) }
  if (error instanceof OracleError) {
    const code =
      error.code === 'aborted' ||
      error.code === 'insufficient_entropy' ||
      error.code === 'invalid_input'
        ? error.code
        : 'source_error'
    return new GematriaError(code, error.message, opts)
  }
  const detail = error instanceof Error ? error.message : String(error)
  return new GematriaError('source_error', `entropy draw failed: ${detail}`, opts)
}

/**
 * Run `body` against a reader for `source`, owning its lifecycle and mapping
 * its errors. Arguments must already be validated.
 */
async function withReader<T>(
  source: EntropyInput,
  signal: AbortSignal | undefined,
  cipher: CipherId | undefined,
  body: (reader: ByteReader, account: () => EntropyAccounting) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) {
    throw new GematriaError('aborted', 'draw aborted before it started', {
      cause: signal.reason,
      ...(cipher !== undefined ? { cipher } : {}),
    })
  }
  let reader: ByteReader | undefined
  try {
    const r = byteReader(source, signal ? { signal } : {})
    reader = r
    const startConsumed = r.bytesConsumed
    const startFetched = r.bytesFetched
    const account = (): EntropyAccounting => {
      const bytesConsumed = r.bytesConsumed - startConsumed
      const fetched = r.bytesFetched
      return {
        bytesConsumed,
        bitsUsed: bytesConsumed * 8,
        ...(fetched !== undefined && startFetched !== undefined
          ? { bytesFetched: fetched - startFetched }
          : {}),
      }
    }
    return await body(r, account)
  } catch (error) {
    throw mapError(error, cipher)
  } finally {
    if (reader !== undefined && reader !== source) await reader.close()
  }
}

/**
 * Draw one word from `lexicon` uniformly at random from `source` (any lexicon
 * item, whatever its script — no cipher is involved).
 *
 * @throws GematriaError `'invalid_input'` for an empty/invalid lexicon, invalid
 *   options or an unrecognized source; reader failures as in the module doc
 */
export async function drawWord(
  lexicon: Lexicon,
  source: EntropyInput,
  opts?: DrawOptions,
): Promise<DrawWordResult> {
  const items = nonEmpty(lexicon)
  const signal = checkSignal(opts)
  return withReader(source, signal, undefined, async (reader, account) => {
    const index = await uniformInt(reader, items.length)
    return Object.freeze({ word: wordOf(items[index] as Lexicon[number]), ...account() })
  })
}

/**
 * Draw one word uniformly among the admissible `lexicon` words whose value
 * under `cipher` equals `targetValue` (or lies within `opts.colel` /
 * `opts.tolerance` of it). Returns the word and its {@link GematriaResult}.
 *
 * @throws GematriaError `'invalid_input'` for an empty/invalid lexicon, a target
 *   that is not a non-negative safe integer, or invalid options
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 * @throws GematriaError `'no_match'` if no admissible word is within the window
 */
export async function drawByValue(
  lexicon: Lexicon,
  cipher: CipherRef,
  targetValue: number,
  source: EntropyInput,
  opts?: MatchDrawOptions,
): Promise<DrawByValueResult> {
  const items = nonEmpty(lexicon)
  const c = getCipher(cipher)
  if (typeof targetValue !== 'number' || !Number.isSafeInteger(targetValue) || targetValue < 0) {
    throw new GematriaError(
      'invalid_input',
      `targetValue must be a non-negative integer, got ${String(targetValue)}`,
      { cipher: c.id },
    )
  }
  const signal = checkSignal(opts)
  const tolerance = toleranceOf(opts)
  const candidates = matchScored(targetValue, admissible(items, c), tolerance).matches
  if (candidates.length === 0) {
    throw new GematriaError(
      'no_match',
      `no lexicon word has ${c.id} value ${targetValue}${tolerance > 0 ? ` ± ${tolerance}` : ''}`,
      { cipher: c.id },
    )
  }
  return withReader(source, signal, c.id, async (reader, account) => {
    const word = candidates[await uniformInt(reader, candidates.length)] as string
    return Object.freeze({
      word,
      cipher: c.id,
      targetValue,
      tolerance,
      result: analyze(word, c.id),
      ...account(),
    })
  })
}

/**
 * A full "gematria oracle reading": draw a word uniformly among the lexicon's
 * admissible words under `cipher`, then return its complete {@link profile},
 * its value/reduction under `cipher`, and every admissible peer within the
 * colel/tolerance window with the honest `commonness`.
 *
 * @throws GematriaError `'invalid_input'` for an empty/invalid lexicon or invalid options
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 * @throws GematriaError `'no_match'` if no lexicon word is admissible under `cipher`
 */
export async function castGematria(
  lexicon: Lexicon,
  cipher: CipherRef,
  source: EntropyInput,
  opts?: MatchDrawOptions,
): Promise<GematriaCast> {
  const items = nonEmpty(lexicon)
  const c = getCipher(cipher)
  const signal = checkSignal(opts)
  const tolerance = toleranceOf(opts)
  const scored = admissible(items, c)
  return withReader(source, signal, c.id, async (reader, account) => {
    const drawn = scored[await uniformInt(reader, scored.length)] as ScoredWord
    const result = analyze(drawn.word, c.id)
    const found = matchScored(drawn.value, scored, tolerance)
    return Object.freeze({
      word: drawn.word,
      cipher: c.id,
      value: result.value,
      reduced: result.reduced,
      profile: profile(drawn.word),
      matches: found.matches,
      exact: found.exact,
      tolerance,
      commonness: found.commonness,
      lexiconSize: found.lexiconSize,
      ...account(),
    })
  })
}

/** Options for {@link castByValue}. */
export interface CastByValueOptions extends MatchDrawOptions {
  /**
   * `'lexicon'` (default) draws uniformly among the admissible lexicon's
   * distinct realized values under `cipher`, so the draw always resolves to at
   * least one word. `'range'` instead draws uniformly over `[min, max]`, an
   * arbitrary numeric range that may contain no lexicon word at all.
   */
  mode?: 'lexicon' | 'range'
  /** Inclusive lower bound for `'range'` mode, an integer ≥ 0. Default `1`. */
  min?: number
  /**
   * Inclusive upper bound for `'range'` mode, an integer ≤ $2^{48}$. Default the
   * admissible lexicon's largest value. The range may span at most $2^{48}$ values.
   */
  max?: number
}

/**
 * The result of {@link castByValue}: an entropy-drawn number, honestly framed
 * as a number and nothing more, plus whichever lexicon words happen to share it.
 */
export interface ValueCast extends EntropyAccounting {
  /** The randomly drawn target value. Entropy, not a message. */
  readonly value: number
  /** Every admissible word within tolerance of `value` (may be empty in range mode). */
  readonly words: readonly string[]
  /** The subset of `words` with exactly `value`. */
  readonly exact: readonly string[]
  readonly tolerance: number
  /** `words.length / lexiconSize`, in $[0, 1]$. */
  readonly commonness: number
  /** Admissible lexicon words under the cipher. */
  readonly lexiconSize: number
  /** The resolved canonical cipher id. */
  readonly cipher: CipherId
  /** The number-lore portrait of the drawn value (triangular?, factors, …). */
  readonly numbers: NumberProperties
}

function checkBound(name: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > MAX_NUMBER) {
    throw new GematriaError(
      'invalid_input',
      `range ${name} must be an integer in [0, 2^48], got ${String(v)}`,
    )
  }
  return v
}

/**
 * The entropy→number→words oracle: draw a numeric value at random from
 * `source`, then report every admissible `lexicon` word that happens to share it
 * (within the colel/tolerance window). This is the honest inverse of
 * `castGematria` — there the entropy picks a word and the value follows; here
 * the entropy picks the value and the words are whatever the lexicon happens to
 * share it with. A reflection, not a message.
 *
 * Default `'lexicon'` mode draws uniformly among the distinct values of the
 * admissible words under `cipher`, so `words` is never empty. `'range'` mode
 * draws uniformly over `[opts.min ?? 1, opts.max ?? <largest admissible value>]`
 * instead, and may resolve to a value no lexicon word has. Every bound is checked
 * before any entropy is read. The result carries a {@link NumberProperties}
 * portrait of the drawn value. The lexicon may be omitted to use the registered
 * default (see `useDefaultLexicon`).
 *
 * @throws GematriaError `'invalid_input'` for an empty/invalid lexicon, invalid
 *   options, or an invalid range (bounds outside $[0, 2^{48}]$, `max < min`, or
 *   more than $2^{48}$ values)
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 * @throws GematriaError `'no_match'` if no lexicon word is admissible under `cipher`
 */
export function castByValue(
  cipher: CipherRef,
  source: EntropyInput,
  opts?: CastByValueOptions,
): Promise<ValueCast>
export function castByValue(
  lexicon: Lexicon,
  cipher: CipherRef,
  source: EntropyInput,
  opts?: CastByValueOptions,
): Promise<ValueCast>
export async function castByValue(
  first: CipherRef | Lexicon,
  second: CipherRef | EntropyInput,
  third?: EntropyInput | CastByValueOptions,
  fourth?: CastByValueOptions,
): Promise<ValueCast> {
  const hasLexicon = Array.isArray(first)
  const items = nonEmpty(hasLexicon ? first : defaultLexiconSnapshot())
  const c = getCipher((hasLexicon ? second : first) as CipherRef)
  const source = (hasLexicon ? third : second) as EntropyInput
  const opts = (hasLexicon ? fourth : third) as CastByValueOptions | undefined
  const signal = checkSignal(opts)
  const tolerance = toleranceOf(opts)
  const mode = opts?.mode ?? 'lexicon'
  if (mode !== 'lexicon' && mode !== 'range') {
    throw new GematriaError(
      'invalid_input',
      `mode must be 'lexicon' or 'range', got ${String(mode)}`,
    )
  }
  const scored = admissible(items, c)
  let largest = 0
  for (const { value: v } of scored) if (v > largest) largest = v

  let pick: (reader: ByteReader) => Promise<number>
  if (mode === 'range') {
    const min = checkBound('min', opts?.min ?? 1)
    const max = checkBound('max', opts?.max ?? largest)
    if (max < min) {
      throw new GematriaError('invalid_input', `invalid range [${min}, ${max}]: max < min`)
    }
    const width = max - min + 1
    if (width > MAX_UNIFORM) {
      throw new GematriaError('invalid_input', `range [${min}, ${max}] spans more than 2^48 values`)
    }
    pick = async (reader) => min + (await uniformInt(reader, width))
  } else {
    if (largest > MAX_NUMBER) {
      throw new GematriaError('invalid_input', `lexicon values exceed 2^48 under ${c.id}`)
    }
    const distinct = [...new Set(scored.map((s) => s.value))].sort((a, b) => a - b)
    pick = async (reader) => distinct[await uniformInt(reader, distinct.length)] as number
  }

  return withReader(source, signal, c.id, async (reader, account) => {
    const target = await pick(reader)
    const found = matchScored(target, scored, tolerance)
    return Object.freeze({
      value: target,
      words: found.matches,
      exact: found.exact,
      tolerance,
      commonness: found.commonness,
      lexiconSize: found.lexiconSize,
      cipher: c.id,
      numbers: numberProperties(target),
      ...account(),
    })
  })
}
