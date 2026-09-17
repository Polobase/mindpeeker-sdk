/**
 * Cipher-specific options (`keepTen`, `namesVariant`) resolved to the forward
 * letter function they select. An option that would change the result is only
 * accepted by the ciphers it belongs to; anywhere else it is a caller error.
 */

import { GematriaError } from '../errors.js'
import type { Cipher } from '../types.js'
import type { ResolvedValueOptions } from '../validate.js'
import { reductionKeepTen } from './english.js'
import { miluiLetter, neelamLetter } from './hebrew.js'

/**
 * The forward letter function for `cipher` under `opts` — the cipher's own
 * `letterValue` unless a cipher-specific option selects a variant.
 *
 * @throws GematriaError `'invalid_input'` for `keepTen: true` on a cipher other
 *   than `en-reduction`, or `namesVariant: 'plene'` on a cipher other than
 *   `he-milui` / `he-neelam`
 */
export function forwardLetterFn(
  cipher: Cipher,
  opts: ResolvedValueOptions,
): (ch: string) => number {
  if (opts.keepTen) {
    if (cipher.id !== 'en-reduction') {
      throw new GematriaError('invalid_input', `keepTen applies only to en-reduction`, {
        cipher: cipher.id,
      })
    }
    return reductionKeepTen
  }
  if (opts.namesVariant !== 'standard') {
    if (cipher.id === 'he-milui') return miluiLetter(opts.namesVariant)
    if (cipher.id === 'he-neelam') return neelamLetter(opts.namesVariant)
    throw new GematriaError(
      'invalid_input',
      `namesVariant applies only to he-milui and he-neelam`,
      {
        cipher: cipher.id,
      },
    )
  }
  return cipher.letterValue
}
