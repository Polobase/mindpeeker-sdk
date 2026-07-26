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
 * significance it cannot support (see the README).
 *
 * **Colel** (כולל): the traditional rule that "equality under a difference of
 * one" still counts — `opts.colel` is a ±1 window, `opts.tolerance: n` a ±n
 * one. Within-tolerance hits appear in `matches`; the strictly-equal subset is
 * flagged separately in `exact`.
 *
 * **Default lexicon**: pass a lexicon explicitly, or register one once with
 * {@link useDefaultLexicon} (the `@mindpeeker/gematria/lexicon` subpath does
 * this for the bundled Sepher Sephiroth) and then call the two-argument
 * overloads `matches(text, cipher)` / `lookup(target, cipher)`.
 */

import { GematriaError } from './errors.js'
import { getCipher } from './registry.js'
import type { CipherRef, MatchOptions, MatchResult } from './types.js'
import { value } from './value.js'

let DEFAULT_LEXICON: readonly string[] | undefined

/**
 * Register the lexicon used by `matches` / `lookup` (and the `./oracle`
 * `castByValue`) when they are called without an explicit one. Importing the
 * `@mindpeeker/gematria/lexicon` subpath calls this with the bundled corpus.
 *
 * @throws GematriaError `'invalid_input'` if `lexicon` is not an array
 */
export function useDefaultLexicon(lexicon: readonly string[]): void {
  if (!Array.isArray(lexicon)) {
    throw new GematriaError('invalid_input', 'default lexicon must be an array of strings')
  }
  DEFAULT_LEXICON = lexicon
}

/**
 * The registered default lexicon.
 *
 * @throws GematriaError `'invalid_input'` if no default has been registered
 */
export function getDefaultLexicon(): readonly string[] {
  if (!DEFAULT_LEXICON) {
    throw new GematriaError(
      'invalid_input',
      "no lexicon supplied and no default registered — pass a lexicon, or import the '@mindpeeker/gematria/lexicon' subpath (its defaultLexicon() registers one)",
    )
  }
  return DEFAULT_LEXICON
}

/** The effective ±window: explicit `tolerance`, else 1 for `colel`, else 0. */
function toleranceOf(opts: MatchOptions | undefined): number {
  const t = opts?.tolerance ?? (opts?.colel ? 1 : 0)
  if (!Number.isInteger(t) || t < 0) {
    throw new GematriaError('invalid_input', `tolerance must be a non-negative integer, got ${t}`)
  }
  return t
}

/** Build a {@link MatchResult} from a target value over a lexicon. */
function build(
  target: number,
  lexicon: readonly string[],
  cipher: CipherRef,
  opts: MatchOptions | undefined,
): MatchResult {
  getCipher(cipher) // validate/resolve the cipher even when the lexicon is empty
  const tolerance = toleranceOf(opts)
  const within: string[] = []
  const exact: string[] = []
  for (const word of lexicon) {
    const delta = Math.abs(value(word, cipher) - target)
    if (delta <= tolerance) {
      within.push(word)
      if (delta === 0) exact.push(word)
    }
  }
  const commonness = lexicon.length === 0 ? 0 : within.length / lexicon.length
  return Object.freeze({
    value: target,
    matches: Object.freeze(within),
    exact: Object.freeze(exact),
    tolerance,
    commonness,
  })
}

/**
 * Whether two strings share a value under one cipher. With `opts.colel` (±1) or
 * `opts.tolerance: n` the comparison passes when the values differ by at most
 * that window.
 */
export function equalValue(a: string, b: string, cipher: CipherRef, opts?: MatchOptions): boolean {
  return Math.abs(value(a, cipher) - value(b, cipher)) <= toleranceOf(opts)
}

/**
 * Every lexicon word whose value equals `text`'s value under `cipher` (or lies
 * within `opts.colel`/`opts.tolerance` of it), plus the honest `commonness`.
 * The lexicon may be passed explicitly or omitted to use the registered default
 * (see {@link useDefaultLexicon}). Matches keep the lexicon's order.
 *
 * @throws GematriaError `'invalid_input'` if the lexicon is missing/invalid
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function matches(text: string, cipher: CipherRef, opts?: MatchOptions): MatchResult
export function matches(
  text: string,
  lexicon: readonly string[],
  cipher: CipherRef,
  opts?: MatchOptions,
): MatchResult
export function matches(
  text: string,
  second: CipherRef | readonly string[],
  third?: CipherRef | MatchOptions,
  fourth?: MatchOptions,
): MatchResult {
  const hasLexicon = Array.isArray(second)
  const lexicon = hasLexicon ? (second as readonly string[]) : getDefaultLexicon()
  const cipher = (hasLexicon ? third : second) as CipherRef
  const opts = (hasLexicon ? fourth : (third as MatchOptions | undefined)) as
    | MatchOptions
    | undefined
  return build(value(text, cipher), lexicon, cipher, opts)
}

/**
 * The reverse of `matches`: every lexicon word whose value under `cipher`
 * equals `target` (or lies within tolerance), plus the honest `commonness` —
 * gematrix.org's `?word=<number>` reverse lookup. The lexicon may be passed
 * explicitly or omitted to use the registered default.
 *
 * @throws GematriaError `'invalid_input'` unless `target` is a non-negative integer
 * @throws GematriaError `'invalid_input'` if the lexicon is missing/invalid
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function lookup(target: number, cipher: CipherRef, opts?: MatchOptions): MatchResult
export function lookup(
  target: number,
  lexicon: readonly string[],
  cipher: CipherRef,
  opts?: MatchOptions,
): MatchResult
export function lookup(
  target: number,
  second: CipherRef | readonly string[],
  third?: CipherRef | MatchOptions,
  fourth?: MatchOptions,
): MatchResult {
  if (!Number.isInteger(target) || target < 0) {
    throw new GematriaError('invalid_input', `target must be a non-negative integer, got ${target}`)
  }
  const hasLexicon = Array.isArray(second)
  const lexicon = hasLexicon ? (second as readonly string[]) : getDefaultLexicon()
  const cipher = (hasLexicon ? third : second) as CipherRef
  const opts = (hasLexicon ? fourth : (third as MatchOptions | undefined)) as
    | MatchOptions
    | undefined
  return build(target, lexicon, cipher, opts)
}
