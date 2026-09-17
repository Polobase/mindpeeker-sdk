import { EntropyError } from '../errors.js'
import { attribution, beaconRound, defineBeacon, roundResult } from '../internal/beacon.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireTimeoutMs } from '../internal/options.js'
import { beaconStream } from '../internal/stream.js'
import { bytesFromHexField } from '../internal/validate.js'
import type { BeaconProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'randao',
  kind: 'beacon',
  privacy: 'public',
})
const MIX_BYTES = 32
const DEFAULT_BASE_URL = 'https://ethereum-beacon-api.publicnode.com'
const SLOTS_PER_EPOCH = 32
// One slot every 12 seconds; a new epoch completes every 6.4 minutes.
const DEFAULT_POLL_INTERVAL_MS = 12_000

export interface RandaoOptions extends BaseUrlOptions {
  fetch?: typeof fetch
  /** Stream poll cadence: finite, 0 < ms ≤ 2³¹ − 1. Default 12 000 (one slot). */
  pollIntervalMs?: number
}

interface RandaoResponse {
  data?: { randao?: unknown }
}

interface HeaderResponse {
  data?: { header?: { message?: { slot?: unknown } } }
}

/**
 * Ethereum beacon-chain RANDAO via a keyless public node. PUBLIC crypto-beacon
 * randomness — the block proposer can bias roughly one bit per slot by
 * withholding, so treat it as auditable public randomness for commitments and
 * mixing, never as a private entropy source.
 *
 * Values are the final RANDAO mixes of COMPLETED epochs (newest first), so
 * every chunk names a reproducible round `{ round: epoch }` and
 * `getRound(epoch)` returns the same bytes later. A node answers for recent
 * epochs only (the state keeps 65 536 epochs; public nodes may keep fewer).
 */
export function randao(opts: RandaoOptions = {}): BeaconProvider {
  const { fetch: fetchImpl } = opts
  const bases = resolveBaseUrls(opts, [DEFAULT_BASE_URL], INFO.name)
  const pollIntervalMs = requireTimeoutMs(
    opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    'pollIntervalMs',
    INFO.name,
  )

  function fetchMix(epoch: number, signal: AbortSignal): Promise<Uint8Array> {
    return withMirrors(bases, async (base) => {
      const res = await fetchJson<RandaoResponse>(
        `${base}/eth/v1/beacon/states/head/randao?epoch=${epoch}`,
        { provider: INFO.name, signal, fetchImpl },
      )
      const randaoHex = res?.data?.randao
      if (typeof randaoHex !== 'string' || !randaoHex.startsWith('0x')) {
        throw new EntropyError('bad_response', 'missing randao mix', { provider: INFO.name })
      }
      return bytesFromHexField(randaoHex.slice(2), MIX_BYTES, INFO.name)
    })
  }

  /** The epoch of the head slot; slots are decimal strings in the Beacon API. */
  function fetchHeadEpoch(signal: AbortSignal): Promise<number> {
    return withMirrors(bases, async (base) => {
      const res = await fetchJson<HeaderResponse>(`${base}/eth/v1/beacon/headers/head`, {
        provider: INFO.name,
        signal,
        fetchImpl,
      })
      const slot = res?.data?.header?.message?.slot
      const value = typeof slot === 'string' && /^\d+$/.test(slot) ? Number(slot) : Number.NaN
      if (!Number.isSafeInteger(value)) {
        throw new EntropyError('bad_response', 'missing or malformed head slot', {
          provider: INFO.name,
        })
      }
      return Math.floor(value / SLOTS_PER_EPOCH)
    })
  }

  return defineBeacon({
    ...INFO,
    defaultChunkBytes: MIX_BYTES,
    minRound: 0,

    async getBytes(length, reqOpts) {
      const signal = reqOpts?.signal as AbortSignal
      const mixesNeeded = Math.ceil(length / MIX_BYTES)
      const newest = (await fetchHeadEpoch(signal)) - 1
      const chunks: Uint8Array[] = []
      const rounds = []
      for (let i = 0; i < mixesNeeded; i++) {
        const epoch = newest - i
        if (epoch < 0) {
          throw new EntropyError(
            'insufficient_entropy',
            'not enough completed epochs for request',
            {
              provider: INFO.name,
            },
          )
        }
        chunks.push(await fetchMix(epoch, signal))
        rounds.push(beaconRound(epoch))
      }
      return {
        bytes: concatBytes(chunks).slice(0, length),
        sources: [attribution(INFO, rounds)],
      }
    },

    async getRound(epoch, { signal }) {
      const headEpoch = await fetchHeadEpoch(signal)
      if (epoch >= headEpoch) {
        throw new EntropyError(
          'invalid_request',
          `epoch ${epoch} has not completed yet (head epoch ${headEpoch})`,
          { provider: INFO.name },
        )
      }
      return roundResult(INFO, beaconRound(epoch), await fetchMix(epoch, signal))
    },

    stream(streamOpts = {}) {
      let last: { epoch: number; bytes: Uint8Array } | undefined
      return beaconStream(
        async (signal) => {
          const epoch = (await fetchHeadEpoch(signal)) - 1
          if (!last || last.epoch !== epoch) last = { epoch, bytes: await fetchMix(epoch, signal) }
          return { id: last.epoch, bytes: last.bytes }
        },
        pollIntervalMs,
        INFO.name,
        streamOpts,
      )
    },
  })
}
