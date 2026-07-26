/**
 * The value engine: turn a word into an integer (or a structured breakdown)
 * under one or every applicable cipher. Pure and deterministic — a word's
 * value is a fixed function of its letters, consuming no entropy.
 */

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
} from './types.js'

function requireString(text: unknown): asserts text is string {
  if (typeof text !== 'string') {
    throw new GematriaError('invalid_input', `text must be a string, got ${typeof text}`)
  }
}

/** Apply a cipher's optional word-level {@link Cipher.postSum} to a raw total. */
function finalize(cipher: Cipher, sum: number): number {
  return cipher.postSum ? cipher.postSum(sum) : sum
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
 * script (spaces, punctuation, other alphabets) score `0`. `cipher` accepts a
 * canonical {@link CipherId} or a friendly {@link CipherAlias} (e.g.
 * `'jewish'`, `'simple'`) — see {@link resolveCipherId}.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function value(text: string, cipher: CipherRef): number {
  requireString(text)
  const c = getCipher(cipher)
  const norm = normalizeFor(text, c.script)
  let sum = 0
  for (const ch of norm) sum += c.letterValue(ch)
  return finalize(c, sum)
}

/**
 * The full single-cipher result: the total, its digital root, and a per-letter
 * breakdown (only value-bearing letters appear). Deterministic. `cipher`
 * accepts a {@link CipherRef}; the result's `cipher` field always carries the
 * resolved canonical {@link CipherId}. Pass `opts.numberProperties` to attach a
 * {@link NumberProperties} portrait of the total.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function analyze(
  text: string,
  cipher: CipherRef,
  opts: AnalyzeOptions = {},
): GematriaResult {
  requireString(text)
  const c = getCipher(cipher)
  const norm = normalizeFor(text, c.script)
  const byLetter: LetterBreakdown[] = []
  let sum = 0
  for (const ch of norm) {
    const v = c.letterValue(ch)
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
    ...(opts.numberProperties ? { numbers: numberProperties(total) } : {}),
  })
}

/** The frozen alphabet→value table for a cipher, given by a {@link CipherRef}. */
export function letterValues(cipher: CipherRef): readonly LetterValue[] {
  return getCipher(cipher).table
}

/**
 * Every cipher value applicable to `text`'s script, as a superset of the
 * frontend `GematriaResult`: `{ text, script, values, byLetter }`. Script is
 * auto-detected (override via `opts.script`). The modern ×6 ciphers are
 * included by default; pass `includeModern: false` for the historical set only.
 * The SDK-added *extended* methods are excluded by default so a profile stays a
 * drop-in for the frontend engine; pass `includeExtended: true` to add them.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 * @throws GematriaError `'unsupported_script'` for an unrecognized forced script
 */
export function profile(text: string, opts: ProfileOptions = {}): GematriaProfile {
  requireString(text)
  const script: Script = opts.script ?? detectScript(text)
  const all = CIPHERS_BY_SCRIPT[script]
  if (!all) {
    throw new GematriaError('unsupported_script', `unsupported script: ${String(script)}`)
  }
  const includeModern = opts.includeModern ?? true
  const includeExtended = opts.includeExtended ?? false
  const ids = all.filter((id) => {
    const c = getCipher(id)
    if (c.extended && !includeExtended) return false
    if (c.modern && !includeModern) return false
    return true
  })
  const norm = normalizeFor(text, script)

  const values: CipherValue[] = ids.map((id) => {
    const c = getCipher(id)
    let sum = 0
    for (const ch of norm) sum += c.letterValue(ch)
    const total = finalize(c, sum)
    return Object.freeze({ cipher: id, label: c.label, value: total, reduced: digitRoot(total) })
  })

  const byLetter: ProfileLetter[] = []
  for (const ch of norm) {
    const perCipher: Partial<Record<CipherId, number>> = {}
    let contributes = false
    for (const id of ids) {
      const v = getCipher(id).letterValue(ch)
      perCipher[id] = v
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
