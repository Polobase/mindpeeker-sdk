import { EntropyError } from '../errors.js'
import { raceSignal } from '../internal/abort.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireNonEmptyString } from '../internal/options.js'
import { defineProvider } from '../internal/provider.js'
import { byteArrayFrom } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({ name: 'qci', kind: 'qrng', privacy: 'private' })
// API allows up to 1M samples/request; stay well below.
const MAX_PER_REQUEST = 100_000
const DEFAULT_BASE_URL = 'https://api.qci-prod.com'
const TOKEN_SAFETY_MARGIN_MS = 30_000

export interface QciOptions extends BaseUrlOptions {
  /** QCi API token (exchanged for a short-lived bearer token). */
  apiToken: string
  fetch?: typeof fetch
}

interface TokenResponse {
  access_token?: unknown
  expires_in?: unknown
}

interface Token {
  token: string
  expiresAt: number
}

interface Exchange {
  promise: Promise<Token>
  controller: AbortController
  waiters: number
}

/**
 * Quantum Computing Inc. uQRNG (photonic). OAuth2-style flow: the long-lived
 * API token is exchanged for a bearer token, cached until expiry, and
 * refreshed once automatically when a request comes back 401. Concurrent
 * callers share one token exchange, which runs under its own abort domain:
 * each caller only stops waiting when its own signal fires, and the exchange
 * is cancelled only once no caller waits for it. Throws
 * `EntropyError('invalid_request')` at construction without an `apiToken`.
 */
export function qci(opts: QciOptions): EntropyProvider {
  const apiToken = requireNonEmptyString(opts?.apiToken, 'qci({ apiToken })', INFO.name)
  const bases = resolveBaseUrls(opts, [DEFAULT_BASE_URL], INFO.name)
  const { fetch: fetchImpl } = opts
  const secrets = [apiToken]

  let cached: Token | null = null
  let exchange: Exchange | null = null

  function startExchange(): Exchange {
    const controller = new AbortController()
    const promise = withMirrors(bases, (base) =>
      fetchJson<TokenResponse>(`${base}/auth/v1/access-tokens`, {
        provider: INFO.name,
        method: 'POST',
        body: { refresh_token: apiToken },
        signal: controller.signal,
        fetchImpl,
        secrets,
      }),
    ).then((res): Token => {
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
        typeof raw === 'number' && Number.isFinite(raw)
          ? raw > 1_000_000_000
            ? raw * 1000
            : Date.now() + raw * 1000
          : Date.now() + 300_000
      return { token, expiresAt }
    })
    const entry: Exchange = { promise, controller, waiters: 0 }
    promise.then(
      (token) => {
        cached = token
      },
      () => {},
    )
    promise
      .finally(() => {
        if (exchange === entry) exchange = null
      })
      .catch(() => {})
    return entry
  }

  async function getToken(signal: AbortSignal | undefined): Promise<string> {
    if (cached && Date.now() < cached.expiresAt - TOKEN_SAFETY_MARGIN_MS) return cached.token
    if (!exchange || exchange.controller.signal.aborted) exchange = startExchange()
    const entry = exchange
    entry.waiters++
    try {
      return (await raceSignal(entry.promise, signal)).token
    } finally {
      entry.waiters--
      // Nobody waits any more (every caller gave up): cancel the shared request.
      if (entry.waiters === 0) entry.controller.abort()
    }
  }

  async function fetchSamples(n: number, signal: AbortSignal | undefined, retried: boolean) {
    const token = await getToken(signal)
    try {
      const res = await withMirrors(bases, (base) =>
        fetchJson<unknown>(`${base}/qrng/random_numbers`, {
          provider: INFO.name,
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: {
            distribution: 'uniform_discrete',
            output_type: 'decimal',
            n_samples: n,
            n_bits: 8,
          },
          signal,
          fetchImpl,
          secrets: [...secrets, token],
        }),
      )
      return byteArrayFrom(res, n, INFO.name)
    } catch (error) {
      if (!retried && error instanceof EntropyError && error.code === 'auth') {
        cached = null // token expired server-side — re-authenticate once
        return fetchSamples(n, signal, true)
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
        chunks.push(await fetchSamples(n, reqOpts?.signal, false))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
