/**
 * Health events of health-tested entropy sources for the demo: a device
 * session that fails `@mindpeeker/entropy`'s SP 800-90B health tests ends
 * with `EntropyError('health_test')`; this wrapper reports that event and
 * restarts the session, so a long-running dashboard survives rare false
 * alarms while every failure stays visible.
 */
import { EntropyError } from '@mindpeeker/entropy'
import type { ByteProvider } from '../sources.js'

/**
 * Sessions in a row that may fail their health tests before delivering any
 * output; the next such failure is final (a device that cannot pass its
 * start-up test is broken, not unlucky).
 */
export const MAX_SILENT_HEALTH_FAILURES = 3

/** One health-test failure of a monitored source. */
export interface HealthEvent {
  /** Provider name. */
  readonly source: string
  /** Health-test failures so far (this one included). */
  readonly failures: number
  /** `true` when the session is restarted; `false` when this failure ends the stream. */
  readonly restarted: boolean
  /** The `EntropyError` with code `health_test` the session ended with. */
  readonly error: EntropyError
}

/** The `health_test` `EntropyError` in `error` or its cause chain, if any. */
export function healthTestError(error: unknown): EntropyError | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof EntropyError && current.code === 'health_test') return current
    current = current.cause
  }
  return undefined
}

/**
 * Wrap a provider so each `stream()` survives health-test failures: when a
 * session ends with `EntropyError('health_test')` (entropy has already
 * retried inside the session per its `maxHealthFailures`), `onEvent` is
 * called and a fresh session is opened — which reruns the start-up test. The
 * failure becomes final (rethrown, after an event with `restarted: false`)
 * once {@link MAX_SILENT_HEALTH_FAILURES} sessions in a row failed without
 * yielding a byte. Other errors, and anything after the caller's signal
 * aborted, propagate unchanged. `onEvent` must not throw; if it does, the
 * error is ignored.
 */
export function healthMonitored(
  provider: ByteProvider,
  onEvent: (event: HealthEvent) => void,
): ByteProvider {
  return {
    name: provider.name,
    async *stream(opts) {
      let failures = 0
      let silent = 0
      while (true) {
        let yielded = false
        try {
          for await (const chunk of provider.stream(opts)) {
            yielded = true
            silent = 0
            yield chunk
          }
          return
        } catch (error) {
          const health = healthTestError(error)
          if (health === undefined || opts?.signal?.aborted) throw error
          failures++
          if (!yielded) silent++
          const restarted = silent < MAX_SILENT_HEALTH_FAILURES
          try {
            onEvent({ source: provider.name, failures, restarted, error: health })
          } catch {
            // a reporting hook must never change the stream's fate
          }
          if (!restarted) throw error
        }
      }
    },
  }
}

/** Status text for a monitored source: the failure count and the latest reason. */
export function healthNote(event?: HealthEvent): string {
  if (event === undefined) return 'SP 800-90B health tests: no failures'
  const outcome = event.restarted ? 'session restarted' : 'giving up'
  const plural = event.failures === 1 ? '' : 's'
  return `health_test: ${event.failures} failure${plural}, ${outcome} — ${event.error.message}`
}
