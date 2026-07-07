import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { byteArrayFrom } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'qrandom.io',
  kind: 'qrng',
  privacy: 'private',
})
// Undocumented cap — stay at a polite request size.
const MAX_PER_REQUEST = 1000
const DEFAULT_BASE_URL = 'https://qrandom.io/api/random/ints'

export interface QrandomIoOptions {
  fetch?: typeof fetch
  baseUrl?: string
}

interface QrandomResponse {
  numbers?: unknown
}

/**
 * qrandom.io — free, keyless QRNG backed by ID Quantique Quantis hardware.
 * Responses are Falcon-512-signed by the service (signature not verified
 * here in v1). Anonymous operator: fine in a mix, not as a trust anchor.
 */
export function qrandomIo(opts: QrandomIoOptions = {}): EntropyProvider {
  const { baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = opts

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        const query = new URLSearchParams({ n: String(n), min: '0', max: '255' })
        const res = await fetchJson<QrandomResponse>(`${baseUrl}?${query}`, {
          provider: INFO.name,
          signal: reqOpts?.signal,
          fetchImpl,
        })
        chunks.push(byteArrayFrom(res?.numbers, n, INFO.name))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
