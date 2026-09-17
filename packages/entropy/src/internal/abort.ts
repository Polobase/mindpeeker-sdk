/**
 * Settle with `promise`, or reject with the signal's reason as soon as
 * `signal` fires — also when `promise` itself ignores the signal. Used to let
 * one caller walk away from shared or uncancellable work (a deduplicated
 * token exchange, a cached certificate fetch) without affecting others.
 */
export function raceSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    promise.catch(() => {}) // the abandoned work may still fail later
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
