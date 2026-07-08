import { EntropyError } from '../errors.js'
import { concatBytes, hexToBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({ name: 'qbck', kind: 'qrng', privacy: 'private' })
const MAX_PER_REQUEST = 256
const DEFAULT_BASE_URL = 'https://qrng.qbck.io'

export interface QbckOptions {
  /** Free key by email registration at quantumblockchains.io. Sits in the URL path. */
  apiKey: string
  fetch?: typeof fetch
  baseUrl?: string
}

interface QbckResponse {
  data?: { result?: unknown }
  result?: unknown
  error?: unknown
  message?: unknown
}

// NOTE: the qbck response schema is documented only in their PDF and the
// exact success shape is unverified without a registered key. The parse below
// tolerates the two plausible shapes (array of hex strings / single hex
// string, under data.result or result). VERIFY-WITH-KEY before production.
function parseHexResult(res: QbckResponse, expected: number): Uint8Array {
  const raw = res?.data?.result ?? res?.result
  const joined = Array.isArray(raw) ? raw.join('') : typeof raw === 'string' ? raw : null
  if (joined === null) {
    const detail = typeof res?.message === 'string' ? res.message : 'missing result field'
    throw new EntropyError('bad_response', `qbck: ${detail}`, { provider: INFO.name })
  }
  let bytes: Uint8Array
  try {
    bytes = hexToBytes(joined)
  } catch (error) {
    throw new EntropyError('bad_response', 'qbck: invalid hex payload', {
      provider: INFO.name,
      cause: error,
    })
  }
  if (bytes.length !== expected) {
    throw new EntropyError(
      'bad_response',
      `qbck: expected ${expected} bytes, got ${bytes.length}`,
      {
        provider: INFO.name,
      },
    )
  }
  return bytes
}

/**
 * Quantum Blockchains QRNG aggregator (IDQ Quantis, qStream, SeQRNG, Tropos
 * hardware behind one API). PRIVATE draws; free key by email registration.
 */
export function qbck(opts: QbckOptions): EntropyProvider {
  if (!opts?.apiKey) throw new TypeError('qbck({ apiKey }) requires a non-empty apiKey')
  const { apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = opts

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        const res = await fetchJson<QbckResponse>(`${baseUrl}/${apiKey}/qbck/block/hex?size=${n}`, {
          provider: INFO.name,
          signal: reqOpts?.signal,
          fetchImpl,
        })
        chunks.push(parseHexResult(res, n))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
