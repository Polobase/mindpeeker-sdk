// Core of @mindpeeker/entropy: types, errors, combining strategies and the
// custom-provider building blocks. The providers themselves live behind
// '@mindpeeker/entropy/providers'; Node-only adapters behind
// '@mindpeeker/entropy/node'.

export type { EntropyErrorCode, EntropyErrorOptions } from './errors.js'
export { EntropyError } from './errors.js'
// Building blocks for custom providers
export type { ByteSource } from './internal/byte-source.js'
export type { ConditioningMode, ConditioningOptions } from './internal/condition.js'
export type { NistFamilyOptions } from './internal/nist-pulse.js'
export type { ProviderSpec } from './internal/provider.js'
export { defineProvider } from './internal/provider.js'
// Combining strategies (composable — strategies are providers themselves)
export type { FallbackOptions } from './strategies/fallback.js'
export { fallback } from './strategies/fallback.js'
export { race } from './strategies/race.js'
export { xorMix } from './strategies/xor.js'
export type {
  EntropyKind,
  EntropyPrivacy,
  EntropyProvider,
  EntropyRequestOptions,
  EntropyResult,
  EntropySourceInfo,
  EntropyStreamOptions,
} from './types.js'
