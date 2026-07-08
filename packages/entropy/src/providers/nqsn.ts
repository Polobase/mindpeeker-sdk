import { type NistFamilyOptions, nistPulseBeacon } from '../internal/nist-pulse.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({ name: 'nqsn', kind: 'beacon', privacy: 'public' })

export interface NqsnOptions extends NistFamilyOptions {}

/**
 * NQSN Singapore quantum randomness beacon (National Quantum-Safe Network) —
 * NIST IR 8213 format, 512 bits every 60 seconds. PUBLIC randomness.
 * The latest-pulse route answers with a 303 redirect that fetch follows.
 */
export function nqsn(opts: NqsnOptions = {}): EntropyProvider {
  return nistPulseBeacon(
    {
      info: INFO,
      defaultBaseUrl: 'https://quantum-entropy.sg/beacon/2.0',
      latestPath: '/pulse',
      defaultPollIntervalMs: 60_000,
    },
    opts,
  )
}
