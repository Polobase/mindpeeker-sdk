import { defineProvider } from '../internal/provider.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

// crypto.getRandomValues throws QuotaExceededError above 65536 bytes per call.
const MAX_PER_CALL = 65_536

const INFO: EntropySourceInfo = Object.freeze({
  name: 'crypto',
  kind: 'csprng',
  privacy: 'private',
})

/**
 * The runtime's cryptographic PRNG. Always available, never rate limited —
 * the natural last link of any fallback chain and the standard private mixin
 * for `xorMix` with public beacons.
 */
export function cryptoProvider(): EntropyProvider {
  return defineProvider({
    ...INFO,
    async getBytes(length) {
      const bytes = new Uint8Array(length)
      for (let offset = 0; offset < length; offset += MAX_PER_CALL) {
        globalThis.crypto.getRandomValues(
          bytes.subarray(offset, Math.min(offset + MAX_PER_CALL, length)),
        )
      }
      return { bytes, sources: [INFO] }
    },
  })
}
