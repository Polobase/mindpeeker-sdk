/**
 * The value engine: turn a word into an integer (or a structured breakdown)
 * under one or every applicable cipher. Pure and deterministic — a word's
 * value is a fixed function of its letters, consuming no entropy.
 */

import { forwardLetterFn } from './ciphers/variants.js'
import { GematriaError } from './errors.js'
import { detectScript, digitRoot, normalizeFor } from './normalize.js'
import { numberProperties } from './numbers.js'
import { CIPHERS_BY_SCRIPT, getCipher } from './registry.js'
import type {
  AnalyzeOptions,
  Cipher,
  CipherId,
  CipherRef,
  CipherValue,
  GematriaProfile,
  GematriaResult,
  LetterBreakdown,
  LetterValue,
  ProfileLetter,
  ProfileOptions,
  Script,
  ValueOptions,
} from './types.js'
import {
  isOptionsObject,
  type ResolvedValueOptions,
  requireString,
  resolveValueOptions,
} from './validate.js'

/** Apply a cipher's optional word-level {@link Cipher.postSum} to a raw total. */
function finalize(cipher: Cipher, sum: number): number {
  return cipher.postSum ? cipher.postSum(sum) : sum
}

/** Per-cipher cache of canonical-letter → alphabet index. */
const ALPHABET_INDEX = new WeakMap<Cipher, ReadonlyMap<string, number>>()

function alphabetIndex(cipher: Cipher): ReadonlyMap<string, number> {
  let index = ALPHABET_INDEX.get(cipher)
  if (!index) {
    index = new Map(cipher.alphabet.map((letter, i) => [letter, i]))
    ALPHABET_INDEX.set(cipher, index)
  }
  return index
}

/**
 * The per-letter value function for `cipher` under validated options. Reverse
 * is defined over the cipher's canonical alphabet: a character folds to its
 * canonical letter at index $i$ and takes the forward value of the letter at
 * $n - 1 - i$ — a↔z for Latin, aleph↔tav for Hebrew (finals included), α↔ϡ over
 * the 27 Milesian numerals for Greek. Glyph variants therefore share a reversed
 * value, and reversing twice is the forward cipher. Characters outside the
 * alphabet score 0.
 */
function letterFn(cipher: Cipher, opts: ResolvedValueOptions): (ch: string) => number {
  const forward = forwardLetterFn(cipher, opts)
  if (!opts.reverse) return forward
  const index = alphabetIndex(cipher)
  const { alphabet } = cipher
  const last = alphabet.length - 1
  return (ch) => {
    const i = index.get(cipher.fold(ch))
    return i === undefined ? 0 : forward(alphabet[last - i] as string)
  }
}

/**
 * The digital root of a non-negative integer — the public reduction used by
 * Mispar Katan and the Pythagorean cipher. $\operatorname{dr}(0) = 0$.
 *
 * @throws GematriaError `'invalid_input'` unless `n` is a non-negative integer
 */
export function reduce(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new GematriaError('invalid_input', `reduce expects a non-negative integer, got ${n}`)
  }
  return digitRoot(n)
}

/**
 * The integer value of `text` under one cipher: the sum of its letters'
 * values, after normalizing for the cipher's script. Characters outside the
 * cipher's alphabet (spaces, punctuation, other alphabets) score `0`. `cipher`
 * accepts a canonical {@link CipherId} or a friendly `CipherAlias` (e.g.
 * `'jewish'`, `'simple'`) — see `resolveCipherId`.
 *
 * The third argument is either the `reverse` flag (score the cipher's mirror
 * over its canonical alphabet, see {@link Cipher}) or a {@link ValueOptions}
 * bag, which adds the cipher-specific `keepTen` (`en-reduction`) and
 * `namesVariant` (`he-milui`, `he-neelam`) options.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string, the third
 *   argument is neither a boolean nor a valid options object, or a
 *   cipher-specific option is used on another cipher
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function value(
  text: string,
  cipher: CipherRef,
  reverse: boolean | ValueOptions = false,
): number {
  requireString(text)
  const opts = resolveValueOptions(reverse)
  const c = getCipher(cipher)
  const letter = letterFn(c, opts)
  let sum = 0
  for (const ch of normalizeFor(text, c.script)) sum += letter(ch)
  return finalize(c, sum)
}

/**
 * The full single-cipher result: the total, its digital root, and a per-letter
 * breakdown (only value-bearing letters appear; for a cipher with a word-level
 * `postSum` the breakdown sums to the total *before* it). `cipher` accepts a
 * {@link CipherRef}; the result's `cipher` field always carries the resolved
 * canonical {@link CipherId}. `opts` takes the {@link ValueOptions} (`reverse`,
 * `keepTen`, `namesVariant`) plus `numberProperties` to attach a number-lore
 * portrait of the total.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string or `opts`
 *   is invalid (see {@link value})
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function analyze(
  text: string,
  cipher: CipherRef,
  opts: AnalyzeOptions = {},
): GematriaResult {
  requireString(text)
  if (!isOptionsObject(opts as unknown)) {
    throw new GematriaError('invalid_input', `analyze options must be an object`)
  }
  const resolved = resolveValueOptions(opts)
  const wantNumbers = opts.numberProperties ?? false
  if (typeof wantNumbers !== 'boolean') {
    throw new GematriaError('invalid_input', `numberProperties must be a boolean`)
  }
  const c = getCipher(cipher)
  const letter = letterFn(c, resolved)
  const byLetter: LetterBreakdown[] = []
  let sum = 0
  for (const ch of normalizeFor(text, c.script)) {
    const v = letter(ch)
    if (v > 0) {
      byLetter.push(Object.freeze({ char: ch, value: v }))
      sum += v
    }
  }
  const total = finalize(c, sum)
  return Object.freeze({
    text,
    cipher: c.id,
    script: c.script,
    value: total,
    reduced: digitRoot(total),
    byLetter: Object.freeze(byLetter),
    ...(wantNumbers ? { numbers: numberProperties(total) } : {}),
  })
}

/**
 * The frozen glyph→value table for a cipher, given by a {@link CipherRef}. With
 * `reverse` (or a {@link ValueOptions} bag) each row carries that glyph's value
 * under those options — the mirrored table for `reverse: true`, where glyph
 * variants share their canonical letter's mirrored value.
 *
 * @throws GematriaError `'invalid_input'` for invalid options (see {@link value})
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function letterValues(
  cipher: CipherRef,
  reverse: boolean | ValueOptions = false,
): readonly LetterValue[] {
  const opts = resolveValueOptions(reverse)
  const c = getCipher(cipher)
  if (!opts.reverse && !opts.keepTen && opts.namesVariant === 'standard') return c.table
  const letter = letterFn(c, opts)
  return Object.freeze(
    c.table.map((row) => Object.freeze({ char: row.char, value: letter(row.char) })),
  )
}

/** Own-property lookup, so prototype keys (`'constructor'`) are not scripts. */
function hasCiphers(script: unknown): script is Script {
  return typeof script === 'string' && Object.hasOwn(CIPHERS_BY_SCRIPT, script)
}

/**
 * Every cipher value applicable to `text`'s script, as a superset of the
 * frontend `GematriaResult`: `{ text, script, values, byLetter }`. Script is
 * auto-detected (override via `opts.script`). The modern calculator ciphers
 * are included by default; pass `includeModern: false` for the rest. The
 * SDK-added *extended* methods are excluded by default so a profile stays a
 * drop-in for the frontend engine; pass `includeExtended: true` to add them.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string or an
 *   option has the wrong type
 * @throws GematriaError `'unsupported_script'` for an unrecognized forced script
 */
export function profile(text: string, opts: ProfileOptions = {}): GematriaProfile {
  requireString(text)
  if (!isOptionsObject(opts as unknown)) {
    throw new GematriaError('invalid_input', `profile options must be an object`)
  }
  for (const key of ['includeModern', 'includeExtended'] as const) {
    const flag: unknown = opts[key]
    if (flag !== undefined && typeof flag !== 'boolean') {
      throw new GematriaError('invalid_input', `${key} must be a boolean, got ${typeof flag}`)
    }
  }
  const script: unknown = opts.script ?? detectScript(text)
  if (!hasCiphers(script)) {
    throw new GematriaError('unsupported_script', `unsupported script: ${String(script)}`)
  }
  const includeModern = opts.includeModern ?? true
  const includeExtended = opts.includeExtended ?? false
  const ciphers = CIPHERS_BY_SCRIPT[script]
    .map((id) => getCipher(id))
    .filter((c) => (includeExtended || !c.extended) && (includeModern || !c.modern))
  const norm = [...normalizeFor(text, script)]

  const values: CipherValue[] = ciphers.map((c) => {
    let sum = 0
    for (const ch of norm) sum += c.letterValue(ch)
    const total = finalize(c, sum)
    return Object.freeze({ cipher: c.id, label: c.label, value: total, reduced: digitRoot(total) })
  })

  const byLetter: ProfileLetter[] = []
  for (const ch of norm) {
    const perCipher: Partial<Record<CipherId, number>> = {}
    let contributes = false
    for (const c of ciphers) {
      const v = c.letterValue(ch)
      perCipher[c.id] = v
      if (v > 0) contributes = true
    }
    if (contributes) byLetter.push(Object.freeze({ char: ch, values: Object.freeze(perCipher) }))
  }

  return Object.freeze({
    text,
    script,
    values: Object.freeze(values),
    byLetter: Object.freeze(byLetter),
  })
}
