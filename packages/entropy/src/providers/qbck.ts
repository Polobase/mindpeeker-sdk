import { EntropyError } from '../errors.js'
import { concatBytes, hexToBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireNonEmptyString } from '../internal/options.js'
import { defineProvider } from '../internal/provider.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({ name: 'qbck', kind: 'qrng', privacy: 'private' })
const MAX_PER_REQUEST = 256
const DEFAULT_BASE_URL = 'https://qrng.qbck.io'
const HEX_STRING_RE = /^(?:[0-9a-fA-F]{2})+$/

export interface QbckOptions extends BaseUrlOptions {
  /**
   * Free key by email registration at quantumblockchains.io. Sits in the URL
   * path — error messages mask it.
   */
  apiKey: string
  fetch?: typeof fetch
}

interface QbckResponse {
  data?: { result?: unknown }
  result?: unknown
  error?: unknown
  message?: unknown
}

function malformed(message: string, cause?: unknown): EntropyError {
  return new EntropyError('bad_response', `qbck: ${message}`, { provider: INFO.name, cause })
}

// NOTE: the qbck response schema is documented only in their PDF and the
// exact success shape is unverified without a registered key. The parse below
// accepts the two plausible shapes (an array of hex strings / a single hex
// string, under data.result or result) and nothing else: numbers or odd-length
// strings in the array are rejected rather than reinterpreted as hex.
// VERIFY-WITH-KEY before production.
function parseHexResult(res: QbckResponse, expected: number): Uint8Array {
  const raw = res?.data?.result ?? res?.result
  let parts: readonly unknown[]
  if (Array.isArray(raw)) parts = raw
  else if (typeof raw === 'string') parts = [raw]
  else {
    throw malformed(typeof res?.message === 'string' ? res.message : 'missing result field')
  }
  let hex = ''
  for (const [i, part] of parts.entries()) {
    if (typeof part !== 'string' || !HEX_STRING_RE.test(part)) {
      throw malformed(`result element ${i} is not a hex byte string`)
    }
    hex += part
  }
  const bytes = hexToBytes(hex)
  if (bytes.length !== expected) {
    throw malformed(`expected ${expected} bytes, got ${bytes.length}`)
  }
  return bytes
}

/**
 * Quantum Blockchains QRNG aggregator (IDQ Quantis, qStream, SeQRNG, Tropos
 * hardware behind one API). PRIVATE draws; free key by email registration.
 * Throws `EntropyError('invalid_request')` at construction without an
 * `apiKey`.
 */
export function qbck(opts: QbckOptions): EntropyProvider {
  const apiKey = requireNonEmptyString(opts?.apiKey, 'qbck({ apiKey })', INFO.name)
  const bases = resolveBaseUrls(opts, [DEFAULT_BASE_URL], INFO.name)
  const { fetch: fetchImpl } = opts

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        const res = await withMirrors(bases, (base) =>
          fetchJson<QbckResponse>(
            `${base}/${encodeURIComponent(apiKey)}/qbck/block/hex?size=${n}`,
            { provider: INFO.name, signal: reqOpts?.signal, fetchImpl, secrets: [apiKey] },
          ),
        )
        chunks.push(parseHexResult(res, n))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
