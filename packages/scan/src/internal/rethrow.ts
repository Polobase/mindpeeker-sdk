import { ScanError, type ScanErrorCode } from '../errors.js'

/** Structural view of a sibling package error (`OracleError`, `PsiError`, …). */
interface CodedError {
  readonly name: string
  readonly code: string
  readonly message: string
  readonly cause?: unknown
}

function coded(error: unknown): CodedError | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const e = error as Partial<CodedError>
  if (typeof e.name !== 'string' || typeof e.code !== 'string') return undefined
  return e as CodedError
}

/**
 * The sibling errors this package maps, by class name and code. Matching is
 * structural (name + code) rather than `instanceof`, so it survives duplicated
 * package copies in a bundle.
 */
const MAP: Readonly<Record<string, Readonly<Record<string, ScanErrorCode>>>> = {
  OracleError: {
    aborted: 'aborted',
    closed: 'aborted',
    insufficient_entropy: 'insufficient_entropy',
    source_error: 'source_error',
    // every numeric argument is validated before a draw, so what remains is a
    // source that yielded a non-byte chunk (or a foreign reader in use elsewhere)
    invalid_input: 'source_error',
  },
  PsiError: {
    aborted: 'aborted',
    insufficient_data: 'insufficient_entropy',
    invalid_plan: 'invalid_options',
    plan_mismatch: 'invalid_options',
    source_mismatch: 'invalid_options',
  },
  NegentropyError: {
    aborted: 'aborted',
    source_ended: 'insufficient_entropy',
    source_failed: 'source_error',
    health_test: 'source_error',
    timeout: 'source_error',
    invalid_config: 'invalid_options',
  },
  RateError: {
    aborted: 'aborted',
    invalid_rate: 'invalid_options',
    invalid_base: 'invalid_options',
  },
}

/** Wrapper codes whose `cause` is the error that actually matters. */
function isWrapper(error: CodedError): boolean {
  return (
    (error.name === 'OracleError' && error.code === 'source_error') ||
    (error.name === 'NegentropyError' && error.code === 'source_failed')
  )
}

/**
 * Map any error raised while a scan, broadcast, or tripolar scan runs onto a
 * {@link ScanError} — the single rule every entry point shares.
 *
 * A `ScanError` passes through. A source failure wrapped by oracle
 * (`source_error`) or negentropy (`source_failed`) is unwrapped: an inner
 * sibling error is mapped on its own terms (so a starved or aborted source
 * keeps its meaning through psi's trial stream), and a provider's own error —
 * say `EntropyError('health_test')` — becomes the `cause` of
 * `ScanError('source_error')`. Errors this package does not recognise (a
 * throwing `now` or `declare` callback) are returned unchanged.
 */
export function toScanError(error: unknown, source: string, activity: string): unknown {
  if (error instanceof ScanError) return error
  let current = coded(error)
  if (current === undefined) return error
  while (isWrapper(current)) {
    const inner = coded(current.cause)
    if (inner === undefined || MAP[inner.name] === undefined) {
      const cause = current.cause ?? current
      const detail = cause instanceof Error ? `: ${cause.message}` : ''
      return new ScanError('source_error', `${source} failed during the ${activity}${detail}`, {
        source,
        cause,
      })
    }
    current = inner
  }
  const code = MAP[current.name]?.[current.code]
  if (code === undefined) return error
  return new ScanError(code, messageFor(code, source, activity, current), {
    source,
    cause: current,
  })
}

function messageFor(
  code: ScanErrorCode,
  source: string,
  activity: string,
  error: CodedError,
): string {
  switch (code) {
    case 'aborted':
      return `${activity} aborted`
    case 'insufficient_entropy':
      return `${source} ran out of entropy during the ${activity}`
    case 'source_error':
      return `${source} failed during the ${activity}: ${error.message}`
    default:
      return `${activity}: ${error.message}`
  }
}
