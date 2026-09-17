/**
 * Handshake policy and option validation for the dashboard server. Bun-only
 * by placement (it lives next to `dashboard.ts`), but the functions are pure
 * over `Request`/strings so they unit-test without a socket.
 */
import { VisualizerError } from '../errors.js'

/** Largest inbound WebSocket message accepted before the runtime closes the socket. */
export const MAX_INBOUND_PAYLOAD_BYTES = 1024

/** Validated, normalized `DashboardOptions` fields the server needs. */
export interface ServerConfig {
  readonly port: number
  /** Host exactly as given (or `localhost`), passed to `Bun.serve`. */
  readonly host: string
  /** Host as it must appear in a URL: IPv6 literals bracketed. */
  readonly urlHost: string
  readonly ringCapacity: number
  /** Normalized `scheme://host[:port]` origins allowed besides same-host pages. */
  readonly allowedOrigins: ReadonlySet<string>
  /** Hostnames (lower-case, IPv6 bracketed) of `allowedOrigins`, for the Host check. */
  readonly allowedHostnames: ReadonlySet<string>
  /** Whether the bind host is loopback, which enables the DNS-rebinding Host check. */
  readonly loopbackBind: boolean
}

function optionError(message: string): VisualizerError {
  return new VisualizerError('server', message)
}

/** Render an arbitrary option value for an error message without ever throwing. */
function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    return String(value)
  } catch {
    return typeof value
  }
}

/** Bracket a bare IPv6 literal (`::1` → `[::1]`); anything else is returned unchanged. */
export function bracketHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

/**
 * Whether a hostname (as `URL.hostname` renders it: lower-case, IPv6 in
 * brackets) always resolves to the local machine: `localhost`, `*.localhost`
 * (RFC 6761), `127.0.0.0/8`, or `[::1]`.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '[::1]' || h === '::1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
}

/**
 * Validate the server-facing options and resolve defaults. Throws
 * `VisualizerError('server')` naming the offending option.
 */
export function resolveServerConfig(opts: {
  readonly port?: unknown
  readonly host?: unknown
  readonly ringCapacity?: unknown
  readonly allowedOrigins?: unknown
}): ServerConfig {
  const port = opts.port ?? 0
  if (!Number.isInteger(port) || (port as number) < 0 || (port as number) > 65_535) {
    throw optionError(`port must be an integer in [0, 65535], got ${show(port)}`)
  }
  const host = opts.host ?? 'localhost'
  if (typeof host !== 'string' || host.trim().length === 0) {
    throw optionError(`host must be a non-empty string, got ${show(host)}`)
  }
  const ringCapacity = opts.ringCapacity ?? 256
  if (!Number.isInteger(ringCapacity) || (ringCapacity as number) < 1) {
    throw optionError(`ringCapacity must be an integer ≥ 1, got ${show(ringCapacity)}`)
  }
  const origins = new Set<string>()
  const hostnames = new Set<string>()
  if (opts.allowedOrigins !== undefined) {
    if (!Array.isArray(opts.allowedOrigins)) {
      throw optionError('allowedOrigins must be an array of origin strings')
    }
    for (const entry of opts.allowedOrigins) {
      const url = typeof entry === 'string' ? parseUrl(entry) : undefined
      const bareOrigin =
        url !== undefined &&
        url.origin !== 'null' &&
        (url.pathname === '/' || url.pathname === '') &&
        url.search === '' &&
        url.hash === '' &&
        url.username === '' &&
        url.password === ''
      if (!url || !bareOrigin) {
        throw optionError(
          `allowedOrigins entries must be absolute scheme://host[:port] origins, got ${show(entry)}`,
        )
      }
      origins.add(url.origin)
      hostnames.add(url.hostname)
    }
  }
  const unbracketed = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return {
    port: port as number,
    host,
    urlHost: bracketHost(host),
    ringCapacity: ringCapacity as number,
    allowedOrigins: origins,
    allowedHostnames: hostnames,
    loopbackBind: isLoopbackHostname(bracketHost(unbracketed)),
  }
}

function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text)
  } catch {
    return undefined
  }
}

/**
 * Decide whether a `/ws` upgrade request may proceed. Returns `undefined` when
 * allowed, otherwise a short reason (sent with HTTP 403):
 *
 * 1. `Host` must be present; on a loopback bind its hostname must be loopback
 *    or belong to an allowed origin (a DNS-rebinding page names its own host).
 * 2. No `Origin` header (a non-browser client) is allowed — browsers always
 *    send one on WebSocket handshakes, and a local process needs no hijack.
 * 3. An `Origin` listed in `allowedOrigins`, or whose `host` equals the
 *    request's `Host` (same host and port), is allowed; anything else,
 *    including the opaque origin `null`, is refused.
 */
export function upgradeRefusal(req: Request, config: ServerConfig): string | undefined {
  const hostHeader = req.headers.get('host')
  const requestHost = hostHeader ? parseUrl(`http://${hostHeader}`) : undefined
  if (!hostHeader || !requestHost) return 'missing or malformed Host header'
  if (
    config.loopbackBind &&
    !isLoopbackHostname(requestHost.hostname) &&
    !config.allowedHostnames.has(requestHost.hostname)
  ) {
    return `host ${requestHost.hostname} is not allowed`
  }
  const origin = req.headers.get('origin')
  if (origin === null) return undefined
  const originUrl = parseUrl(origin)
  if (!originUrl || originUrl.origin === 'null') return 'opaque or malformed Origin'
  if (config.allowedOrigins.has(originUrl.origin)) return undefined
  const sameHost = parseUrl(`${originUrl.protocol}//${hostHeader}`)
  if (sameHost && sameHost.host === originUrl.host) return undefined
  return `origin ${originUrl.origin} is not allowed`
}
