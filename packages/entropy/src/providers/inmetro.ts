import { type NistFamilyOptions, nistPulseBeacon } from '../internal/nist-pulse.js'
import type { EntropyProvider } from '../types.js'

export type InmetroVariant = 'primary' | 'combination'

export interface InmetroOptions extends NistFamilyOptions {
  /**
   * 'primary' (default): Inmetro's own quantum-optical beacon, 60 s pulses.
   * 'combination': CONCAT+VDF combination of UChile, RANDOM.ORG and NIST
   * seeds, one pulse every 10 minutes.
   */
  variant?: InmetroVariant
}

/**
 * Inmetro Brazilian randomness beacon (national metrology institute) —
 * NIST IR 8213 format. PUBLIC randomness.
 */
export function inmetro(opts: InmetroOptions = {}): EntropyProvider {
  const { variant = 'primary', ...rest } = opts
  if (variant === 'combination') {
    return nistPulseBeacon(
      {
        info: Object.freeze({ name: 'inmetro(combination)', kind: 'beacon', privacy: 'public' }),
        defaultBaseUrl: 'https://beacon.inmetro.gov.br/combination/beacon/2.0',
        // quirk: latest has NO /pulse segment, but by-index DOES
        latestPath: '/last',
        pulsePath: (_chain, i) => `/pulse/${i}`,
        defaultPollIntervalMs: 600_000,
      },
      rest,
    )
  }
  return nistPulseBeacon(
    {
      info: Object.freeze({ name: 'inmetro', kind: 'beacon', privacy: 'public' }),
      defaultBaseUrl: 'https://beacon.inmetro.gov.br/beacon/2.1',
      latestPath: '/pulse/last',
      defaultPollIntervalMs: 60_000,
    },
    rest,
  )
}
