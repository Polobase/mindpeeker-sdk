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

/**
 * Start ALL members simultaneously; the first fulfillment wins and the losers
 * are cancelled via AbortSignal. Attribution reports only the winner.
 */
export function race(providers: EntropyProvider[]): EntropyProvider {
  requireProviders(providers, 'race')
  const members = [...providers]
  const name = compositeName('race', members)

  return defineProvider({
    name,
    kind: commonKind(members),
    privacy: pessimisticPrivacy(members),

    async getBytes(length, reqOpts) {
      const controller = new AbortController()
      const signal = reqOpts?.signal
        ? AbortSignal.any([reqOpts.signal, controller.signal])
        : controller.signal

      const tasks = members.map((member) =>
        member.getBytes(length, { signal, timeoutMs: reqOpts?.timeoutMs }).catch((error) => {
          throw toEntropyError(error, member.name)
        }),
      )
      try {
        return await Promise.any(tasks)
      } catch (error) {
        if (reqOpts?.signal?.aborted) throw abortedError(name)
        throw new EntropyError(
          'insufficient_entropy',
          `all ${members.length} providers failed in ${name}`,
          {
            provider: name,
            cause: error,
          },
        )
      } finally {
        controller.abort() // cancel the losers (no-op if everything settled)
      }
    },
  })
}
