// The deterministic control arm: drbgProvider replayed byte-exactly, and the
// two ways a replay goes wrong (a different personalization, a different
// sequence of request sizes).
// CLIENT-ONLY (it imports @mindpeeker/entropy/providers).

import { drbgProvider } from '@mindpeeker/entropy/providers'
import { seedBytes } from '~/lib/entropy'
import { errorInfo, type ErrorInfo } from '~/lib/errors'
import { toHex } from '~/lib/format'

export interface ReplayRow {
  readonly label: string
  readonly detail: string
  readonly hex: string
  readonly identical: boolean
  /** Index of the first byte that differs from run A, when it does. */
  readonly firstDifference?: number
}

export interface ReplayReport {
  /** `hmac-drbg(seed:1a2b3c4d)` — the first 4 bytes of SHA-256(seed). */
  readonly providerName: string
  readonly seedLength: number
  readonly bytes: number
  readonly rows: readonly ReplayRow[]
  readonly ms: number
}

function firstDifference(a: Uint8Array, b: Uint8Array): number | undefined {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? undefined : n
}

function row(label: string, detail: string, base: Uint8Array, data: Uint8Array): ReplayRow {
  const diff = firstDifference(base, data)
  return {
    label,
    detail,
    hex: toHex(data, { sep: ' ', max: 16 }),
    identical: diff === undefined,
    ...(diff === undefined ? {} : { firstDifference: diff }),
  }
}

/**
 * Four runs off one seed: a fresh instance replays byte-exactly, a different
 * personalization does not, and neither does the same instance asked for two
 * halves instead of one whole (each request is its own SP 800-90A generate).
 */
export async function replayReport(
  seedLabel: string,
  personalization: string,
  bytes: number,
): Promise<ReplayReport> {
  const seed = seedBytes(seedLabel)
  const started = performance.now()
  const make = (personal: string) => drbgProvider({ seed, personalization: personal })

  const a = (await make(personalization).getBytes(bytes)).bytes
  const b = (await make(personalization).getBytes(bytes)).bytes

  const split = make(personalization)
  const half = Math.max(1, Math.floor(bytes / 2))
  const firstHalf = (await split.getBytes(half)).bytes
  const secondHalf = (await split.getBytes(bytes - half)).bytes
  const c = new Uint8Array(bytes)
  c.set(firstHalf, 0)
  c.set(secondHalf, half)

  const d = (await make(`${personalization} (other arm)`).getBytes(bytes)).bytes

  return {
    providerName: make(personalization).name,
    seedLength: seed.length,
    bytes,
    ms: performance.now() - started,
    rows: [
      row('Run A — the recorded run', `one getBytes(${bytes}) on a fresh provider`, a, a),
      row(
        'Run B — a new provider, same seed',
        `the replay: same seed, same personalization, same getBytes(${bytes})`,
        a,
        b,
      ),
      row(
        'Run C — same seed, split request',
        `getBytes(${half}) + getBytes(${bytes - half}) on one provider — a different sequence of request sizes`,
        a,
        c,
      ),
      row(
        'Run D — same seed, other personalization',
        'personalization is part of the instantiation, so it forks the stream',
        a,
        d,
      ),
    ],
  }
}

export interface SeedProbe {
  readonly ok: boolean
  readonly name?: string
  readonly error?: ErrorInfo
}

/** Construct a DRBG over `length` seed bytes — under 32 it must be rejected. */
export function probeSeedLength(length: number): SeedProbe {
  try {
    const provider = drbgProvider({ seed: new Uint8Array(length) })
    return { ok: true, name: provider.name }
  } catch (error) {
    return { ok: false, error: errorInfo(error) }
  }
}

export const CONTROL_SNIPPET = `import { drbgProvider } from '@mindpeeker/entropy/providers'

const seed = crypto.getRandomValues(new Uint8Array(48)) // record it with the experiment
const control = drbgProvider({ seed, personalization: 'session-42' })
control.name // 'hmac-drbg(seed:1a2b3c4d)' — first 4 bytes of SHA-256(seed)

// Replay: a NEW provider from the same seed, repeating the same request sizes.
const replay = drbgProvider({ seed, personalization: 'session-42' })
const same = await replay.getBytes(32)  // byte-identical to the recorded run`
