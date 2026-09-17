/**
 * Recorded drand quicknet responses for offline runs. Captured from
 * https://api.drand.sh (round 32285086 also from api2.drand.sh, identical) on
 * 2026-09-17T15:23:55Z. The provider checks these exactly as it checks live
 * responses; only the transport is replaced.
 */
import { drand } from '@mindpeeker/entropy/providers'

export const RECORDED_DRAND = Object.freeze({
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

/** The newest recorded round: what `rounds/latest` answers offline. */
export const RECORDED_LATEST_ROUND = 32285086

type Edit = (path: string, body: Record<string, unknown>) => Record<string, unknown>

/**
 * A `fetch` that answers drand's v2 routes from the recording. `edit` lets a
 * recipe play a misbehaving mirror by rewriting a response body.
 */
export function recordedDrandFetch(edit: Edit = (_path, body) => body): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    const round = /\/v2\/beacons\/quicknet\/rounds\/(latest|\d+)$/.exec(path)?.[1]
    const wanted = round === 'latest' ? RECORDED_LATEST_ROUND : Number(round)
    const body = path.endsWith('/v2/beacons/quicknet/info')
      ? RECORDED_DRAND.info
      : RECORDED_DRAND.rounds.find((r) => r.round === wanted)
    if (!body) return new Response('not recorded', { status: 404 })
    return Response.json(edit(path, { ...body }))
  }
  return impl as typeof fetch
}

/** drand quicknet with structural verification, live or from the recording. */
export function drandBeacon(live: boolean, fetchImpl = recordedDrandFetch()) {
  return drand({ verify: 'structural', ...(live ? {} : { fetch: fetchImpl }) })
}
