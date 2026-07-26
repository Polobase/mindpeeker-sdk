/**
 * Notariqon — forming a word from the first (or last) letters of the words of
 * a phrase, one of the three divisions of the literal Kabbalah (Scholem). The
 * classic example is אגלא (AGLA) from *Atah Gibor Le-olam Adonai*.
 *
 * This is pure string surgery: split on whitespace and take one letter from
 * each word. The resulting acronym can then be scored with any cipher via
 * {@link value}. Letters are returned as written (final forms preserved).
 *
 * The Baal ha-Turim distinguishes contraction by *roshei teivot* (initials),
 * *sofei teivot* (finals) and *emtsaei teivot* (medials); {@link acronym}
 * exposes all three, while {@link notariqon} keeps the original first/last API.
 *
 * Source: Gershom Scholem, *Kabbalah* (Notariqon); the Baal ha-Turim's
 * roshei/sofei/emtsaei teivot.
 */

import { GematriaError } from './errors.js'
import type { AcronymOptions, NotariqonOptions } from './types.js'

/**
 * Build the notariqon (acronym) of `text`: the first or last letter of each
 * whitespace-separated word, concatenated in order.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 */
export function notariqon(text: string, opts: NotariqonOptions = {}): string {
  if (typeof text !== 'string') {
    throw new GematriaError('invalid_input', `text must be a string, got ${typeof text}`)
  }
  const mode = opts.mode ?? 'first'
  let out = ''
  for (const word of text.split(/\s+/)) {
    const chars = [...word]
    if (chars.length === 0) continue
    const ch = mode === 'first' ? chars[0] : chars[chars.length - 1]
    if (ch) out += ch
  }
  return out
}

/**
 * Notariqon contraction: build a word from one letter of each whitespace-
 * separated word of `text` — its initials (`'first'`, roshei teivot), finals
 * (`'last'`, sofei teivot) or middles (`'medial'`, emtsaei teivot, the letter
 * at index $\lfloor n/2 \rfloor$). Score the result with any cipher via
 * {@link value}.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 */
export function acronym(text: string, opts: AcronymOptions = {}): string {
  if (typeof text !== 'string') {
    throw new GematriaError('invalid_input', `text must be a string, got ${typeof text}`)
  }
  const from = opts.from ?? 'first'
  let out = ''
  for (const word of text.split(/\s+/)) {
    const chars = [...word]
    if (chars.length === 0) continue
    const ch =
      from === 'first'
        ? chars[0]
        : from === 'last'
          ? chars[chars.length - 1]
          : chars[Math.floor(chars.length / 2)]
    if (ch) out += ch
  }
  return out
}
