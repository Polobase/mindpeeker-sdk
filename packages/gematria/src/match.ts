/**
 * Equal-value lookup — the operation gematria practice is actually built on,
 * with an honesty knob bolted on.
 *
 * `matches` finds every word in a lexicon whose value equals the query's;
 * `lookup` runs it backwards — the gematrix.org `?word=<number>` feature —
 * starting from a number instead of a word. Both report `commonness` — the
 * fraction of the lexicon within tolerance of that value. Equal-value
 * coincidences are statistically cheap: with $N$ words spread over a value
 * range of width $R$, a given value has on the order of $N / R$ collisions by
 * chance alone. Surfacing that fraction is the point. A "match" at
 * commonness 0.2 is noise; the number keeps the tool from implying hidden
 * significance it cannot support (see the README, and `collisionProfile` for
 * the whole-lexicon statistics).
 *
 * **Admissible words only.** A lexicon is scored under the chosen cipher, and
 * only words written in the cipher's script with at least one scoring letter
 * take part (see `LexiconWord`): under `he-hechrachi` a Greek or English entry
 * is not a zero-valued "match" of every other foreign word, and it is not in
 * the `commonness` denominator (`lexiconSize`).
 *
 * **Colel** (כולל): the traditional rule that "equality under a difference of
 * one" still counts — `opts.colel` is a ±1 window, `opts.tolerance: n` a ±n
 * one. Within-tolerance hits appear in `matches`; the strictly-equal subset is
 * flagged separately in `exact`.
 *
 * **Default lexicon**: pass a lexicon explicitly, or register one once with
 * `useDefaultLexicon` (the `@mindpeeker/gematria/lexicon` subpath does this for
 * the bundled Sepher Sephiroth) and then call the two-argument overloads
 * `matches(text, cipher)` / `lookup(target, cipher)`.
 */

import { GematriaError } from './errors.js'
import {
  checkLexicon,
  defaultLexiconSnapshot,
  type ScoredWord,
  scoreLexicon,
} from './lexicon-registry.js'
import { getCipher } from './registry.js'
import type { CipherRef, Lexicon, MatchOptions, MatchResult } from './types.js'
import { isOptionsObject } from './validate.js'
import { value } from './value.js'

/**
 * The effective ±window of validated {@link MatchOptions}: explicit `tolerance`,
 * else 1 for `colel`, else 0.
 *
 * @throws GematriaError `'invalid_input'` if `opts` is not an object, `colel` is
 *   not a boolean, or `tolerance` is not a non-negative safe integer
 * @internal shared with the commonness statistics and the `./oracle` bridge
 */
export function toleranceOf(opts: unknown): number {
  if (opts === undefined) return 0
  if (!isOptionsObject(opts)) {
    throw new GematriaError('invalid_input', 'match options must be an object')
  }
  const { colel, tolerance } = opts
  if (colel !== undefined && typeof colel !== 'boolean') {
    throw new GematriaError('invalid_input', `colel must be a boolean, got ${typeof colel}`)
  }
  const t = tolerance ?? (colel ? 1 : 0)
  if (typeof t !== 'number' || !Number.isSafeInteger(t) || t < 0) {
    throw new GematriaError(
      'invalid_input',
      `tolerance must be a non-negative integer, got ${String(t)}`,
    )
  }
  return t
}

/** Build a {@link MatchResult} from a target value over scored admissible words. */
export function matchScored(
  target: number,
  scored: readonly ScoredWord[],
  tolerance: number,
): MatchResult {
  const within: string[] = []
  const exact: string[] = []
  for (const { word, value: v } of scored) {
    const delta = Math.abs(v - target)
    if (delta <= tolerance) {
      within.push(word)
      if (delta === 0) exact.push(word)
    }
  }
  return Object.freeze({
    value: target,
    matches: Object.freeze(within),
    exact: Object.freeze(exact),
    tolerance,
    commonness: scored.length === 0 ? 0 : within.length / scored.length,
    lexiconSize: scored.length,
  })
}

interface LexiconArgs {
  readonly lexicon: Lexicon
  readonly cipher: CipherRef
  readonly opts: unknown
}

/** Resolve the `(lexicon, cipher, opts)` / `(cipher, opts)` overloads. */
function lexiconArgs(second: unknown, third: unknown, fourth: unknown): LexiconArgs {
  if (Array.isArray(second)) {
    checkLexicon(second)
    return { lexicon: second, cipher: third as CipherRef, opts: fourth }
  }
  if (typeof second !== 'string') {
    throw new GematriaError('invalid_input', 'expected a lexicon array or a cipher id')
  }
  if (third !== undefined && !isOptionsObject(third)) {
    throw new GematriaError(
      'invalid_input',
      'lexicon must be an array of words (got a non-array before the cipher)',
    )
  }
  return { lexicon: defaultLexiconSnapshot(), cipher: second as CipherRef, opts: third }
}

/**
 * Whether two strings share a value under one cipher. With `opts.colel` (±1) or
 * `opts.tolerance: n` the comparison passes when the values differ by at most
 * that window.
 *
 * @throws GematriaError `'invalid_input'` for non-string words or invalid options
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function equalValue(a: string, b: string, cipher: CipherRef, opts?: MatchOptions): boolean {
  const tolerance = toleranceOf(opts)
  return Math.abs(value(a, cipher) - value(b, cipher)) <= tolerance
}

/**
 * Every admissible lexicon word whose value equals `text`'s value under
 * `cipher` (or lies within `opts.colel`/`opts.tolerance` of it), plus the honest
 * `commonness` over the `lexiconSize` admissible words. The lexicon may be passed
 * explicitly or omitted to use the registered default (see `useDefaultLexicon`).
 * Matches keep the lexicon's order.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string, the lexicon
 *   is missing/invalid, or the options are invalid
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function matches(text: string, cipher: CipherRef, opts?: MatchOptions): MatchResult
export function matches(
  text: string,
  lexicon: Lexicon,
  cipher: CipherRef,
  opts?: MatchOptions,
): MatchResult
export function matches(
  text: string,
  second: CipherRef | Lexicon,
  third?: CipherRef | MatchOptions,
  fourth?: MatchOptions,
): MatchResult {
  const args = lexiconArgs(second, third, fourth)
  const target = value(text, args.cipher)
  const tolerance = toleranceOf(args.opts)
  return matchScored(target, scoreLexicon(args.lexicon, getCipher(args.cipher)), tolerance)
}

/**
 * The reverse of `matches`: every admissible lexicon word whose value under
 * `cipher` equals `target` (or lies within tolerance), plus the honest
 * `commonness` — gematrix.org's `?word=<number>` reverse lookup. The lexicon may
 * be passed explicitly or omitted to use the registered default.
 *
 * @throws GematriaError `'invalid_input'` unless `target` is a non-negative safe
 *   integer, or if the lexicon is missing/invalid or the options are invalid
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function lookup(target: number, cipher: CipherRef, opts?: MatchOptions): MatchResult
export function lookup(
  target: number,
  lexicon: Lexicon,
  cipher: CipherRef,
  opts?: MatchOptions,
): MatchResult
export function lookup(
  target: number,
  second: CipherRef | Lexicon,
  third?: CipherRef | MatchOptions,
  fourth?: MatchOptions,
): MatchResult {
  if (typeof target !== 'number' || !Number.isSafeInteger(target) || target < 0) {
    throw new GematriaError(
      'invalid_input',
      `target must be a non-negative integer, got ${String(target)}`,
    )
  }
  const args = lexiconArgs(second, third, fourth)
  const cipher = getCipher(args.cipher)
  const tolerance = toleranceOf(args.opts)
  return matchScored(target, scoreLexicon(args.lexicon, cipher), tolerance)
}
