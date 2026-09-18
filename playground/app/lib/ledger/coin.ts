// Commit–reveal material: two parties' shares, the coin they produce, and the
// last-revealer abort whose bias XOR cannot remove.
//
// CLIENT-ONLY — imports @mindpeeker/ledger.

import { combineReveals, commit, openCommitment, toHex } from '@mindpeeker/ledger'
import { createYielder } from '~/lib/async'
import { getBytes, localBytes } from '~/lib/entropy'

export const SHARE_BYTES = 32
export const NONCE_BYTES = 32

export interface Share {
  readonly value: Uint8Array
  readonly nonce: Uint8Array
  readonly commitment: Uint8Array
}

/**
 * One party's commitment: a 32-byte value and a 32-byte nonce, with
 * `commit(value, nonce)` published before the deadline. The nonce is what
 * hides the value; `commit` refuses anything under MIN_NONCE_BYTES = 16.
 */
export async function drawShare(
  source: 'selected' | 'local',
  signal?: AbortSignal,
): Promise<Share> {
  const draw = source === 'selected' ? getBytes : localBytes
  const value = await draw(SHARE_BYTES, signal ? { signal } : {})
  const nonce = await draw(NONCE_BYTES, signal ? { signal } : {})
  return { value, nonce, commitment: await commit(value, nonce) }
}

export type Face = 'heads' | 'tails'

/**
 * The cheat commitments exist to stop: party B, having seen A's reveal, swaps
 * its value for `a ⊕ target` so the XOR lands on the face it wants. The nonce
 * and the published commitment stay as they were — which is exactly what
 * `openCommitment` catches.
 */
export function forgeShare(bob: Share, aliceValue: Uint8Array, want: Face): Share {
  const target = bob.value.slice()
  target[0] = want === 'heads' ? (target[0] as number) & 0xfe : (target[0] as number) | 1
  const value = new Uint8Array(target.length)
  for (let i = 0; i < value.length; i++) {
    value[i] = (target[i] as number) ^ (aliceValue[i] ?? 0)
  }
  return { ...bob, value }
}

/** The coin: the low bit of the combined seed's first byte. */
export function face(seed: Uint8Array): Face {
  return ((seed[0] as number) & 1) === 0 ? 'heads' : 'tails'
}

export interface RoundOutcome {
  readonly opened: readonly boolean[]
  readonly seed?: Uint8Array
  readonly seedHex?: string
  readonly face?: Face
  /** Why no seed was produced (an unopened or a refused commitment). */
  readonly failure?: string
}

/**
 * Run the reveal step: every commitment is opened against its published value,
 * then the opened values are XOR'd (and mixed with a beacon value when one is
 * bound). A single failed opening is a protocol failure, never a retry.
 */
export async function reveal(
  shares: readonly Share[],
  opts: { beacon?: Uint8Array; missing?: readonly number[] } = {},
): Promise<RoundOutcome> {
  const missing = new Set(opts.missing ?? [])
  const opened: boolean[] = []
  for (const [i, share] of shares.entries()) {
    opened.push(missing.has(i) ? false : await openCommitment(share.commitment, share.value, share.nonce))
  }
  if (missing.size > 0) {
    return { opened, failure: `party ${[...missing].map((i) => i + 1).join(', ')} never opened — the round is void, not retried` }
  }
  if (opened.some((ok) => !ok)) {
    return { opened, failure: 'a reveal does not match its commitment — the round is void' }
  }
  const seed = await combineReveals(
    shares.map((s) => s.value),
    opts.beacon,
  )
  return { opened, seed, seedHex: toHex(seed), face: face(seed) }
}

export interface AbortSimulation {
  readonly trials: number
  readonly restarts: number
  readonly honestHeads: number
  readonly abortHeads: number
  /** 0.5 exactly. */
  readonly honestExpected: number
  /** 1 − 2^−(k+1) exactly. */
  readonly abortExpected: number
  /** Standard error of a proportion at n trials, sqrt(p(1−p)/n). */
  readonly se: number
}

/**
 * How much a last revealer who aborts can bend the coin. With k restarts
 * tolerated before the protocol gives up, a party that refuses to open
 * whenever the outcome is not the one it wants gets its way with probability
 * exactly 1 − 2^−(k+1). The honest arm uses the same bits and stays at ½.
 */
export async function simulateAbort(
  trials: number,
  restarts: number,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<AbortSimulation> {
  const tick = createYielder(8, opts.signal)
  const attempts = restarts + 1
  const bytes = await localBytes(trials * (attempts + 1), opts.signal ? { signal: opts.signal } : {})
  let honestHeads = 0
  let abortHeads = 0
  let cursor = 0
  for (let t = 0; t < trials; t++) {
    if (((bytes[cursor++] as number) & 1) === 0) honestHeads++
    let got = false
    for (let a = 0; a < attempts; a++) {
      if (((bytes[cursor++] as number) & 1) === 0) {
        got = true
        break
      }
    }
    if (got) abortHeads++
    if ((t & 255) === 0) {
      opts.onProgress?.(t / trials)
      await tick()
    }
  }
  const abortExpected = 1 - 2 ** -attempts
  return {
    trials,
    restarts,
    honestHeads,
    abortHeads,
    honestExpected: 0.5,
    abortExpected,
    se: Math.sqrt(0.25 / trials),
  }
}
