/**
 * The cipher registry: the single source of truth for which ciphers exist,
 * their order, and how to resolve an id (or friendly {@link CipherAlias}) to
 * its {@link Cipher}. Hebrew ciphers come first, then Greek, Arabic and
 * English/Latin — the frontend engine's order, so a `profile()` matches it
 * row-for-row — followed by the alphabetic numeral ciphers of Cyrillic,
 * Armenian, Georgian, Coptic, Syriac and Gothic.
 */

import { ARABIC_CIPHERS } from './ciphers/arabic.js'
import { ENGLISH_CIPHERS } from './ciphers/english.js'
import { GREEK_CIPHERS } from './ciphers/greek.js'
import { HEBREW_CIPHERS } from './ciphers/hebrew.js'
import { NUMERAL_CIPHERS } from './ciphers/numerals.js'
import { GematriaError } from './errors.js'
import type { Cipher, CipherAlias, CipherId, CipherRef, Script } from './types.js'

/** Every supported cipher, deeply frozen, in canonical order. */
export const CIPHERS: readonly Cipher[] = Object.freeze([
  ...HEBREW_CIPHERS,
  ...GREEK_CIPHERS,
  ...ARABIC_CIPHERS,
  ...ENGLISH_CIPHERS,
  ...NUMERAL_CIPHERS,
])

const BY_ID: ReadonlyMap<CipherId, Cipher> = new Map(CIPHERS.map((c) => [c.id, c]))

function idsFor(script: Script): readonly CipherId[] {
  return Object.freeze(CIPHERS.filter((c) => c.script === script).map((c) => c.id))
}

/**
 * The applicable cipher ids for each script, in display order. Look a script up
 * with `Object.hasOwn(CIPHERS_BY_SCRIPT, script)` before indexing untrusted
 * input.
 */
export const CIPHERS_BY_SCRIPT: Readonly<Record<Script, readonly CipherId[]>> = Object.freeze({
  hebrew: idsFor('hebrew'),
  greek: idsFor('greek'),
  arabic: idsFor('arabic'),
  latin: idsFor('latin'),
  cyrillic: idsFor('cyrillic'),
  armenian: idsFor('armenian'),
  georgian: idsFor('georgian'),
  coptic: idsFor('coptic'),
  syriac: idsFor('syriac'),
  gothic: idsFor('gothic'),
})

/**
 * Friendly aliases the way online calculators name ciphers, mapped to their
 * canonical {@link CipherId}. `'latin'` and `'hebrew'` pick that script's
 * historical flagship (Agrippa, Hechrachi); `'simple'` and `'ordinal'` are the
 * two names calculators use for the same A1…Z26 cipher.
 */
export const ALIASES: Readonly<Record<CipherAlias, CipherId>> = Object.freeze({
  jewish: 'la-jewish',
  hebrew: 'he-hechrachi',
  latin: 'la-agrippa',
  english: 'en-english',
  simple: 'en-ordinal',
  ordinal: 'en-ordinal',
  sumerian: 'en-sumerian',
  isopsephy: 'gr-isopsephy',
})

function isAlias(ref: CipherRef): ref is CipherAlias {
  return typeof ref === 'string' && Object.hasOwn(ALIASES, ref)
}

/**
 * Resolve a {@link CipherRef} — a canonical {@link CipherId} or a friendly
 * {@link CipherAlias} — to its canonical id. An id (or an unrecognized
 * string) passes through unchanged, so `getCipher`/`cipherFromId` still raise
 * `'unknown_cipher'` for it.
 */
export function resolveCipherId(ref: CipherRef): CipherId {
  return isAlias(ref) ? ALIASES[ref] : ref
}

/** Resolve a cipher ref to its cipher, or `undefined` if unknown. */
export function cipherFromId(id: CipherRef): Cipher | undefined {
  return BY_ID.get(resolveCipherId(id))
}

/**
 * Resolve a cipher ref to its cipher.
 *
 * @throws GematriaError `'unknown_cipher'` for a ref not in the registry
 */
export function getCipher(id: CipherRef): Cipher {
  const resolved = resolveCipherId(id)
  const cipher = BY_ID.get(resolved)
  if (!cipher) {
    throw new GematriaError('unknown_cipher', `unknown cipher id: ${String(resolved)}`, {
      cipher: String(resolved),
    })
  }
  return cipher
}
