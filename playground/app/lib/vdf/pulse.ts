// Pulses for the seal section.
//
// A seal consumes pulse BYTES, not provider objects — `@mindpeeker/vdf` and
// `@mindpeeker/entropy` share no imports. Three pulses are offered so the
// section works offline, on a plane, and with whatever the header picker says:
//
//   drand-live   the latest League of Entropy round, with its round metadata
//   drand-taped  a recorded quicknet round, served to the same provider through
//                a replaced `fetch` — the provider's structural checks still run
//   selected     32 bytes from the source chosen in the header
//
// CLIENT-ONLY: imports @mindpeeker/entropy.

import { DRAND_CHAINS, drand } from '@mindpeeker/entropy/providers'
import { getBytes, sourceSummary } from '~/lib/entropy'

export type PulseId = 'drand-live' | 'drand-taped' | 'selected'

export interface PulseMeta {
  readonly id: PulseId
  readonly label: string
  readonly note: string
}

export const PULSE_OPTIONS: readonly PulseMeta[] = [
  {
    id: 'drand-live',
    label: 'drand quicknet — latest round',
    note: "verify: 'structural' pins the chain, checks the signature length and the round clock, and recomputes randomness = SHA-256(signature). The BLS signature itself is not checked.",
  },
  {
    id: 'drand-taped',
    label: 'drand quicknet — recorded round 32285086',
    note: 'A response captured on 2026-09-17T15:23:55Z and replayed through the same provider: offline, reproducible, and honestly labelled as a recording.',
  },
  {
    id: 'selected',
    label: 'the source selected in the header',
    note: 'Any 32 bytes can be sealed. A seal says nothing about where they came from — if the pulse was predictable, the seal only delays its consumption.',
  },
]

/**
 * A drand quicknet round captured from https://api.drand.sh on
 * 2026-09-17T15:23:55Z (round 32285086 also fetched from api2.drand.sh,
 * byte-identical). Same recording the cookbook's offline runs use.
 */
const RECORDED = Object.freeze({
  capturedAt: '2026-09-17T15:23:55Z',
  info: {
    public_key:
      '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
    period: 3,
    genesis_time: 1692803367,
    genesis_seed: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',
    chain_hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
    scheme: 'bls-unchained-g1-rfc9380',
    beacon_id: 'quicknet',
  },
  latest: 32285086,
  rounds: [
    {
      round: 32285085,
      signature:
        '81dbce51d584d90d618547f4b50391d53ace6f6b9aeb8fb67e1879427af9d0310ac0ec6f519271d9a313ee84b378d416',
    },
    {
      round: 32285086,
      signature:
        'a64d99fd7fa3e48912be7209c7b69c72c88fc5224be2516949b6f29f3a4b7e3fa069dd58b2bbb4bf2c34ae61ef631a44',
    },
  ],
})

export const RECORDED_ROUND = RECORDED.latest
export const RECORDED_CAPTURED_AT = RECORDED.capturedAt
export const QUICKNET_CHAIN = DRAND_CHAINS.quicknet

/** A `fetch` that answers drand's v2 routes from the recording. */
function recordedFetch(): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    const round = /\/v2\/beacons\/quicknet\/rounds\/(latest|\d+)$/.exec(path)?.[1]
    const wanted = round === 'latest' ? RECORDED.latest : Number(round)
    const body = path.endsWith('/v2/beacons/quicknet/info')
      ? RECORDED.info
      : RECORDED.rounds.find((r) => r.round === wanted)
    if (!body) return new Response('not recorded', { status: 404 })
    return Response.json({ ...body })
  }
  return impl as typeof fetch
}

export interface Pulse {
  readonly id: PulseId
  readonly bytes: Uint8Array
  readonly providerName: string
  /** Round number, when the pulse came from a beacon. */
  readonly round?: number
  readonly timestamp?: number
  readonly signature?: string
  /** Set when a live fetch failed and the recording answered instead. */
  readonly fellBack: boolean
  readonly reason?: string
}

async function fromDrand(live: boolean, signal?: AbortSignal): Promise<Pulse> {
  const beacon = live
    ? drand({ verify: 'structural' })
    : drand({ verify: 'structural', fetch: recordedFetch() })
  const draw = await beacon.getBytes(32, signal ? { signal } : {})
  const source = draw.sources[0]
  const round = source?.rounds?.[0]
  return {
    id: live ? 'drand-live' : 'drand-taped',
    bytes: draw.bytes,
    providerName: source?.name ?? beacon.name,
    ...(round?.round !== undefined ? { round: round.round } : {}),
    ...(round?.timestamp !== undefined ? { timestamp: round.timestamp } : {}),
    ...(round?.signature !== undefined ? { signature: round.signature } : {}),
    fellBack: false,
  }
}

/**
 * Fetch the chosen pulse. A live drand fetch that fails falls back to the
 * recording and says so — a demo that silently swaps its data source would be
 * exactly the kind of quiet substitution this SDK is against.
 */
export async function fetchPulse(id: PulseId, signal?: AbortSignal): Promise<Pulse> {
  if (id === 'selected') {
    const bytes = await getBytes(32, signal ? { signal } : {})
    return { id, bytes, providerName: sourceSummary().providerName, fellBack: false }
  }
  if (id === 'drand-taped') return fromDrand(false, signal)
  try {
    return await fromDrand(true, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    const taped = await fromDrand(false, signal)
    return {
      ...taped,
      fellBack: true,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
}
