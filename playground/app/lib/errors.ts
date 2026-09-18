// Turning unknown throwables into something displayable. SSR-safe: it never
// imports the SDK, it only reads the shape every SDK error has
// (`name` + `code` + `message`, e.g. EntropyError('timeout')).

export interface ErrorInfo {
  /** Constructor name, e.g. 'EntropyError'. */
  readonly name: string
  /** Typed SDK error code, e.g. 'timeout' — absent for plain errors. */
  readonly code?: string
  readonly message: string
  /** Provider that raised it, when the error carries one. */
  readonly provider?: string
  /** `err.cause` rendered as one line, when present. */
  readonly cause?: string
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Normalize anything thrown into `{ name, code?, message }`. */
export function errorInfo(err: unknown): ErrorInfo {
  if (err instanceof Error) {
    const record = err as Error & { code?: unknown; provider?: unknown; cause?: unknown }
    const cause = record.cause
    return {
      name: err.name || 'Error',
      ...(str(record.code) ? { code: str(record.code) as string } : {}),
      message: err.message || String(err),
      ...(str(record.provider) ? { provider: str(record.provider) as string } : {}),
      ...(cause instanceof Error
        ? { cause: `${cause.name}: ${cause.message}` }
        : str(cause)
          ? { cause: str(cause) as string }
          : {}),
    }
  }
  if (typeof err === 'object' && err !== null) {
    const record = err as Record<string, unknown>
    return {
      name: str(record.name) ?? 'Error',
      ...(str(record.code) ? { code: str(record.code) as string } : {}),
      message: str(record.message) ?? JSON.stringify(err),
    }
  }
  return { name: 'Error', message: String(err) }
}

/** One line: `EntropyError (timeout): drand round timed out after 3500 ms`. */
export function errorLine(err: unknown): string {
  const info = errorInfo(err)
  return `${info.name}${info.code ? ` (${info.code})` : ''}: ${info.message}`
}

/**
 * True for the several shapes an abort takes: `DOMException('AbortError')`,
 * an SDK error with `code === 'aborted'`, or a `signal.throwIfAborted()` reason.
 */
export function isAbortError(err: unknown): boolean {
  const info = errorInfo(err)
  return info.name === 'AbortError' || info.code === 'aborted' || info.code === 'ABORT_ERR'
}
