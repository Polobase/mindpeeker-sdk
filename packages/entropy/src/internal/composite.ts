import { EntropyError } from '../errors.js'
import type { EntropyKind, EntropyPrivacy, EntropyProvider } from '../types.js'

/** Strategies need at least one member; throws `invalid_request` otherwise. */
export function requireProviders(providers: readonly EntropyProvider[], strategy: string): void {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new EntropyError('invalid_request', `${strategy} requires at least one provider`, {
      provider: strategy,
    })
  }
  for (const [i, member] of providers.entries()) {
    if (typeof member?.getBytes !== 'function' || typeof member.stream !== 'function') {
      throw new EntropyError(
        'invalid_request',
        `${strategy}: member ${i} is not an EntropyProvider`,
        { provider: strategy },
      )
    }
  }
}

export function compositeName(strategy: string, providers: readonly EntropyProvider[]): string {
  return `${strategy}(${providers.map((p) => p.name).join(',')})`
}

export function commonKind(providers: readonly EntropyProvider[]): EntropyKind {
  const first = providers[0]?.kind ?? 'mixed'
  return providers.every((p) => p.kind === first) ? first : 'mixed'
}

/** For fallback/race: any member might serve, so one public member taints the whole. */
export function pessimisticPrivacy(providers: readonly EntropyProvider[]): EntropyPrivacy {
  return providers.every((p) => p.privacy === 'private') ? 'private' : 'public'
}

/**
 * For xorMix: XOR with at least one independent private input yields a private
 * output — public beacons mixed in add auditability without exposing the result.
 */
export function anyPrivatePrivacy(providers: readonly EntropyProvider[]): EntropyPrivacy {
  return providers.some((p) => p.privacy === 'private') ? 'private' : 'public'
}

/** Pass an `EntropyError` through; wrap anything else as `network` with the original as `cause`. */
export function toEntropyError(error: unknown, provider: string): EntropyError {
  if (error instanceof EntropyError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new EntropyError('network', `unexpected provider error: ${message}`, {
    provider,
    cause: error,
  })
}

export function abortedError(provider: string): EntropyError {
  return new EntropyError('aborted', 'request aborted', { provider })
}
