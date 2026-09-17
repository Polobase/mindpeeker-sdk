import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireNonEmptyString } from '../internal/options.js'
import { defineProvider } from '../internal/provider.js'
import { byteArrayFrom } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'outshift',
  kind: 'qrng',
  privacy: 'private',
})
const MAX_PER_REQUEST = 1000 // documented cap: 1000 numbers per call
const DEFAULT_BASE_URL = 'https://api.qrng.outshift.com/api/v1/random_numbers'

export interface OutshiftOptions extends BaseUrlOptions {
  /** Free key from https://qrng.outshift.com (Cisco account). */
  apiKey: string
  fetch?: typeof fetch
}

interface OutshiftResponse {
  random_numbers?: unknown
}

/**
 * The credential must be a printable-ASCII token (U+0021–U+007E): whitespace
 * (e.g. a trailing newline read from a file), control and non-ASCII
 * characters are rejected at construction instead of failing later as a
 * network, auth or bad_response error. The value never enters the message.
 */
function requireCredential(value: unknown, name: string): string {
  const credential = requireNonEmptyString(value, name, INFO.name)
  if (!/^[!-~]+$/.test(credential)) {
    throw new EntropyError(
      'invalid_request',
      `${name} must be printable ASCII without whitespace or control characters`,
      { provider: INFO.name },
    )
  }
  return credential
}

/**
 * Outshift by Cisco QRNG (photonic hardware). Free tier: 100k bits/day.
 * Blocks are requested in `format: 'all'` and read from the string-valued
 * `decimal` field — the one response shape verified in the wild — which must
 * be a plain decimal integer (`'12abc'` is `bad_response`, not 12). Throws
 * `EntropyError('invalid_request')` at construction without a valid
 * `apiKey` (a non-empty printable-ASCII token).
 */
export function outshift(opts: OutshiftOptions): EntropyProvider {
  const apiKey = requireCredential(opts?.apiKey, 'outshift({ apiKey })')
  const bases = resolveBaseUrls(opts, [DEFAULT_BASE_URL], INFO.name)
  const { fetch: fetchImpl } = opts

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        const res = await withMirrors(bases, (base) =>
          fetchJson<OutshiftResponse>(base, {
            provider: INFO.name,
            method: 'POST',
            headers: { 'x-id-api-key': apiKey },
            body: { encoding: 'raw', format: 'all', bits_per_block: 8, number_of_blocks: n },
            signal: reqOpts?.signal,
            fetchImpl,
            secrets: [apiKey],
          }),
        )
        const entries = res?.random_numbers
        if (!Array.isArray(entries)) {
          throw new EntropyError('bad_response', 'missing random_numbers array', {
            provider: INFO.name,
          })
        }
        const values = entries.map((entry) => {
          const decimal = (entry as { decimal?: unknown } | null)?.decimal
          return typeof decimal === 'string' && /^\d{1,3}$/.test(decimal)
            ? Number(decimal)
            : Number.NaN
        })
        chunks.push(byteArrayFrom(values, n, INFO.name))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
