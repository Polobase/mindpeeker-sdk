/**
 * Notariqon — forming a word from the first (or last) letters of the words of
 * a phrase, one of the three divisions of the literal Kabbalah (Scholem). The
 * classic example is אגלא (AGLA) from *Atah Gibor Le-olam Adonai*.
 *
 * This is string surgery on *letters*: split on whitespace, normalize each word
 * for its own script, and take one letter from each word. Only letters (Unicode
 * category L) are candidates, so vowel points, cantillation, combining accents,
 * digits, punctuation and invisible format controls are never picked:
 *
 * - **Hebrew and Arabic** words are normalized with {@link normalizeFor} (niqqud
 *   and harakāt stripped, presentation forms folded); Hebrew final forms are
 *   preserved as written (לְךָ → last letter ך).
 * - **Every other script** is composed to NFC with format controls removed, so
 *   letters keep their case and precomposed accents (Émile → É).
 *
 * A word with no letter at all (a dash, a number) contributes nothing. The
 * resulting acronym can then be scored with any cipher via {@link value}.
 *
 * The Baal ha-Turim distinguishes contraction by *roshei teivot* (initials),
 * *sofei teivot* (finals) and *emtsaei teivot* (medials); {@link acronym}
 * exposes all three, while {@link notariqon} keeps the original first/last API.
 *
 * Source: Gershom Scholem, *Kabbalah* (Notariqon); the Baal ha-Turim's
 * roshei/sofei/emtsaei teivot.
 */

import { GematriaError } from './errors.js'
import { detectScript, normalizeFor } from './normalize.js'
import type { AcronymOptions, NotariqonOptions } from './types.js'
import { isOptionsObject, requireString } from './validate.js'

const LETTER = /\p{L}/u
const FORMAT_CONTROLS = /\p{Cf}/gu

/** The letters of one whitespace-free word, normalized for its detected script. */
function lettersOf(word: string): string[] {
  const script = detectScript(word)
  const norm =
    script === 'hebrew' || script === 'arabic'
      ? normalizeFor(word, script)
      : word.replace(FORMAT_CONTROLS, '').normalize('NFC')
  return [...norm].filter((ch) => LETTER.test(ch))
}

type Pick = 'first' | 'last' | 'medial'

function contract(text: string, pick: Pick): string {
  let out = ''
  for (const word of text.split(/\s+/)) {
    const letters = lettersOf(word)
    if (letters.length === 0) continue
    const index =
      pick === 'first' ? 0 : pick === 'last' ? letters.length - 1 : Math.floor(letters.length / 2)
    out += letters[index] as string
  }
  return out
}

function readPick(opts: unknown, key: 'mode' | 'from', allowed: readonly Pick[]): Pick {
  if (opts === undefined) return 'first'
  if (!isOptionsObject(opts)) {
    throw new GematriaError(
      'invalid_input',
      `${key === 'mode' ? 'notariqon' : 'acronym'} options must be an object`,
    )
  }
  const pick = opts[key] ?? 'first'
  if (typeof pick !== 'string' || !(allowed as readonly string[]).includes(pick)) {
    throw new GematriaError(
      'invalid_input',
      `${key} must be one of ${allowed.join(', ')}, got ${String(pick)}`,
    )
  }
  return pick as Pick
}

/**
 * Build the notariqon (acronym) of `text`: the first or last letter of each
 * whitespace-separated word, concatenated in order (see the module doc for the
 * per-script normalization and the letters-only rule).
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string or
 *   `opts.mode` is not `'first'`/`'last'`
 */
export function notariqon(text: string, opts?: NotariqonOptions): string {
  requireString(text)
  return contract(text, readPick(opts, 'mode', ['first', 'last']))
}

/**
 * Notariqon contraction: build a word from one letter of each whitespace-
 * separated word of `text` — its initials (`'first'`, roshei teivot), finals
 * (`'last'`, sofei teivot) or middles (`'medial'`, emtsaei teivot, the letter
 * at index $\lfloor n/2 \rfloor$ of the word's $n$ letters). Score the result
 * with any cipher via {@link value}.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string or
 *   `opts.from` is not `'first'`/`'last'`/`'medial'`
 */
export function acronym(text: string, opts?: AcronymOptions): string {
  requireString(text)
  return contract(text, readPick(opts, 'from', ['first', 'last', 'medial']))
}
