import { type NistFamilyOptions, nistPulseBeacon } from '../internal/nist-pulse.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'uchile',
  kind: 'beacon',
  privacy: 'public',
})

export interface UchileOptions extends NistFamilyOptions {}

/**
 * Random UChile (CLCERT, Universidad de Chile) — hybrid beacon mixing a local
 * quantum device with seismic, radio and other public inputs; 512 bits every
 * 60 seconds. PUBLIC randomness.
 */
export function uchile(opts: UchileOptions = {}): EntropyProvider {
  return nistPulseBeacon(
    {
      info: INFO,
      defaultBaseUrl: 'https://random.uchile.cl/beacon/2.1-beta',
      // NB: their '/pulse/last' route is a genuine 404 — the query form is
      // the working "latest" endpoint.
      latestPath: '/pulse?chainId=last&pulseId=last',
      defaultPollIntervalMs: 60_000,
    },
    opts,
  )
}
