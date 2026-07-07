import { defineProvider } from '../../src/internal/provider.js'
import type { EntropyKind, EntropyPrivacy, EntropyProvider } from '../../src/types.js'

export interface StubOptions {
  name?: string
  kind?: EntropyKind
  privacy?: EntropyPrivacy
  /** Fill byte for returned entropy. */
  byte?: number
  /** Resolve after this many ms. */
  delayMs?: number
  /** Reject every call with this error. */
  fail?: Error
  /** Never settle until aborted. */
  hang?: boolean
}

export interface Stub {
  provider: EntropyProvider
  calls: number[]
  /** Signals observed per call, for asserting loser cancellation. */
  signals: AbortSignal[]
}

/** A configurable, defineProvider-backed stub with call/signal recording. */
export function stub(opts: StubOptions = {}): Stub {
  const { name = 'stub', kind = 'csprng', privacy = 'private', byte = 1 } = opts
  const calls: number[] = []
  const signals: AbortSignal[] = []
  const info = { name, kind, privacy } as const

  const provider = defineProvider({
    ...info,
    getBytes(length, reqOpts) {
      calls.push(length)
      if (reqOpts?.signal) signals.push(reqOpts.signal)
      return new Promise((resolve, reject) => {
        const abort = () => reject(reqOpts?.signal?.reason)
        if (reqOpts?.signal?.aborted) return abort()
        reqOpts?.signal?.addEventListener('abort', abort, { once: true })
        if (opts.hang) return
        const settle = () => {
          if (opts.fail) reject(opts.fail)
          else resolve({ bytes: new Uint8Array(length).fill(byte), sources: [info] })
        }
        if (opts.delayMs) setTimeout(settle, opts.delayMs)
        else settle()
      })
    },
  })

  return { provider, calls, signals }
}
