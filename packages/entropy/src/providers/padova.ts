import { EntropyError } from '../errors.js'
import { base64ToBytes, concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'padova',
  kind: 'qrng',
  privacy: 'private',
})
// No documented cap — conservative politeness limit per request.
const MAX_PER_REQUEST = 256
const DEFAULT_BASE_URL = 'https://qrng-qtech.vs-ix.net/api/get_string_get'

export interface PadovaOptions {
  fetch?: typeof fetch
  baseUrl?: string
}

interface PadovaResponse {
  string?: unknown
}

/**
 * University of Padova QRNG hosted at the VSIX internet exchange — keyless
 * PRIVATE quantum draws, the simplest QRNG API in the wild: one GET returning
 * base64 bytes. Academic service without an SLA.
 */
export function padova(opts: PadovaOptions = {}): EntropyProvider {
  const { baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = opts

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        const res = await fetchJson<PadovaResponse>(`${baseUrl}?string_length=${n}`, {
          provider: INFO.name,
          signal: reqOpts?.signal,
          fetchImpl,
        })
        if (typeof res?.string !== 'string') {
          throw new EntropyError('bad_response', 'missing string field', { provider: INFO.name })
        }
        let bytes: Uint8Array
        try {
          bytes = base64ToBytes(res.string)
        } catch (error) {
          throw new EntropyError('bad_response', 'invalid base64 payload', {
            provider: INFO.name,
            cause: error,
          })
        }
        if (bytes.length !== n) {
          throw new EntropyError('bad_response', `expected ${n} bytes, got ${bytes.length}`, {
            provider: INFO.name,
          })
        }
        chunks.push(bytes)
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
