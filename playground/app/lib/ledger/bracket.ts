// Time-bracket material: a beacon anchor (live drand, or a clearly-labelled
// local stand-in that bounds nothing), a small-T VDF seal, and a self-issued
// checkpoint used as a no-later-than witness hook.
//
// CLIENT-ONLY — imports @mindpeeker/{ledger,entropy,vdf}.

import { DRAND_CHAINS, drand, drandRoundAt, drandRoundTime } from '@mindpeeker/entropy/providers'
import {
  type BeaconAnchor,
  checkpointOf,
  merkleRoot,
  type NotAfterAnchor,
  parseCheckpoint,
  serializeCheckpoint,
  type TimeBracket,
  timeBracketSealInput,
  toHex,
} from '@mindpeeker/ledger'
import { sealBeacon, sealToBytes } from '@mindpeeker/vdf'
import { localBytes } from '~/lib/entropy'

export const QUICKNET = DRAND_CHAINS.quicknet

export interface AnchorDraw {
  readonly anchor: BeaconAnchor
  /** True only for a value a third party can fetch again from a public beacon. */
  readonly public: boolean
  readonly note: string
  readonly ms: number
}

/** The latest published drand round, with its chain hash and publication time. */
export async function drawDrandAnchor(signal?: AbortSignal): Promise<AnchorDraw> {
  const beacon = drand({ verify: 'structural' })
  const started = performance.now()
  const result = await beacon.getBytes(32, { signal, timeoutMs: 20_000 })
  const round = result.sources[0]?.rounds?.[0]
  if (round === undefined || round.timestamp === undefined) {
    throw new Error('drand answered without a round timestamp')
  }
  return {
    anchor: {
      source: 'drand',
      chain: QUICKNET.hash,
      round: round.round,
      timestamp: new Date(round.timestamp).toISOString(),
      valueHex: toHex(result.bytes),
    },
    public: true,
    note: 'League of Entropy quicknet, 3 s rounds. Anyone can re-fetch this round and compare the value.',
    ms: performance.now() - started,
  }
}

/**
 * A structurally valid anchor whose value is drawn locally. It makes the
 * record parse; it bounds nothing in time, because nobody else can fetch it.
 */
export async function drawStandInAnchor(signal?: AbortSignal): Promise<AnchorDraw> {
  const started = performance.now()
  const bytes = await localBytes(32, signal ? { signal } : {})
  return {
    anchor: {
      source: 'local-stand-in',
      chain: 'not a public chain: generated in this browser',
      // Unix seconds, not a drand round — nothing here pretends to be a beacon.
      round: Math.floor(Date.now() / 1000),
      timestamp: new Date().toISOString(),
      valueHex: toHex(bytes),
    },
    public: false,
    note: 'Offline stand-in from the browser CSPRNG, with Unix seconds where a round number belongs. The bracket validates and the seal verifies, but no third party can re-fetch this value, so it bounds nothing in time.',
    ms: performance.now() - started,
  }
}

/**
 * A drand round that has not happened yet, from the chain's genesis time and
 * 3 s period — plain arithmetic, no network. Committing to it in the
 * registration is what takes the advantage away from the last revealer.
 */
export function futureRound(seconds: number): { round: number; publishesAt: string } {
  const round = drandRoundAt(Date.now() + seconds * 1000, QUICKNET)
  return { round, publishesAt: new Date(drandRoundTime(round, QUICKNET)).toISOString() }
}

/** Fetch the anchored round again, the way an independent verifier would. */
export async function refetchRound(round: number, signal?: AbortSignal): Promise<string> {
  const result = await drand({ verify: 'structural' }).getRound(round, { signal, timeoutMs: 20_000 })
  return toHex(result.bytes)
}

export interface SealResult {
  readonly bytesHex: string
  readonly bytes: number
  readonly ms: number
  readonly T: number
}

/**
 * Seal the bracket's canonical seal input with T sequential squarings. T here
 * is tiny so the page stays usable; a real bracket sizes T with the vdf
 * package's `calibrate().suggestT` and a hardware-speed-up margin.
 */
export async function sealBracket(
  bracket: TimeBracket,
  T: number,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<SealResult> {
  const input = timeBracketSealInput(bracket)
  const started = performance.now()
  const seal = await sealBeacon(input, T, {
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.onProgress
      ? { onProgress: (done: number, total: number) => opts.onProgress?.(done / total) }
      : {}),
  })
  const bytes = sealToBytes(seal, input)
  return { bytesHex: toHex(bytes), bytes: bytes.length, ms: performance.now() - started, T }
}

export const WITNESS_ORIGIN = 'example.org/mindpeeker-playground/witness-log'

/**
 * A no-later-than reference we can actually check here: a bare C2SP checkpoint
 * over a one-leaf tree whose leaf is the bracket hash. Self-issued, so it
 * witnesses nothing on its own — the hook below only shows where a real
 * witness's verifier would plug in.
 */
export async function selfWitness(bracketHash: string): Promise<NotAfterAnchor> {
  const checkpoint = await checkpointOf(WITNESS_ORIGIN, [bracketHash])
  return { kind: 'tlog-checkpoint', ref: serializeCheckpoint(checkpoint) }
}

/**
 * A `verifyNotAfter` hook: the reference must be a checkpoint of the expected
 * origin whose root is the Merkle root of the bracket's own hash.
 */
export function witnessVerifier(
  bracketHash: string,
): (anchor: NotAfterAnchor) => Promise<boolean> {
  return async (anchor: NotAfterAnchor) => {
    if (anchor.kind !== 'tlog-checkpoint') return false
    const checkpoint = parseCheckpoint(anchor.ref)
    if (checkpoint.origin !== WITNESS_ORIGIN || checkpoint.size !== 1) return false
    return toHex(checkpoint.root) === toHex(await merkleRoot([bracketHash]))
  }
}

/**
 * Demo sizes only. A real bracket sizes T with the vdf package's
 * `calibrate().suggestT` and a hardware speed-up margin of about 1000.
 */
export const T_CHOICES = [
  { label: 'T = 1 000 (instant)', value: 1000 },
  { label: 'T = 5 000 (default)', value: 5000 },
  { label: 'T = 20 000 (about a second)', value: 20000 },
  { label: 'T = 50 000 (a few seconds)', value: 50000 },
]
