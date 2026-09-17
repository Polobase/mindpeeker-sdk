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
 * Requests shorter than this skip the identical-results check: two
 * independent uniform members collide on n bytes with probability 2⁻⁸ⁿ, so a
 * 1-byte request would fail 1 time in 256. From 8 bytes on a false alarm has
 * probability ≤ C(m,2)·2⁻⁶⁴.
 */
const IDENTITY_CHECK_MIN_BYTES = 8

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function identicalPair(outputs: readonly Uint8Array[]): [number, number] | null {
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      if (sameBytes(outputs[i] as Uint8Array, outputs[j] as Uint8Array)) return [i, j]
    }
  }
  return null
}

/**
 * Fetch from ALL members in parallel and XOR the results — the output is as
 * strong as the strongest independent input. Fails closed: any member failure
 * fails the whole call (compose inside `fallback` if you want degradation).
 * Two members returning byte-identical results (the same beacon or mirror fed
 * in twice would XOR to zeros) fail with `bad_response`; the check applies to
 * requests of 8 bytes or more. Attribution lists every member's sources.
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
      if (length >= IDENTITY_CHECK_MIN_BYTES) {
        const twin = identicalPair(results.map((r) => r.bytes))
        if (twin) {
          const [i, j] = twin
          throw new EntropyError(
            'bad_response',
            `members ${members[i]?.name} and ${members[j]?.name} returned byte-identical results — XOR would cancel them (same upstream fed in twice?)`,
            { provider: name },
          )
        }
      }
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
