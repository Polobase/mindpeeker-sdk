import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { byteArrayFrom } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({ name: 'anu', kind: 'qrng', privacy: 'private' })
const MAX_PER_REQUEST = 1024
const DEFAULT_BASE_URL = 'https://api.quantumnumbers.anu.edu.au'

export interface AnuOptions {
  /** ANU Quantum Numbers API key (AWS Marketplace subscription). */
  apiKey: string
  fetch?: typeof fetch
  /** Override for tests or a server-side proxy that hides the key. */
  baseUrl?: string
}

interface AnuResponse {
  success?: boolean
  data?: unknown
}

/**
 * ANU Quantum Numbers (quantum-vacuum fluctuations), keyed API.
 * https://quantumnumbers.anu.edu.au — up to 1024 numbers per request.
 */
export function anu(opts: AnuOptions): EntropyProvider {
  if (!opts?.apiKey) throw new TypeError('anu({ apiKey }) requires a non-empty apiKey')
  const { apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = opts

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        const query = new URLSearchParams({ length: String(n), type: 'uint8' })
        const res = await fetchJson<AnuResponse>(`${baseUrl}?${query}`, {
          provider: INFO.name,
          headers: { 'x-api-key': apiKey },
          signal: reqOpts?.signal,
          fetchImpl,
        })
        if (res?.success !== true) {
          throw new EntropyError('bad_response', 'ANU QRNG returned an unsuccessful response', {
            provider: INFO.name,
          })
        }
        chunks.push(byteArrayFrom(res.data, n, INFO.name))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
