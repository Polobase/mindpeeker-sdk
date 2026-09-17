import { describe, expect, test } from 'bun:test'
import { attribution, beaconRound, defineBeacon, roundResult } from '../../src/internal/beacon.js'
import type { EntropySourceInfo } from '../../src/types.js'
import { rejectedEntropyError } from '../helpers/errors.js'

const INFO: EntropySourceInfo = { name: 'b', kind: 'beacon', privacy: 'public' }

function beacon(opts: { chained?: boolean; minRound?: number; hang?: boolean } = {}) {
  const requests: { round: number; chain?: number }[] = []
  const provider = defineBeacon({
    ...INFO,
    ...opts,
    getBytes: async (length) => ({ bytes: new Uint8Array(length), sources: [INFO] }),
    getRound: (round, { signal, chain }) => {
      requests.push({ round, chain })
      if (opts.hang) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason))
        })
      }
      return Promise.resolve(roundResult(INFO, beaconRound(round, { chain }), new Uint8Array([1])))
    },
  })
  return { provider, requests }
}

describe('defineBeacon', () => {
  test('getRound validates the round number and the chain option', async () => {
    const single = beacon()
    await rejectedEntropyError(single.provider.getRound(0), 'invalid_request')
    await rejectedEntropyError(single.provider.getRound(Number.NaN), 'invalid_request')
    await rejectedEntropyError(single.provider.getRound(3, { chain: 1 }), 'invalid_request')
    const chained = beacon({ chained: true })
    await rejectedEntropyError(chained.provider.getRound(3, { chain: 0 }), 'invalid_request')
    const result = await chained.provider.getRound(3, { chain: 2 })
    expect(result.round).toEqual({ round: 3, chain: 2 })
    expect(chained.requests).toEqual([{ round: 3, chain: 2 }])
    const zero = beacon({ minRound: 0 })
    expect((await zero.provider.getRound(0)).round.round).toBe(0)
    expect(single.requests).toHaveLength(0)
  })

  test('getRound has the getBytes timeout and abort contract', async () => {
    await rejectedEntropyError(
      beacon({ hang: true }).provider.getRound(1, { timeoutMs: 20 }),
      'timeout',
    )
    await rejectedEntropyError(
      beacon().provider.getRound(1, { signal: AbortSignal.abort() }),
      'aborted',
    )
    await rejectedEntropyError(beacon().provider.getRound(1, { timeoutMs: -1 }), 'invalid_request')
  })

  test('attribution omits empty round lists and beaconRound omits absent fields', () => {
    expect(attribution(INFO, [])).toEqual(INFO)
    expect(beaconRound(5, { timestamp: Number.NaN, signature: '' })).toEqual({ round: 5 })
    expect(beaconRound(5, { chain: 1, timestamp: 10, signature: 'ab' })).toEqual({
      round: 5,
      chain: 1,
      timestamp: 10,
      signature: 'ab',
    })
  })
})
