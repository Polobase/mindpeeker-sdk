import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { byteArrayFrom } from '../internal/validate.js'
import type { EntropyProvider, EntropyRequestOptions, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({ name: 'qci', kind: 'qrng', privacy: 'private' })
// API allows up to 1M samples/request; stay well below.
const MAX_PER_REQUEST = 100_000
const DEFAULT_BASE_URL = 'https://api.qci-prod.com'
const TOKEN_SAFETY_MARGIN_MS = 30_000

export interface QciOptions {
  /** QCi API token (exchanged for a short-lived bearer token). */
  apiToken: string
  fetch?: typeof fetch
  baseUrl?: string
}

interface TokenResponse {
  access_token?: unknown
  expires_in?: unknown
}

/**
 * Quantum Computing Inc. uQRNG (photonic). OAuth2-style flow: the long-lived
 * API token is exchanged for a bearer token, cached until expiry, and
 * refreshed once automatically when a request comes back 401.
 */
export function qci(opts: QciOptions): EntropyProvider {
  if (!opts?.apiToken) throw new TypeError('qci({ apiToken }) requires a non-empty apiToken')
  const { apiToken, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = opts

  let cached: { token: string; expiresAt: number } | null = null
  let inflight: Promise<{ token: string; expiresAt: number }> | null = null

  async function getToken(signal?: AbortSignal): Promise<string> {
    if (cached && Date.now() < cached.expiresAt - TOKEN_SAFETY_MARGIN_MS) return cached.token
    if (!inflight) {
      inflight = fetchJson<TokenResponse>(`${baseUrl}/auth/v1/access-tokens`, {
        provider: INFO.name,
        method: 'POST',
        body: { refresh_token: apiToken },
        signal,
        fetchImpl,
      })
        .then((res) => {
          const token = res?.access_token
          if (typeof token !== 'string' || token.length === 0) {
            throw new EntropyError('auth', 'QCi token exchange returned no access_token', {
              provider: INFO.name,
            })
          }
          // Observed in the wild as an absolute unix timestamp despite the
          // OAuth-style name; handle both interpretations.
          const raw = res?.expires_in
          const expiresAt =
            typeof raw === 'number'
              ? raw > 1_000_000_000
                ? raw * 1000
                : Date.now() + raw * 1000
              : Date.now() + 300_000
          return { token, expiresAt }
        })
        .finally(() => {
          inflight = null
        })
    }
    cached = await inflight
    return cached.token
  }

  async function fetchSamples(
    n: number,
    reqOpts: EntropyRequestOptions | undefined,
    retried: boolean,
  ): Promise<Uint8Array> {
    const token = await getToken(reqOpts?.signal)
    try {
      const res = await fetchJson<unknown>(`${baseUrl}/qrng/random_numbers`, {
        provider: INFO.name,
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: { distribution: 'uniform_discrete', output_type: 'decimal', n_samples: n, n_bits: 8 },
        signal: reqOpts?.signal,
        fetchImpl,
      })
      return byteArrayFrom(res, n, INFO.name)
    } catch (error) {
      if (!retried && error instanceof EntropyError && error.code === 'auth') {
        cached = null // token expired server-side — re-authenticate once
        return fetchSamples(n, reqOpts, true)
      }
      throw error
    }
  }

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        chunks.push(await fetchSamples(n, reqOpts, false))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
