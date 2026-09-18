// Public beacons: latest values with their round metadata, historical
// round lookup, and what each opt-in `verify` mode actually establishes.
// CLIENT-ONLY (it imports @mindpeeker/entropy/providers).

import type { BeaconProvider, BeaconRound } from '@mindpeeker/entropy'
import {
  curby,
  DRAND_CHAINS,
  DRAND_SIGNATURE_BYTES,
  drand,
  drandRoundAt,
  drandRoundTime,
  nistBeacon,
  nqsn,
} from '@mindpeeker/entropy/providers'
import { toHex } from '~/lib/format'

export const CHAIN = DRAND_CHAINS.quicknet

export interface ChainRow {
  readonly beaconId: string
  readonly hash: string
  readonly genesisTime: number
  readonly period: number
  readonly scheme: string
  readonly signatureBytes?: number
}

/** The pinned League of Entropy chains, with each scheme's signature size. */
export const CHAIN_ROWS: readonly ChainRow[] = Object.values(DRAND_CHAINS).map((info) => ({
  ...info,
  ...(DRAND_SIGNATURE_BYTES[info.scheme] !== undefined
    ? { signatureBytes: DRAND_SIGNATURE_BYTES[info.scheme] as number }
    : {}),
}))

export interface ClockReading {
  /** Round being published right now, by the local clock. */
  readonly round: number
  /** Publication time of that round, in ms since the epoch. */
  readonly publishedMs: number
  /** Publication time of the next round. */
  readonly nextMs: number
}

/** drandRoundAt / drandRoundTime as a live clock — plain arithmetic, no I/O. */
export function clockNow(nowMs = Date.now()): ClockReading {
  const round = drandRoundAt(nowMs, CHAIN)
  return {
    round,
    publishedMs: drandRoundTime(round, CHAIN),
    nextMs: drandRoundTime(round + 1, CHAIN),
  }
}

export type BeaconId = 'drand' | 'curby' | 'nist-hash' | 'nist-verify' | 'nqsn'

export interface BeaconDraw {
  readonly id: BeaconId
  readonly title: string
  readonly bytes: number
  readonly note: string
  readonly expect: string
  readonly code: string
  readonly make: () => BeaconProvider
}

export const BEACON_DRAWS: readonly BeaconDraw[] = [
  {
    id: 'drand',
    title: 'drand — latest round',
    bytes: 32,
    note: "verify: 'structural' pins the chain (hash, genesis, period, scheme), checks the signature length and the round clock, and recomputes randomness = SHA-256(signature).",
    expect: 'one round, timestamp within a few seconds of the live round clock',
    code: `import { drand } from '@mindpeeker/entropy/providers'

const beacon = drand({ verify: 'structural' })
const { bytes, sources } = await beacon.getBytes(32)
const [round] = sources[0]?.rounds ?? []  // { round, timestamp, signature }`,
    make: () => drand({ verify: 'structural' }),
  },
  {
    id: 'curby',
    title: 'CURBy — latest pulse',
    bytes: 64,
    note: 'CURBy (CU Boulder + NIST) publishes 64-byte sha3-512 CID digests on a Twine chain, with a built-in freshness guard. The JWS signature is not verified here.',
    expect: 'one pulse index, a recent timestamp and a compact JWS',
    code: `import { curby } from '@mindpeeker/entropy/providers'

const { bytes, sources } = await curby().getBytes(64) // one 64-byte digest`,
    make: () => curby(),
  },
  {
    id: 'nist-hash',
    title: "NIST — verify: 'hash'",
    bytes: 64,
    note: 'Recomputes outputValue = SHA-512(fields ‖ signature) and checks the chain linkage of consecutive pulses (previous value, precommitment).',
    expect: 'passes: 64 bytes and a pulse index',
    code: `import { nistBeacon } from '@mindpeeker/entropy/providers'

const linked = nistBeacon({ verify: 'hash' })
const { bytes, sources } = await linked.getBytes(64)`,
    make: () => nistBeacon({ verify: 'hash' }),
  },
  {
    id: 'nist-verify',
    title: 'NIST — verify: true',
    bytes: 64,
    note: 'Adds certificateId = SHA-512(certificate) and the RSA PKCS#1 v1.5 / SHA-512 signature check over WebCrypto.',
    expect: "fails with EntropyError('verification') — see the note below",
    code: `const audited = nistBeacon({ verify: true })
await audited.getBytes(64)
// EntropyError('verification'): the signature does not match the named certificate`,
    make: () => nistBeacon({ verify: true }),
  },
  {
    id: 'nqsn',
    title: 'NQSN — verify: true',
    bytes: 64,
    note: 'The same IR 8213 checks against Singapore’s National Quantum-Safe Network beacon, where the full chain passes live.',
    expect: 'passes: output hash, certificate id, RSA signature and linkage',
    code: `import { nqsn } from '@mindpeeker/entropy/providers'

const audited = nqsn({ verify: true })
const { bytes, sources } = await audited.getBytes(64)`,
    make: () => nqsn({ verify: true }),
  },
]

export interface BeaconOutcome {
  readonly id: BeaconId
  readonly providerName: string
  readonly privacy: string
  readonly hex: string
  readonly ms: number
  readonly rounds: readonly BeaconRound[]
  /** For drand: the round the local clock says is current right now. */
  readonly clockRound?: number
}

export async function drawBeacon(
  draw: BeaconDraw,
  signal?: AbortSignal,
): Promise<BeaconOutcome> {
  const provider = draw.make()
  const started = performance.now()
  const result = await provider.getBytes(draw.bytes, { signal, timeoutMs: 20_000 })
  const ms = performance.now() - started
  return {
    id: draw.id,
    providerName: provider.name,
    privacy: provider.privacy,
    hex: toHex(result.bytes, { sep: ' ', max: 32 }),
    ms,
    rounds: result.sources.flatMap((s) => s.rounds ?? []),
    ...(draw.id === 'drand' ? { clockRound: clockNow().round } : {}),
  }
}

export interface RoundLookup {
  readonly requested: number
  readonly round: BeaconRound
  readonly hex: string
  readonly ms: number
  readonly matches: boolean
  readonly publishedMs: number
}

/** `getRound(n)` on drand: every historical fetch must answer the round asked for. */
export async function lookupDrandRound(
  round: number,
  signal?: AbortSignal,
): Promise<RoundLookup> {
  const beacon = drand({ verify: 'structural' })
  const started = performance.now()
  const result = await beacon.getRound(round, { signal, timeoutMs: 20_000 })
  return {
    requested: round,
    round: result.round,
    hex: toHex(result.bytes, { sep: ' ' }),
    ms: performance.now() - started,
    matches: result.round.round === round,
    publishedMs: drandRoundTime(round, CHAIN),
  }
}

export const NIST_EXPLANATION = `Since pulse 2/1925734 (2026-09-03T21:08Z) every NIST pulse carries a 512-byte (4096-bit) signature while naming a 2048-bit certificate, so the RSA check cannot succeed. The failure is NIST-side and correct behaviour here: verify: true refuses rather than pretending. verify: 'hash' still checks the output hash and the chain linkage, and NQSN's equivalent pulses verify end to end.`

export const ROUND_SNIPPET = `import { DRAND_CHAINS, drand, drandRoundAt, drandRoundTime } from '@mindpeeker/entropy/providers'

const chain = DRAND_CHAINS.quicknet                    // 3 s rounds since 1692803367
const round = drandRoundAt(Date.now(), chain)          // ⌊(t − genesis)/period⌋ + 1
drandRoundTime(round, chain)                           // (genesis + 3(r − 1)) · 1000

const replay = await drand().getRound(round - 1)       // anyone can re-fetch it
// a proxy answering with a different round throws EntropyError('bad_response')`
