import { EntropyError } from '../errors.js'
import type { BeaconProvider, BeaconRound, EntropySourceInfo } from '../types.js'
import { raceSignal } from './abort.js'
import { attribution, beaconRound, defineBeacon, roundResult } from './beacon.js'
import { concatBytes } from './bytes.js'
import { fetchJson, fetchText } from './http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from './mirrors.js'
import {
  checkPulseLinkage,
  checkPulseOutput,
  checkPulseSignature,
  importPulseCertificate,
  parseStrictPulse,
  type StrictPulse,
} from './nist-verify.js'
import { requireTimeoutMs } from './options.js'
import { beaconStream } from './stream.js'
import { bytesFromHexField } from './validate.js'

/** Caller-facing options every NIST-2.0-format beacon provider exposes. */
export interface NistFamilyOptions extends BaseUrlOptions {
  fetch?: typeof fetch
  /** Stream poll cadence: finite, 0 < ms ≤ 2³¹ − 1. Default: the beacon's pulse period. */
  pollIntervalMs?: number
}

/**
 * Opt-in pulse verification for beacons publishing cipherSuite 0 (SHA-512 +
 * RSA PKCS#1 v1.5). A failed check throws `EntropyError('verification')`.
 *
 * - `true`: recompute `outputValue` = SHA-512(fields ‖ signature), fetch the
 *   certificate named by `certificateId` (cached per provider), check it
 *   hashes to that id, verify `signatureValue` with WebCrypto, and check the
 *   chain linkage (`previous` value and precommitment) of consecutive pulses
 *   a request walks through;
 * - `'hash'`: the same without the certificate and signature;
 * - `false` (default): trust TLS and the JSON shape.
 */
export type NistVerifyMode = boolean | 'hash'

export interface NistVerifyOptions {
  /** Opt-in pulse verification (see `NistVerifyMode`). Default `false`. */
  verify?: NistVerifyMode
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
  /**
   * Path of a chain's last pulse, used to walk back across a chain boundary;
   * `null` when the beacon has no such route. Default `/chain/{chain}/pulse/last`.
   */
  chainLastPath?: ((chainIndex: number) => string) | null
  /** Certificate path. Default `/certificate/{certificateId}`. */
  certificatePath?: (certificateId: string) => string
  /** outputValue size in bytes. Default 64 (512-bit). */
  pulseBytes?: number
  /** Pulse period, doubling as the default stream poll cadence. */
  defaultPollIntervalMs: number
}

/** How long a (shared, cached) certificate download may take. */
const CERTIFICATE_TIMEOUT_MS = 30_000

interface Pulse {
  chainIndex: number
  pulseIndex: number
  bytes: Uint8Array
  round: BeaconRound
  /** Present when verification is enabled. */
  strict?: StrictPulse
}

type Fields = Record<string, unknown>

/**
 * Shared machinery for the NIST IR 8213 beacon family (NIST, NQSN Singapore,
 * Random UChile, Inmetro Brazil): fetch the latest pulse (wrapped or flat
 * JSON), walk the chain backwards for larger requests — across chain
 * boundaries where the beacon serves `/chain/{c}/pulse/last` — checking that
 * every historical pulse is the one requested, stream with `(chainIndex,
 * pulseIndex)` ids so a chain reset never stalls, fetch rounds by index and
 * optionally verify pulses. All of these emit PUBLIC randomness — never use
 * it as secret key material.
 */
export function nistPulseBeacon(
  spec: NistFamilySpec,
  opts: NistFamilyOptions & NistVerifyOptions = {},
): BeaconProvider {
  const { info, pulseBytes = 64 } = spec
  const { name } = info
  const pulsePath = spec.pulsePath ?? ((chain: number, i: number) => `/chain/${chain}/pulse/${i}`)
  const chainLastPath =
    spec.chainLastPath === undefined
      ? (chain: number) => `/chain/${chain}/pulse/last`
      : spec.chainLastPath
  const certificatePath = spec.certificatePath ?? ((id: string) => `/certificate/${id}`)
  const bases = resolveBaseUrls(opts, [spec.defaultBaseUrl], name)
  const pollIntervalMs = requireTimeoutMs(
    opts.pollIntervalMs ?? spec.defaultPollIntervalMs,
    'pollIntervalMs',
    name,
  )
  const verify = opts.verify ?? false
  if (typeof verify !== 'boolean' && verify !== 'hash') {
    throw new EntropyError('invalid_request', `verify must be true, false or 'hash'`, {
      provider: name,
    })
  }
  const fetchImpl = opts.fetch
  const certificates = new Map<string, Promise<CryptoKey>>()

  function certificateKey(base: string, certificateId: string, signal: AbortSignal) {
    const id = certificateId.toLowerCase()
    let key = certificates.get(id)
    if (!key) {
      // Shared by every caller: runs under its own budget, never a caller's signal.
      key = fetchText(`${base}${certificatePath(certificateId)}`, {
        provider: name,
        signal: AbortSignal.timeout(CERTIFICATE_TIMEOUT_MS),
        fetchImpl,
      }).then((pem) => importPulseCertificate(pem, certificateId, name))
      key.catch(() => certificates.delete(id))
      certificates.set(id, key)
    }
    return raceSignal(key, signal)
  }

  function parsePulse(raw: unknown): Pulse {
    const wrapped = (raw as { pulse?: unknown } | null)?.pulse
    const pulse = (wrapped ?? raw) as Fields | null
    const chainIndex = pulse?.chainIndex
    const pulseIndex = pulse?.pulseIndex
    if (
      !Number.isSafeInteger(chainIndex) ||
      !Number.isSafeInteger(pulseIndex) ||
      (chainIndex as number) < 0 ||
      (pulseIndex as number) < 0
    ) {
      throw new EntropyError('bad_response', 'malformed beacon pulse', { provider: name })
    }
    const timeStamp = pulse?.timeStamp
    return {
      chainIndex: chainIndex as number,
      pulseIndex: pulseIndex as number,
      bytes: bytesFromHexField(pulse?.outputValue, pulseBytes, name),
      round: beaconRound(pulseIndex as number, {
        chain: chainIndex as number,
        timestamp: typeof timeStamp === 'string' ? Date.parse(timeStamp) : undefined,
        signature: pulse?.signatureValue,
      }),
      strict: verify ? parseStrictPulse(pulse, name) : undefined,
    }
  }

  async function verifyPulse(base: string, pulse: Pulse, signal: AbortSignal): Promise<void> {
    const strict = pulse.strict as StrictPulse
    if (strict.cipherSuite !== 0) {
      throw new EntropyError(
        'verification',
        `pulse ${strict.chainIndex}/${strict.pulseIndex} uses cipherSuite ${strict.cipherSuite}; only 0 (SHA-512 + RSA PKCS#1 v1.5) is verifiable`,
        { provider: name },
      )
    }
    await checkPulseOutput(strict, name)
    if (verify === true) {
      const key = await certificateKey(base, strict.certificateId, signal)
      await checkPulseSignature(strict, key, name)
    }
  }

  /** Fetch one pulse (mirror failover), check it is the one expected, verify it. */
  function fetchPulse(
    path: string,
    signal: AbortSignal,
    expect?: { chain: number; pulse?: number },
  ): Promise<Pulse> {
    return withMirrors(bases, async (base) => {
      const pulse = parsePulse(
        await fetchJson<unknown>(`${base}${path}`, { provider: name, signal, fetchImpl }),
      )
      if (
        expect &&
        (pulse.chainIndex !== expect.chain ||
          (expect.pulse !== undefined && pulse.pulseIndex !== expect.pulse))
      ) {
        throw new EntropyError(
          'bad_response',
          `requested pulse ${expect.chain}/${expect.pulse ?? 'last'}, got ${pulse.chainIndex}/${pulse.pulseIndex}`,
          { provider: name },
        )
      }
      if (verify) await verifyPulse(base, pulse, signal)
      return pulse
    })
  }

  async function link(later: Pulse, earlier: Pulse): Promise<void> {
    if (
      verify &&
      later.strict &&
      earlier.strict &&
      later.chainIndex === earlier.chainIndex &&
      later.pulseIndex === earlier.pulseIndex + 1
    ) {
      await checkPulseLinkage(later.strict, earlier.strict, name)
    }
  }

  function previousPulse(cursor: Pulse, signal: AbortSignal): Promise<Pulse> {
    const { chainIndex, pulseIndex } = cursor
    if (pulseIndex > 1) {
      return fetchPulse(pulsePath(chainIndex, pulseIndex - 1), signal, {
        chain: chainIndex,
        pulse: pulseIndex - 1,
      })
    }
    if (!chainLastPath || chainIndex <= 1) {
      throw new EntropyError('insufficient_entropy', 'beacon chain too short for request', {
        provider: name,
      })
    }
    return fetchPulse(chainLastPath(chainIndex - 1), signal, { chain: chainIndex - 1 })
  }

  return defineBeacon({
    ...info,
    defaultChunkBytes: pulseBytes,
    chained: true,

    async getBytes(length, reqOpts) {
      const signal = reqOpts?.signal as AbortSignal
      const pulsesNeeded = Math.ceil(length / pulseBytes)
      let cursor = await fetchPulse(spec.latestPath, signal)
      const pulses = [cursor]
      // Past pulses are equally public — walk the chain backwards.
      while (pulses.length < pulsesNeeded) {
        const prior = await previousPulse(cursor, signal)
        await link(cursor, prior)
        pulses.push(prior)
        cursor = prior
      }
      return {
        bytes: concatBytes(pulses.map((p) => p.bytes)).slice(0, length),
        sources: [
          attribution(
            info,
            pulses.map((p) => p.round),
          ),
        ],
      }
    },

    async getRound(pulseIndex, { signal, chain }) {
      const chainIndex = chain ?? (await fetchPulse(spec.latestPath, signal)).chainIndex
      const pulse = await fetchPulse(pulsePath(chainIndex, pulseIndex), signal, {
        chain: chainIndex,
        pulse: pulseIndex,
      })
      return roundResult(info, pulse.round, pulse.bytes)
    },

    stream(streamOpts = {}) {
      let last: Pulse | undefined
      return beaconStream(
        async (signal) => {
          const pulse = await fetchPulse(spec.latestPath, signal)
          if (last) await link(pulse, last)
          last = pulse
          return { id: [pulse.chainIndex, pulse.pulseIndex], bytes: pulse.bytes }
        },
        pollIntervalMs,
        name,
        streamOpts,
      )
    },
  })
}
