/**
 * Recipe 10: drand round metadata, round arithmetic, re-fetching a round, and what the
 * structural checks catch. Offline it replays a recorded round; --live fetches.
 * bun examples/src/10-beacon-rounds.ts [--live] [--smoke]
 */
import { EntropyError } from '@mindpeeker/entropy'
import { DRAND_CHAINS, drandRoundAt, drandRoundTime } from '@mindpeeker/entropy/providers'
import { parseArgs } from './lib/cli.js'
import { drandBeacon, RECORDED_LATEST_ROUND, recordedDrandFetch } from './lib/drand-fixture.js'

const args = parseArgs()
const chain = DRAND_CHAINS.quicknet
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

// 1. Two rounds of public randomness, each with the round it came from.
const beacon = drandBeacon(args.live) // verify: 'structural'
const { bytes, sources } = await beacon.getBytes(64)
const rounds = sources[0]?.rounds ?? []
for (const [i, r] of rounds.entries()) {
  console.log(
    `round ${r.round}`.padEnd(19),
    new Date(r.timestamp ?? Number.NaN).toISOString(),
    `value ${hex(bytes.subarray(32 * i, 32 * i + 8))}…`,
    `sig ${r.signature?.slice(0, 16)}…`,
  )
}

// 2. Round arithmetic: rounds are a clock, fixed by the chain's genesis and period.
const newest = rounds[0]
if (!newest) throw new Error('no round metadata')
const published = drandRoundTime(newest.round, chain)
console.log(
  'published at       ',
  new Date(published).toISOString(),
  published === newest.timestamp,
)
console.log(
  'round at that time ',
  drandRoundAt(published, chain),
  'and 3 s later',
  drandRoundAt(published + 3000, chain),
)

// 3. Anyone can fetch the same round again and compare the bytes.
const replay = await beacon.getRound(newest.round)
console.log('re-fetched value   ', hex(replay.bytes) === hex(bytes.subarray(0, 32)))

// 4. What the structural checks catch, on doctored copies of the recording.
const attacks: [string, typeof fetch][] = [
  [
    'foreign chain info',
    recordedDrandFetch((path, body) =>
      path.endsWith('/info') ? { ...body, chain_hash: DRAND_CHAINS.default.hash } : body,
    ),
  ],
  [
    'short signature',
    recordedDrandFetch((path, body) =>
      path.includes('/rounds/')
        ? { ...body, signature: String(body.signature).slice(0, 64) }
        : body,
    ),
  ],
  [
    'stale caching proxy',
    recordedDrandFetch((path, body) =>
      path.includes('/rounds/') ? { ...body, round: RECORDED_LATEST_ROUND } : body,
    ),
  ],
]
for (const [label, fetchImpl] of attacks) {
  try {
    await drandBeacon(false, fetchImpl).getRound(RECORDED_LATEST_ROUND - 1)
    console.log(label.padEnd(19), 'accepted')
  } catch (error) {
    const cause = error instanceof EntropyError ? error.code : String(error)
    console.log(label.padEnd(19), `rejected: ${cause}`)
  }
}
