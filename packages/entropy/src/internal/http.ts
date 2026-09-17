import { EntropyError } from '../errors.js'

export interface FetchJsonOptions {
  /** Provider name for error attribution. */
  provider: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  /** JSON-stringified and sent with content-type: application/json. */
  body?: unknown
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  /**
   * Provider-specific mapping of non-2xx responses (e.g. ANU legacy signals
   * its rate limit as HTTP 500 with a message). Return undefined to fall back
   * to the default mapping. Receives the raw (unredacted) body.
   */
  onErrorResponse?: (status: number, body: string) => EntropyError | undefined
  /**
   * Credentials (API keys, tokens) to mask wherever a URL, transport message
   * or response body is quoted in an error message.
   */
  secrets?: readonly string[]
}

/** Secrets shorter than this are not masked (they would mangle ordinary text). */
const MIN_SECRET_LENGTH = 4
const REDACTED = '***'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Replace every occurrence of each secret (raw and URI-encoded) with `***`. */
export function redactText(text: string, secrets: readonly string[] = []): string {
  let out = text
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) continue
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      out = out.split(form).join(REDACTED)
    }
  }
  return out
}

/**
 * A URL that is safe to quote in an error message: the query string and
 * fragment are dropped (`?…` marks that one existed), UUID-shaped path
 * segments (the usual key-in-path pattern) are masked, and every given
 * secret is masked wherever it still appears.
 */
export function redactUrl(url: string, secrets: readonly string[] = []): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    const bare = url.split(/[?#]/)[0] ?? ''
    return redactText(bare, secrets) + (bare.length < url.length ? '?…' : '')
  }
  const path = parsed.pathname
    .split('/')
    .map((segment) => (UUID_RE.test(decodeSegment(segment)) ? REDACTED : segment))
    .join('/')
  const query = parsed.search.length > 0 ? '?…' : ''
  return redactText(`${parsed.origin}${path}${query}`, secrets)
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Parse an HTTP `Retry-After` header (RFC 9110 §10.2.3) into milliseconds:
 * delta-seconds or an HTTP-date. Never negative (a date in the past is 0);
 * `undefined` when absent or unparseable.
 */
export function parseRetryAfter(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (header === null) return undefined
  const value = header.trim()
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000)
  // HTTP-date always names a weekday/month; bare signed numbers are not dates.
  if (!/[a-z]/i.test(value)) return undefined
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

function defaultErrorFor(
  status: number,
  body: string,
  response: Response,
  opts: FetchJsonOptions,
): EntropyError {
  const { provider, secrets } = opts
  const snippet = redactText(body, secrets).slice(0, 200)
  if (status === 429) {
    return new EntropyError('rate_limited', `HTTP 429: ${snippet}`, {
      provider,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    })
  }
  if (status === 401 || status === 403) {
    return new EntropyError('auth', `HTTP ${status}: ${snippet}`, { provider })
  }
  return new EntropyError('network', `HTTP ${status}: ${snippet}`, { provider })
}

/** A caller abort or timeout, which callers classify themselves (`aborted` / `timeout`). */
export function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'TimeoutError'))
  )
}

/** Shared transport + error taxonomy: resolve to an OK Response or throw EntropyError. */
async function fetchOk(url: string, opts: FetchJsonOptions, accept: string): Promise<Response> {
  const { provider, signal, secrets } = opts
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const headers: Record<string, string> = { accept, ...opts.headers }
  const init: RequestInit = { method: opts.method ?? 'GET', headers, signal }
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(opts.body)
  }

  let response: Response
  try {
    response = await fetchImpl(url, init)
  } catch (error) {
    if (isAbort(error, signal)) throw error
    const message = redactText(error instanceof Error ? error.message : String(error), secrets)
    throw new EntropyError('network', `request to ${redactUrl(url, secrets)} failed: ${message}`, {
      provider,
      cause: error,
    })
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw (
      opts.onErrorResponse?.(response.status, body) ??
      defaultErrorFor(response.status, body, response, opts)
    )
  }
  return response
}

/**
 * fetch + JSON parse with the library's uniform error taxonomy. Abort/timeout
 * reasons pass through unwrapped — also when they interrupt the body read — so
 * `defineProvider` can classify them. Error messages never quote a query
 * string or a configured secret.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const response = await fetchOk(url, opts, 'application/json')
  try {
    return (await response.json()) as T
  } catch (error) {
    if (isAbort(error, opts.signal)) throw error
    throw new EntropyError('bad_response', `invalid JSON from ${redactUrl(url, opts.secrets)}`, {
      provider: opts.provider,
      cause: error,
    })
  }
}

/** fetch returning the raw text body (e.g. Bitcoin tip-hash endpoints, PEM certificates). */
export async function fetchText(url: string, opts: FetchJsonOptions): Promise<string> {
  const response = await fetchOk(url, opts, 'text/plain')
  try {
    return await response.text()
  } catch (error) {
    if (isAbort(error, opts.signal)) throw error
    throw new EntropyError('bad_response', `unreadable body from ${redactUrl(url, opts.secrets)}`, {
      provider: opts.provider,
      cause: error,
    })
  }
}
