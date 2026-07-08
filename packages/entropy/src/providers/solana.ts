import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { base58Decode } from '../internal/encoding.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { sleep } from '../internal/rate-limit.js'
import { beaconStream } from '../internal/stream.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'solana',
  kind: 'beacon',
  privacy: 'public',
})
const HASH_BYTES = 32
const DEFAULT_URL = 'https://api.mainnet-beta.solana.com/'
// ~400 ms slots; poll politely.
const DEFAULT_POLL_INTERVAL_MS = 500

export interface SolanaBeaconOptions {
  fetch?: typeof fetch
  url?: string
  pollIntervalMs?: number
}

interface RpcResponse {
  result?: { context?: { slot?: unknown }; value?: { blockhash?: unknown } }
}

/**
 * Solana latest blockhash as a PUBLIC crypto-beacon (fast ~400 ms slots).
 * The slot leader influences block content, so treat it like every other
 * chain beacon: auditable public randomness, never private entropy.
 */
export function solanaBeacon(opts: SolanaBeaconOptions = {}): EntropyProvider {
  const { url = DEFAULT_URL, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, fetch: fetchImpl } = opts

  async function fetchLatest(signal?: AbortSignal): Promise<{ slot: number; bytes: Uint8Array }> {
    const res = await fetchJson<RpcResponse>(url, {
      provider: INFO.name,
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' },
      signal,
      fetchImpl,
    })
    const slot = res?.result?.context?.slot
    const blockhash = res?.result?.value?.blockhash
    if (!Number.isInteger(slot) || typeof blockhash !== 'string') {
      throw new EntropyError('bad_response', 'missing blockhash/slot', { provider: INFO.name })
    }
    let bytes: Uint8Array
    try {
      bytes = base58Decode(blockhash)
    } catch (error) {
      throw new EntropyError('bad_response', 'invalid base58 blockhash', {
        provider: INFO.name,
        cause: error,
      })
    }
    if (bytes.length !== HASH_BYTES) {
      throw new EntropyError('bad_response', `blockhash decodes to ${bytes.length} bytes`, {
        provider: INFO.name,
      })
    }
    return { slot: slot as number, bytes }
  }

  return defineProvider({
    ...INFO,
    defaultChunkBytes: HASH_BYTES,

    async getBytes(length, reqOpts) {
      // no keyless historical route — aggregate consecutive fresh slots,
      // waiting out repeats (slots are ~400 ms, so this stays cheap)
      const chunks: Uint8Array[] = []
      let collected = 0
      let lastSlot = -1
      while (collected < length) {
        const { slot, bytes } = await fetchLatest(reqOpts?.signal)
        if (slot === lastSlot) {
          await sleep(pollIntervalMs, reqOpts?.signal)
          continue
        }
        lastSlot = slot
        chunks.push(bytes)
        collected += bytes.length
      }
      return { bytes: concatBytes(chunks).slice(0, length), sources: [INFO] }
    },

    stream(streamOpts = {}) {
      return beaconStream(
        async (signal) => {
          const { slot, bytes } = await fetchLatest(signal)
          return { id: slot, bytes }
        },
        pollIntervalMs,
        HASH_BYTES,
        INFO.name,
        streamOpts,
      )
    },
  })
}
