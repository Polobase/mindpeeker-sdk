import { EntropyError } from '../errors.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'
import { concatBytes } from './bytes.js'
import { fetchJson } from './http.js'
import { defineProvider } from './provider.js'
import { beaconStream } from './stream.js'
import { bytesFromHexField } from './validate.js'

/** Caller-facing options every NIST-2.0-format beacon provider exposes. */
export interface NistFamilyOptions {
  fetch?: typeof fetch
  baseUrl?: string
  /** Stream poll cadence. Default: the beacon's pulse period. */
  pollIntervalMs?: number
}

export interface NistFamilySpec {
  info: EntropySourceInfo
  defaultBaseUrl: string
  /**
   * Appended to baseUrl for the newest pulse — may carry a query string
   * (UChile) or rely on an HTTP redirect that fetch follows (NQSN's 303).
   */
  latestPath: string
  /** Historical pulse path. Default `/chain/{chain}/pulse/{i}`. */
  pulsePath?: (chainIndex: number, pulseIndex: number) => string
  /** outputValue size in bytes. Default 64 (512-bit). */
  pulseBytes?: number
  /** Pulse period, doubling as the default stream poll cadence. */
  defaultPollIntervalMs: number
}

interface NistPulse {
  chainIndex?: unknown
  pulseIndex?: unknown
  outputValue?: unknown
}

/**
 * Shared machinery for the NIST IR 8213 beacon family (NIST, NQSN Singapore,
 * Random UChile, Inmetro Brazil): fetch latest pulse (wrapped or flat JSON),
 * walk the chain backwards for larger requests, poll-dedupe streaming.
 * All of these emit PUBLIC randomness — never use it as secret key material.
 */
export function nistPulseBeacon(
  spec: NistFamilySpec,
  opts: NistFamilyOptions = {},
): EntropyProvider {
  const { info, pulseBytes = 64 } = spec
  const pulsePath = spec.pulsePath ?? ((chain: number, i: number) => `/chain/${chain}/pulse/${i}`)
  const {
    baseUrl = spec.defaultBaseUrl,
    pollIntervalMs = spec.defaultPollIntervalMs,
    fetch: fetchImpl,
  } = opts

  async function fetchPulse(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ chainIndex: number; pulseIndex: number; bytes: Uint8Array }> {
    const res = await fetchJson<{ pulse?: NistPulse } & NistPulse>(`${baseUrl}${path}`, {
      provider: info.name,
      signal,
      fetchImpl,
    })
    const pulse = res?.pulse ?? res
    const { chainIndex, pulseIndex } = pulse ?? {}
    if (!Number.isInteger(chainIndex) || !Number.isInteger(pulseIndex)) {
      throw new EntropyError('bad_response', 'malformed beacon pulse', { provider: info.name })
    }
    return {
      chainIndex: chainIndex as number,
      pulseIndex: pulseIndex as number,
      bytes: bytesFromHexField(pulse?.outputValue, pulseBytes, info.name),
    }
  }

  return defineProvider({
    ...info,
    defaultChunkBytes: pulseBytes,

    async getBytes(length, reqOpts) {
      const pulsesNeeded = Math.ceil(length / pulseBytes)
      const latest = await fetchPulse(spec.latestPath, reqOpts?.signal)
      const chunks = [latest.bytes]
      // Past pulses are equally public — walk the chain backwards.
      for (let i = 1; i < pulsesNeeded; i++) {
        const pulseIndex = latest.pulseIndex - i
        if (pulseIndex < 1) {
          throw new EntropyError('insufficient_entropy', 'beacon chain too short for request', {
            provider: info.name,
          })
        }
        const prior = await fetchPulse(pulsePath(latest.chainIndex, pulseIndex), reqOpts?.signal)
        chunks.push(prior.bytes)
      }
      return { bytes: concatBytes(chunks).slice(0, length), sources: [info] }
    },

    stream(streamOpts = {}) {
      return beaconStream(
        async (signal) => {
          const pulse = await fetchPulse(spec.latestPath, signal)
          return { id: pulse.pulseIndex, bytes: pulse.bytes }
        },
        pollIntervalMs,
        pulseBytes,
        info.name,
        streamOpts,
      )
    },
  })
}
