/**
 * Lexicons: validation, script-aware scoring, and the registry behind the
 * default-lexicon overloads.
 *
 * **Admissible words.** A lexicon is scored under one cipher at a time, and only
 * its *admissible* words take part: a word must be written in the cipher's
 * script (a {@link LexiconWord}'s declared `script`, else `detectScript(word)`)
 * and contain at least one letter the cipher scores. Everything else — a Greek
 * word under a Hebrew cipher, an empty string, pure punctuation — would score
 * 0, "match" every other such word and inflate or deflate the honest
 * `commonness` denominator, so it is skipped. Duplicate words count once per
 * occurrence.
 *
 * **Registry.** {@link createLexiconRegistry} makes an isolated registry; the
 * package keeps one shared registry that `useDefaultLexicon` /
 * `getDefaultLexicon` / `clearDefaultLexicon` operate on and the two-argument
 * `matches(text, cipher)` / `lookup(n, cipher)` / `castByValue(cipher, source)`
 * overloads read. Registering replaces the previous lexicon; the registry stores
 * its own copy (a deeply frozen input, like the bundled Sepher Sephiroth, is kept
 * as is), so later mutation of the caller's array has no effect. The arrays a
 * registry returns are that copy: treat them as read-only.
 */

import { GematriaError } from './errors.js'
import { detectScript, isScript, normalizeFor } from './normalize.js'
import { getCipher } from './registry.js'
import type { Cipher, CipherId, CipherRef, Lexicon, LexiconWord } from './types.js'
import { isOptionsObject } from './validate.js'

/** One admissible lexicon word with its value under a cipher. */
export interface ScoredWord {
  readonly word: string
  readonly value: number
}

/**
 * Validate a lexicon at the public boundary.
 *
 * @throws GematriaError `'invalid_input'` unless `lexicon` is an array whose
 *   items are strings or `{ word: string, script?: Script }` objects
 */
export function checkLexicon(lexicon: unknown): asserts lexicon is Lexicon {
  if (!Array.isArray(lexicon)) {
    throw new GematriaError('invalid_input', 'lexicon must be an array of words')
  }
  for (let i = 0; i < lexicon.length; i++) {
    const item: unknown = lexicon[i]
    if (typeof item === 'string') continue
    if (!isOptionsObject(item) || typeof item.word !== 'string') {
      throw new GematriaError(
        'invalid_input',
        `lexicon item ${i} must be a string or a { word, script? } object`,
      )
    }
    if (item.script !== undefined && !isScript(item.script)) {
      throw new GematriaError(
        'invalid_input',
        `lexicon item ${i} has an unknown script: ${String(item.script)}`,
      )
    }
  }
}

/** The word of a lexicon item. */
export function wordOf(item: string | LexiconWord): string {
  return typeof item === 'string' ? item : item.word
}

/**
 * The value of `word` under `cipher`, or `undefined` if no letter of it scores
 * (the same sum `value(word, cipher)` computes).
 */
function scoreWord(word: string, ascii: boolean, cipher: Cipher): number | undefined {
  let sum = 0
  let scoring = false
  // Printable ASCII has no format controls and is NFKD-stable: Latin normalization is lowercasing.
  const norm =
    ascii && cipher.script === 'latin' ? word.toLowerCase() : normalizeFor(word, cipher.script)
  for (const ch of norm) {
    const v = cipher.letterValue(ch)
    if (v > 0) {
      sum += v
      scoring = true
    }
  }
  if (!scoring) return undefined
  return cipher.postSum ? cipher.postSum(sum) : sum
}

/** Anything outside printable ASCII (space … tilde). */
const NOT_PRINTABLE_ASCII = /[^ -~]/

/** Scored admissible words of deeply frozen lexicons, per cipher. */
const SCORED = new WeakMap<Lexicon, Map<CipherId, readonly ScoredWord[]>>()

function deeplyFrozen(lexicon: Lexicon): boolean {
  return (
    Object.isFrozen(lexicon) &&
    lexicon.every((item) => typeof item === 'string' || Object.isFrozen(item))
  )
}

/**
 * The admissible words of a validated `lexicon` under `cipher`, each with its
 * value, in lexicon order. Results for deeply frozen lexicons are memoized.
 */
export function scoreLexicon(lexicon: Lexicon, cipher: Cipher): readonly ScoredWord[] {
  const cached = SCORED.get(lexicon)?.get(cipher.id)
  if (cached) return cached
  // Internal and never handed out, so not frozen (freezing large arrays is slow).
  const scored: ScoredWord[] = []
  for (const item of lexicon) {
    const word = wordOf(item)
    const ascii = !NOT_PRINTABLE_ASCII.test(word)
    const declared = typeof item === 'string' ? undefined : item.script
    const script = declared ?? (ascii ? 'latin' : detectScript(word))
    if (script !== cipher.script) continue
    const value = scoreWord(word, ascii, cipher)
    if (value !== undefined) scored.push({ word, value })
  }
  if (deeplyFrozen(lexicon)) {
    let perCipher = SCORED.get(lexicon)
    if (!perCipher) {
      perCipher = new Map()
      SCORED.set(lexicon, perCipher)
    }
    perCipher.set(cipher.id, scored)
  }
  return scored
}

/**
 * The admissible words of `lexicon` under `cipher`, as plain strings in lexicon
 * order.
 *
 * @throws GematriaError `'invalid_input'` for an invalid lexicon
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function admissibleWords(lexicon: Lexicon, cipher: CipherRef): readonly string[] {
  checkLexicon(lexicon)
  return scoreLexicon(lexicon, getCipher(cipher)).map((s) => s.word)
}

/**
 * A holder for one lexicon — the object behind the default-lexicon overloads.
 * Create isolated ones with {@link createLexiconRegistry}.
 */
export interface LexiconRegistry {
  /**
   * Register `lexicon`, replacing any previous one.
   *
   * @throws GematriaError `'invalid_input'` for an invalid lexicon
   */
  use(lexicon: Lexicon): void
  /**
   * The registered lexicon as stored (the registry's read-only copy).
   *
   * @throws GematriaError `'invalid_input'` if nothing is registered
   */
  lexicon(): Lexicon
  /**
   * The registered words; with `cipher`, only the words admissible under it
   * (its script, at least one scoring letter).
   *
   * @throws GematriaError `'invalid_input'` if nothing is registered
   * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
   */
  words(cipher?: CipherRef): readonly string[]
  /** Whether a lexicon is registered. */
  has(): boolean
  /** Forget the registered lexicon. */
  clear(): void
}

const NONE_REGISTERED =
  "no lexicon supplied and no default registered — pass a lexicon, or import the '@mindpeeker/gematria/lexicon' subpath (its defaultLexicon() registers one)"

/** Create an isolated {@link LexiconRegistry} with nothing registered. */
export function createLexiconRegistry(): LexiconRegistry {
  let stored: Lexicon | undefined
  let words: readonly string[] = []
  const current = (): Lexicon => {
    if (!stored) throw new GematriaError('invalid_input', NONE_REGISTERED)
    return stored
  }
  return Object.freeze({
    use(lexicon: Lexicon): void {
      checkLexicon(lexicon)
      stored = deeplyFrozen(lexicon)
        ? lexicon
        : lexicon.map((item) =>
            typeof item === 'string'
              ? item
              : {
                  word: item.word,
                  ...(item.script !== undefined ? { script: item.script } : {}),
                },
          )
      words = stored.map(wordOf)
    },
    lexicon: current,
    words(cipher?: CipherRef): readonly string[] {
      const lexicon = current()
      return cipher === undefined ? words : admissibleWords(lexicon, cipher)
    },
    has: () => stored !== undefined,
    clear(): void {
      stored = undefined
      words = []
    },
  })
}

/** The shared registry the default-lexicon overloads read. */
const DEFAULT_REGISTRY = createLexiconRegistry()

/**
 * Register the lexicon used by `matches` / `lookup` (and the `./oracle`
 * `castByValue`) when they are called without an explicit one, replacing any
 * previous default. Importing `@mindpeeker/gematria/lexicon` registers the
 * bundled Sepher Sephiroth (with each entry's declared script).
 *
 * @throws GematriaError `'invalid_input'` for an invalid lexicon
 */
export function useDefaultLexicon(lexicon: Lexicon): void {
  DEFAULT_REGISTRY.use(lexicon)
}

/**
 * The registered default lexicon's words — all of them, or with `cipher` only
 * those admissible under it (its script, at least one scoring letter).
 *
 * @throws GematriaError `'invalid_input'` if no default has been registered
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function getDefaultLexicon(cipher?: CipherRef): readonly string[] {
  return DEFAULT_REGISTRY.words(cipher)
}

/**
 * Forget the registered default lexicon, so the two-argument overloads throw
 * again until one is registered (useful in tests).
 */
export function clearDefaultLexicon(): void {
  DEFAULT_REGISTRY.clear()
}

/**
 * The registered default lexicon as stored.
 *
 * @throws GematriaError `'invalid_input'` if no default has been registered
 * @internal used by the default-lexicon overloads
 */
export function defaultLexiconSnapshot(): Lexicon {
  return DEFAULT_REGISTRY.lexicon()
}
