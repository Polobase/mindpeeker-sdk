import { EntropyError } from '../errors.js'
import {
  abortedError,
  commonKind,
  compositeName,
  pessimisticPrivacy,
  requireProviders,
  toEntropyError,
} from '../internal/composite.js'
import { defineProvider } from '../internal/provider.js'
import type { EntropyProvider } from '../types.js'

export interface FallbackOptions {
  /** Budget per member attempt before moving to the next. Default 10_000. */
  attemptTimeoutMs?: number
}

/**
 * Try providers strictly in array order; the first success wins. An attempt
 * that fails or exceeds `attemptTimeoutMs` moves the chain along; a caller
 * abort stops the chain immediately. Attribution reports the winner's sources.
 */
export function fallback(
  providers: EntropyProvider[],
  opts: FallbackOptions = {},
): EntropyProvider {
  requireProviders(providers, 'fallback')
  const members = [...providers]
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? 10_000
  const name = compositeName('fallback', members)

  return defineProvider({
    name,
    kind: commonKind(members),
    privacy: pessimisticPrivacy(members),
    // Leave room for every member to use its full attempt budget by default.
    defaultTimeoutMs: attemptTimeoutMs * members.length + 1000,

    async getBytes(length, reqOpts) {
      const errors: EntropyError[] = []
      for (const member of members) {
        if (reqOpts?.signal?.aborted) throw abortedError(name)
        try {
          return await member.getBytes(length, {
            signal: reqOpts?.signal,
            timeoutMs: attemptTimeoutMs,
          })
        } catch (error) {
          const entropyError = toEntropyError(error, member.name)
          if (entropyError.code === 'aborted') throw entropyError
          errors.push(entropyError)
        }
      }
      throw new EntropyError('insufficient_entropy', `all ${members.length} providers failed`, {
        provider: name,
        cause: new AggregateError(errors, `all providers in ${name} failed`),
      })
    },
  })
}
