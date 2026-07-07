import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { beaconStream } from '../internal/stream.js'
import { bytesFromHexField } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'nist-beacon',
  kind: 'beacon',
  privacy: 'public',
})
const PULSE_BYTES = 64 // 512-bit outputValue
const DEFAULT_BASE_URL = 'https://beacon.nist.gov/beacon/2.0'
// One pulse per minute.
const DEFAULT_POLL_INTERVAL_MS = 60_000

export interface NistBeaconOptions {
  fetch?: typeof fetch
  baseUrl?: string
  /** Stream poll cadence. Default 60_000 (the pulse period). */
  pollIntervalMs?: number
}

interface NistPulse {
  chainIndex?: unknown
  pulseIndex?: unknown
  outputValue?: unknown
}

/**
 * NIST Randomness Beacon 2.0 — 512 signed bits every 60 seconds. PUBLIC
 * randomness; NIST's own warning applies: never use beacon values as secret
 * keys. Useful for audits, lotteries and as an `xorMix` auditability input.
 */
export function nistBeacon(opts: NistBeaconOptions = {}): EntropyProvider {
  const {
    baseUrl = DEFAULT_BASE_URL,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    fetch: fetchImpl,
  } = opts

  async function fetchPulse(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ chainIndex: number; pulseIndex: number; bytes: Uint8Array }> {
    const res = await fetchJson<{ pulse?: NistPulse } & NistPulse>(`${baseUrl}${path}`, {
      provider: INFO.name,
      signal,
      fetchImpl,
    })
    const pulse = res?.pulse ?? res
    const { chainIndex, pulseIndex } = pulse ?? {}
    if (!Number.isInteger(chainIndex) || !Number.isInteger(pulseIndex)) {
      throw new EntropyError('bad_response', 'malformed beacon pulse', { provider: INFO.name })
    }
    return {
      chainIndex: chainIndex as number,
      pulseIndex: pulseIndex as number,
      bytes: bytesFromHexField(pulse?.outputValue, PULSE_BYTES, INFO.name),
    }
  }

  return defineProvider({
    ...INFO,
    defaultChunkBytes: PULSE_BYTES,

    async getBytes(length, reqOpts) {
      const pulsesNeeded = Math.ceil(length / PULSE_BYTES)
      const latest = await fetchPulse('/pulse/last', reqOpts?.signal)
      const chunks = [latest.bytes]
      // Past pulses are equally public — walk the chain backwards.
      for (let i = 1; i < pulsesNeeded; i++) {
        const pulseIndex = latest.pulseIndex - i
        if (pulseIndex < 1) {
          throw new EntropyError('insufficient_entropy', 'beacon chain too short for request', {
            provider: INFO.name,
          })
        }
        const prior = await fetchPulse(
          `/chain/${latest.chainIndex}/pulse/${pulseIndex}`,
          reqOpts?.signal,
        )
        chunks.push(prior.bytes)
      }
      return { bytes: concatBytes(chunks).slice(0, length), sources: [INFO] }
    },

    stream(streamOpts = {}) {
      return beaconStream(
        async (signal) => {
          const pulse = await fetchPulse('/pulse/last', signal)
          return { id: pulse.pulseIndex, bytes: pulse.bytes }
        },
        pollIntervalMs,
        PULSE_BYTES,
        INFO.name,
        streamOpts,
      )
    },
  })
}
