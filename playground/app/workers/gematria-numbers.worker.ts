// numberProperties() off the main thread.
//
// The factorization is one trial-division sweep over 2, 3 and 6k ± 1, so a
// 15-digit prime costs ~5.6 million divisions — comfortably under a second, but
// far too long to block a keystroke. A worker may import `@mindpeeker/*`
// directly (the Vite alias and the js-to-ts plugin are applied to the worker
// build), so the real function runs here, not a re-implementation.

import type { NumberProperties } from '@mindpeeker/gematria'
import { numberProperties } from '@mindpeeker/gematria'

export interface NumbersRequest {
  readonly id: number
  readonly n: number
}

export interface NumbersResponse {
  readonly id: number
  readonly result?: NumberProperties
  readonly error?: { readonly name: string; readonly code?: string; readonly message: string }
  /** Milliseconds the sweep took, so the UI can say what it cost. */
  readonly ms: number
}

const post = (message: NumbersResponse): void => {
  ;(self as unknown as Worker).postMessage(message)
}

self.onmessage = (event: MessageEvent<NumbersRequest>): void => {
  const { id, n } = event.data
  const started = performance.now()
  try {
    post({ id, result: numberProperties(n), ms: performance.now() - started })
  } catch (error) {
    const record = error as { name?: string; code?: string; message?: string }
    post({
      id,
      error: {
        name: record.name ?? 'Error',
        ...(record.code ? { code: record.code } : {}),
        message: record.message ?? String(error),
      },
      ms: performance.now() - started,
    })
  }
}
