import { EntropyError } from '../errors.js'
import { xorBytes } from '../internal/bytes.js'
import {
  abortedError,
  anyPrivatePrivacy,
  commonKind,
  compositeName,
  requireProviders,
  toEntropyError,
} from '../internal/composite.js'
import { defineProvider } from '../internal/provider.js'
import type { EntropyProvider, EntropyResult } from '../types.js'

/**
 * Fetch from ALL members in parallel and XOR the results — the output is as
 * strong as the strongest independent input. Fails closed: any member failure
 * fails the whole call (compose inside `fallback` if you want degradation).
 * Attribution lists every member's sources.
 */
export function xorMix(providers: EntropyProvider[]): EntropyProvider {
  requireProviders(providers, 'xor')
  const members = [...providers]
  const name = compositeName('xor', members)

  return defineProvider({
    name,
    kind: commonKind(members),
    privacy: anyPrivatePrivacy(members),

    async getBytes(length, reqOpts) {
      const controller = new AbortController()
      const signal = reqOpts?.signal
        ? AbortSignal.any([reqOpts.signal, controller.signal])
        : controller.signal

      const tasks = members.map((member) =>
        member.getBytes(length, { signal, timeoutMs: reqOpts?.timeoutMs }).catch((error) => {
          controller.abort() // fail fast: stop the remaining in-flight requests
          throw toEntropyError(error, member.name)
        }),
      )
      const settled = await Promise.allSettled(tasks)

      const failures = settled
        .filter((s): s is PromiseRejectedResult => s.status === 'rejected')
        .map((s) => toEntropyError(s.reason, name))
      if (failures.length > 0) {
        if (reqOpts?.signal?.aborted) throw abortedError(name)
        const primary = failures.filter((f) => f.code !== 'aborted')
        throw new EntropyError(
          'insufficient_entropy',
          `${failures.length}/${members.length} providers failed in ${name}`,
          {
            provider: name,
            cause: new AggregateError(primary.length > 0 ? primary : failures),
          },
        )
      }

      const results = settled.map((s) => (s as PromiseFulfilledResult<EntropyResult>).value)
      let bytes: Uint8Array
      try {
        bytes = xorBytes(results.map((r) => r.bytes))
      } catch (error) {
        throw new EntropyError('bad_response', 'a member returned the wrong byte count', {
          provider: name,
          cause: error,
        })
      }
      return { bytes, sources: results.flatMap((r) => [...r.sources]) }
    },
  })
}
