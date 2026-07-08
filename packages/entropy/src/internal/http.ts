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
   * to the default mapping.
   */
  onErrorResponse?: (status: number, body: string) => EntropyError | undefined
}

function defaultErrorFor(
  status: number,
  body: string,
  response: Response,
  provider: string,
): EntropyError {
  if (status === 429) {
    const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '')
    return new EntropyError('rate_limited', `HTTP 429: ${body.slice(0, 200)}`, {
      provider,
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
    })
  }
  if (status === 401 || status === 403) {
    return new EntropyError('auth', `HTTP ${status}: ${body.slice(0, 200)}`, { provider })
  }
  return new EntropyError('network', `HTTP ${status}: ${body.slice(0, 200)}`, { provider })
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')
}

/** Shared transport + error taxonomy: resolve to an OK Response or throw EntropyError. */
async function fetchOk(url: string, opts: FetchJsonOptions, accept: string): Promise<Response> {
  const { provider, signal } = opts
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
    throw new EntropyError('network', `request to ${url} failed: ${(error as Error).message}`, {
      provider,
      cause: error,
    })
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw (
      opts.onErrorResponse?.(response.status, body) ??
      defaultErrorFor(response.status, body, response, provider)
    )
  }
  return response
}

/**
 * fetch + JSON parse with the library's uniform error taxonomy. Abort/timeout
 * reasons pass through unwrapped so `defineProvider` can classify them.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const response = await fetchOk(url, opts, 'application/json')
  try {
    return (await response.json()) as T
  } catch (error) {
    throw new EntropyError('bad_response', `invalid JSON from ${url}`, {
      provider: opts.provider,
      cause: error,
    })
  }
}

/** fetch returning the raw text body (e.g. Bitcoin tip-hash endpoints). */
export async function fetchText(url: string, opts: FetchJsonOptions): Promise<string> {
  const response = await fetchOk(url, opts, 'text/plain')
  try {
    return await response.text()
  } catch (error) {
    throw new EntropyError('bad_response', `unreadable body from ${url}`, {
      provider: opts.provider,
      cause: error,
    })
  }
}
