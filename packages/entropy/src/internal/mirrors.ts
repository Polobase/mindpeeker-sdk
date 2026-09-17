import { EntropyError } from '../errors.js'

/** Base-URL options every network provider accepts. */
export interface BaseUrlOptions {
  /** One base URL (e.g. a server-side proxy). Mutually exclusive with `baseUrls`. */
  baseUrl?: string
  /**
   * Mirrors tried in order per request: the next one is tried when a request
   * fails with anything but an abort or `invalid_request`. Non-empty.
   */
  baseUrls?: readonly string[]
}

function invalid(message: string, provider: string): EntropyError {
  return new EntropyError('invalid_request', message, { provider })
}

function requireUrl(value: unknown, name: string, provider: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${name} must be a non-empty string, got ${String(value)}`, provider)
  }
  return value
}

/**
 * Resolve `baseUrl` / `baseUrls` against the provider's defaults. Throws
 * `invalid_request` when both are given, `baseUrls` is empty or any entry is
 * not a non-empty string.
 */
export function resolveBaseUrls(
  opts: BaseUrlOptions,
  defaults: readonly string[],
  provider: string,
): readonly string[] {
  if (opts.baseUrl !== undefined && opts.baseUrls !== undefined) {
    throw invalid('pass either baseUrl or baseUrls, not both', provider)
  }
  if (opts.baseUrl !== undefined) return [requireUrl(opts.baseUrl, 'baseUrl', provider)]
  if (opts.baseUrls !== undefined) {
    if (!Array.isArray(opts.baseUrls) || opts.baseUrls.length === 0) {
      throw invalid('baseUrls must be a non-empty array of URLs', provider)
    }
    return Object.freeze(opts.baseUrls.map((url, i) => requireUrl(url, `baseUrls[${i}]`, provider)))
  }
  return defaults
}

/**
 * Run `attempt` against each base URL in order until one succeeds. Aborts,
 * foreign errors and `invalid_request` stop the failover at once; any other
 * `EntropyError` moves on to the next mirror, and the last one is rethrown.
 */
export async function withMirrors<T>(
  bases: readonly string[],
  attempt: (base: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown
  for (const base of bases) {
    try {
      return await attempt(base)
    } catch (error) {
      if (
        !(error instanceof EntropyError) ||
        error.code === 'aborted' ||
        error.code === 'invalid_request'
      ) {
        throw error
      }
      lastError = error
    }
  }
  throw lastError
}
