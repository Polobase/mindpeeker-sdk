// Core types & errors

export type { EntropyErrorCode, EntropyErrorOptions } from './errors.js'
export { EntropyError } from './errors.js'
export type { ProviderSpec } from './internal/provider.js'

// Building block for custom providers
export { defineProvider } from './internal/provider.js'
export type { AnuOptions } from './providers/anu.js'
export { anu } from './providers/anu.js'
export type { AnuLegacyOptions } from './providers/anu-legacy.js'
export { anuLegacy } from './providers/anu-legacy.js'
// Providers
export { cryptoProvider } from './providers/crypto.js'
export type { DrandOptions } from './providers/drand.js'
export { drand } from './providers/drand.js'
export type { LfdrOptions } from './providers/lfdr.js'
export { lfdr } from './providers/lfdr.js'
export type { NistBeaconOptions } from './providers/nist-beacon.js'
export { nistBeacon } from './providers/nist-beacon.js'
export type { OutshiftOptions } from './providers/outshift.js'
export { outshift } from './providers/outshift.js'
export type { QciOptions } from './providers/qci.js'
export { qci } from './providers/qci.js'
export type { QrandomIoOptions } from './providers/qrandom.js'
export { qrandomIo } from './providers/qrandom.js'
export type { RandomOrgOptions } from './providers/random-org.js'
export { randomOrg } from './providers/random-org.js'
export type {
  SuperRandOptions,
  WebSocketConstructor,
  WebSocketLike,
} from './providers/superrand.js'
export { superRand } from './providers/superrand.js'
export type { FallbackOptions } from './strategies/fallback.js'
// Combining strategies (composable — strategies are providers themselves)
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
