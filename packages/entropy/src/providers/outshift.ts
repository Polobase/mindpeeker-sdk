import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
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

export interface OutshiftOptions {
  /** Free key from https://qrng.outshift.com (Cisco account). */
  apiKey: string
  fetch?: typeof fetch
  baseUrl?: string
}

interface OutshiftResponse {
  random_numbers?: unknown
}

/**
 * Outshift by Cisco QRNG (photonic hardware). Free tier: 100k bits/day.
 * Blocks are requested in `format: 'all'` and read from the string-valued
 * `decimal` field — the one response shape verified in the wild.
 */
export function outshift(opts: OutshiftOptions): EntropyProvider {
  if (!opts?.apiKey) throw new TypeError('outshift({ apiKey }) requires a non-empty apiKey')
  const { apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = opts

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        const res = await fetchJson<OutshiftResponse>(baseUrl, {
          provider: INFO.name,
          method: 'POST',
          headers: { 'x-id-api-key': apiKey },
          body: { encoding: 'raw', format: 'all', bits_per_block: 8, number_of_blocks: n },
          signal: reqOpts?.signal,
          fetchImpl,
        })
        const entries = res?.random_numbers
        if (!Array.isArray(entries)) {
          throw new EntropyError('bad_response', 'missing random_numbers array', {
            provider: INFO.name,
          })
        }
        const values = entries.map((entry) =>
          typeof (entry as { decimal?: unknown })?.decimal === 'string'
            ? Number.parseInt((entry as { decimal: string }).decimal, 10)
            : Number.NaN,
        )
        chunks.push(byteArrayFrom(values, n, INFO.name))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
