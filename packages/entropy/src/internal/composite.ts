import { EntropyError } from '../errors.js'
import type { EntropyKind, EntropyPrivacy, EntropyProvider } from '../types.js'

export function requireProviders(providers: readonly EntropyProvider[], strategy: string): void {
  if (providers.length === 0) {
    throw new TypeError(`${strategy} requires at least one provider`)
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

export function toEntropyError(error: unknown, provider: string): EntropyError {
  if (error instanceof EntropyError) return error
  return new EntropyError('network', `unexpected provider error: ${String(error)}`, {
    provider,
    cause: error,
  })
}

export function abortedError(provider: string): EntropyError {
  return new EntropyError('aborted', 'request aborted', { provider })
}
