// Live 32-byte draws from the browser-safe, keyless factories in the
// catalogue. CLIENT-ONLY: it imports @mindpeeker/entropy/providers.

import type { BeaconRound, EntropyProvider, EntropySourceAttribution } from '@mindpeeker/entropy'
import {
  cryptoProvider,
  curby,
  drand,
  jitterEntropy,
  nistBeacon,
  nqsn,
  uchile,
} from '@mindpeeker/entropy/providers'
import { toHex } from '~/lib/format'
import type { TryId } from './catalogue'

export interface TrySpec {
  /** The exact code the button runs. */
  readonly code: string
  readonly bytes: number
  readonly timeoutMs: number
  readonly make: () => EntropyProvider
  /** Why this call is shaped the way it is. */
  readonly why?: string
}

export const TRY_SPECS: Record<TryId, TrySpec> = {
  crypto: {
    code: `import { cryptoProvider } from '@mindpeeker/entropy/providers'

const { bytes, sources } = await cryptoProvider().getBytes(32)`,
    bytes: 32,
    timeoutMs: 5_000,
    make: () => cryptoProvider(),
  },
  jitter: {
    code: `import { jitterEntropy } from '@mindpeeker/entropy/providers'

// Browsers only offer a coarse clock, so jitter must be opted into and is
// named jitter(coarse). 'raw' passes health-tested samples through instead of
// pooling 51,200 of them for one conditioned 32-byte block (~26 s here).
const jitter = jitterEntropy({ allowCoarseClock: true, conditioning: 'raw' })
const { bytes, sources } = await jitter.getBytes(32, { timeoutMs: 20_000 })`,
    bytes: 32,
    timeoutMs: 20_000,
    make: () => jitterEntropy({ allowCoarseClock: true, conditioning: 'raw' }),
    why: 'raw mode: a conditioned block would pool 51,200 coarse samples (~26 s).',
  },
  drand: {
    code: `import { drand } from '@mindpeeker/entropy/providers'

const { bytes, sources } = await drand({ verify: 'structural' }).getBytes(32)
const [round] = sources[0]?.rounds ?? []`,
    bytes: 32,
    timeoutMs: 12_000,
    make: () => drand({ verify: 'structural' }),
  },
  curby: {
    code: `import { curby } from '@mindpeeker/entropy/providers'

const { bytes, sources } = await curby().getBytes(32)`,
    bytes: 32,
    timeoutMs: 15_000,
    make: () => curby(),
  },
  nist: {
    code: `import { nistBeacon } from '@mindpeeker/entropy/providers'

// 'hash' checks outputValue and chain linkage; verify: true additionally
// checks the RSA signature, which fails on current pulses (see Beacons).
const { bytes, sources } = await nistBeacon({ verify: 'hash' }).getBytes(32)`,
    bytes: 32,
    timeoutMs: 15_000,
    make: () => nistBeacon({ verify: 'hash' }),
  },
  nqsn: {
    code: `import { nqsn } from '@mindpeeker/entropy/providers'

const { bytes, sources } = await nqsn({ verify: true }).getBytes(32)`,
    bytes: 32,
    timeoutMs: 15_000,
    make: () => nqsn({ verify: true }),
  },
  uchile: {
    code: `import { uchile } from '@mindpeeker/entropy/providers'

// No verify option: UChile publishes cipherSuite 1 pulses.
const { bytes, sources } = await uchile().getBytes(32)`,
    bytes: 32,
    timeoutMs: 15_000,
    make: () => uchile(),
  },
}

export interface TryOutcome {
  readonly id: TryId
  readonly providerName: string
  readonly kind: string
  readonly privacy: string
  readonly hex: string
  readonly ms: number
  readonly sources: readonly EntropySourceAttribution[]
  readonly rounds: readonly BeaconRound[]
}

/** Draw 32 bytes from one catalogue row. Typed SDK errors are thrown as-is. */
export async function tryProvider(id: TryId, signal?: AbortSignal): Promise<TryOutcome> {
  const spec = TRY_SPECS[id]
  const provider = spec.make()
  const started = performance.now()
  const result = await provider.getBytes(spec.bytes, { signal, timeoutMs: spec.timeoutMs })
  const ms = performance.now() - started
  return {
    id,
    providerName: provider.name,
    kind: provider.kind,
    privacy: provider.privacy,
    hex: toHex(result.bytes, { sep: ' ' }),
    ms,
    sources: result.sources,
    rounds: result.sources.flatMap((s) => s.rounds ?? []),
  }
}
