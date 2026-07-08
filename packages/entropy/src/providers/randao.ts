import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { beaconStream } from '../internal/stream.js'
import { bytesFromHexField } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'randao',
  kind: 'beacon',
  privacy: 'public',
})
const MIX_BYTES = 32
const DEFAULT_BASE_URL = 'https://ethereum-beacon-api.publicnode.com'
const SLOTS_PER_EPOCH = 32
// One slot every 12 seconds.
const DEFAULT_POLL_INTERVAL_MS = 12_000

export interface RandaoOptions {
  fetch?: typeof fetch
  baseUrl?: string
  pollIntervalMs?: number
}

interface RandaoResponse {
  data?: { randao?: unknown }
}

interface HeaderResponse {
  data?: { header?: { message?: { slot?: unknown } } }
}

/**
 * Ethereum beacon-chain RANDAO mix via a keyless public node. PUBLIC
 * crypto-beacon randomness — the block proposer can bias roughly one bit per
 * slot by withholding, so treat it as auditable public randomness for
 * commitments and mixing, never as a private entropy source.
 */
export function randao(opts: RandaoOptions = {}): EntropyProvider {
  const {
    baseUrl = DEFAULT_BASE_URL,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    fetch: fetchImpl,
  } = opts

  async function fetchMix(
    query: string,
    signal?: AbortSignal,
  ): Promise<{ hex: string; bytes: Uint8Array }> {
    const res = await fetchJson<RandaoResponse>(
      `${baseUrl}/eth/v1/beacon/states/head/randao${query}`,
      { provider: INFO.name, signal, fetchImpl },
    )
    const randaoHex = res?.data?.randao
    if (typeof randaoHex !== 'string' || !randaoHex.startsWith('0x')) {
      throw new EntropyError('bad_response', 'missing randao mix', { provider: INFO.name })
    }
    return { hex: randaoHex, bytes: bytesFromHexField(randaoHex.slice(2), MIX_BYTES, INFO.name) }
  }

  async function fetchHeadEpoch(signal?: AbortSignal): Promise<number> {
    const res = await fetchJson<HeaderResponse>(`${baseUrl}/eth/v1/beacon/headers/head`, {
      provider: INFO.name,
      signal,
      fetchImpl,
    })
    const slot = Number(res?.data?.header?.message?.slot)
    if (!Number.isInteger(slot)) {
      throw new EntropyError('bad_response', 'missing head slot', { provider: INFO.name })
    }
    return Math.floor(slot / SLOTS_PER_EPOCH)
  }

  return defineProvider({
    ...INFO,
    defaultChunkBytes: MIX_BYTES,

    async getBytes(length, reqOpts) {
      const mixesNeeded = Math.ceil(length / MIX_BYTES)
      const chunks = [(await fetchMix('', reqOpts?.signal)).bytes]
      if (mixesNeeded > 1) {
        // Historical mixes are equally public — walk epochs backwards.
        const headEpoch = await fetchHeadEpoch(reqOpts?.signal)
        for (let i = 1; i < mixesNeeded; i++) {
          const epoch = headEpoch - i
          if (epoch < 0) {
            throw new EntropyError('insufficient_entropy', 'not enough epochs for request', {
              provider: INFO.name,
            })
          }
          chunks.push((await fetchMix(`?epoch=${epoch}`, reqOpts?.signal)).bytes)
        }
      }
      return { bytes: concatBytes(chunks).slice(0, length), sources: [INFO] }
    },

    stream(streamOpts = {}) {
      // no numeric round id on this endpoint — dedupe by value change
      let lastHex = ''
      let seq = 0
      return beaconStream(
        async (signal) => {
          const mix = await fetchMix('', signal)
          if (mix.hex !== lastHex) {
            lastHex = mix.hex
            seq++
          }
          return { id: seq, bytes: mix.bytes }
        },
        pollIntervalMs,
        MIX_BYTES,
        INFO.name,
        streamOpts,
      )
    },
  })
}
