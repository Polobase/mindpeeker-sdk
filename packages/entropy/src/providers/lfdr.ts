import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { bytesFromHexField } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({ name: 'lfdr', kind: 'qrng', privacy: 'private' })
// No documented cap — self-imposed politeness limit per request.
const MAX_PER_REQUEST = 1024
const DEFAULT_BASE_URL = 'https://lfdr.de/qrng_api/qrng'

export interface LfdrOptions {
  fetch?: typeof fetch
  baseUrl?: string
}

interface LfdrResponse {
  length?: number
  qrn?: unknown
}

/**
 * LfD (Germany) QRNG — an ID Quantique Quantis PCIe card behind a free,
 * keyless HTTP API. Hobby-grade: no SLA, no published limits.
 */
export function lfdr(opts: LfdrOptions = {}): EntropyProvider {
  const { baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = opts

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        const query = new URLSearchParams({ length: String(n), format: 'HEX' })
        const res = await fetchJson<LfdrResponse>(`${baseUrl}?${query}`, {
          provider: INFO.name,
          signal: reqOpts?.signal,
          fetchImpl,
        })
        chunks.push(bytesFromHexField(res?.qrn, n, INFO.name))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
