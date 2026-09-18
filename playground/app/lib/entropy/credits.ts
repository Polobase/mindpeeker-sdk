// Conditioning credit arithmetic: how many raw bytes back one 32-byte block,
// and what the 0.2.0 validation now rejects at construction.
// CLIENT-ONLY (it imports @mindpeeker/entropy/providers).

import { serialEntropy } from '@mindpeeker/entropy/providers'
import { errorInfo, type ErrorInfo } from '~/lib/errors'

const BLOCK_BITS = 256
const BLOCK_BYTES = 32

export interface CreditRow {
  readonly provider: string
  /** Credited min-entropy in bits per raw sample byte. */
  readonly h: number
  readonly safetyFactor: number
  /** Health tests run at this H when it is stricter than the credit. */
  readonly healthH?: number
  readonly note: string
}

/** The per-provider defaults, read from each provider's `sampledProvider` spec. */
export const PROVIDER_CREDITS: readonly CreditRow[] = [
  { provider: 'serialEntropy (ESP32/TrueRNG)', h: 7, safetyFactor: 2, note: 'measured 7.06 b/B raw' },
  { provider: 'hwRng (/dev/hwrng)', h: 7, safetyFactor: 2, note: 'kernel-trusted device' },
  { provider: 'micEntropy', h: 2, safetyFactor: 4, note: 'measured 7.40 b/B raw — 3.7× margin' },
  { provider: 'cameraEntropy', h: 1, safetyFactor: 8, note: 'measured 7.02 b/B raw — 7× margin' },
  { provider: 'sdrEntropy', h: 1, safetyFactor: 4, note: 'RF-injectable — mixing tier' },
  {
    provider: 'jitterEntropy (Node hrtime)',
    h: 0.0625,
    safetyFactor: 2,
    note: 'measured MCV 1.29 b/B — 20× margin',
  },
  {
    provider: 'jitterEntropy (browser, coarse)',
    h: 0.01,
    safetyFactor: 2,
    healthH: 0.0625,
    note: 'unquantified entropy: mix it, never use it alone',
  },
  {
    provider: 'sensorEntropy',
    h: 0.25,
    safetyFactor: 4,
    healthH: 1,
    note: '0.75 bits per 3-axis event; browsers quantize hard',
  },
]

/** SP 800-90B §4: raw bytes pooled per 32-byte output block, ⌈S·256/H⌉. */
export function bytesPerBlock(h: number, safetyFactor: number): number {
  return Math.ceil((safetyFactor * BLOCK_BITS) / h)
}

export interface CreditPlan {
  readonly bytesPerBlock: number
  readonly creditedBits: number
  /** Raw bytes read per output byte. */
  readonly expansion: number
  /** Accepted by the provider's construction-time validation. */
  readonly ok: boolean
  readonly error?: ErrorInfo
}

/**
 * Ask the SDK itself whether a (H, safetyFactor) pair is legal: the options
 * are validated inside the factory, so this is the real answer, not a copy of
 * the rule. A dummy byte source is never pulled — construction fails first.
 */
export function probeCredit(h: number, safetyFactor: number): CreditPlan {
  const planned = bytesPerBlock(h, safetyFactor)
  const creditedBits = safetyFactor * BLOCK_BITS
  const expansion = planned / BLOCK_BYTES
  try {
    serialEntropy({
      source: emptySource(),
      name: 'credit-probe',
      minEntropyPerSample: h,
      safetyFactor,
    })
    return { bytesPerBlock: planned, creditedBits, expansion, ok: true }
  } catch (error) {
    return {
      bytesPerBlock: planned,
      creditedBits,
      expansion,
      ok: false,
      error: errorInfo(error),
    }
  }
}

async function* emptySource(): AsyncGenerator<Uint8Array> {
  // Never pulled: the factory validates its options before opening a session.
}

export interface CreditPreset {
  readonly label: string
  readonly h: number
  readonly safetyFactor: number
  readonly why: string
}

export const CREDIT_PRESETS: readonly CreditPreset[] = [
  {
    label: 'serial defaults',
    h: 7,
    safetyFactor: 2,
    why: 'the ESP32 credit: 74 raw bytes per 32-byte block.',
  },
  {
    label: 'SP 800-90C margin',
    h: 7,
    safetyFactor: 1.25,
    why: 'the smallest factor carrying the SP 800-90C full-entropy margin.',
  },
  {
    label: 'jitter credit',
    h: 0.0625,
    safetyFactor: 2,
    why: '1/16 bit per timing delta: 8,192 raw bytes per block.',
  },
  {
    label: 'safetyFactor 0 — the 0.1 bug',
    h: 7,
    safetyFactor: 0,
    why: 'in 0.1 this made every block the constant SHA-256(""); 0.2.0 rejects it at construction.',
  },
  {
    label: 'H = 9 — over the ceiling',
    h: 9,
    safetyFactor: 2,
    why: 'a byte cannot carry more than 8 bits; 0.1 over-credited it.',
  },
]

/** The constant every block became when the 0.1 pool loop hashed nothing. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** Recompute SHA-256("") in the browser, so the constant above is checkable. */
export async function sha256OfEmpty(): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(0))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const CREDIT_SNIPPET = `import { serialEntropy } from '@mindpeeker/entropy/providers'

// Pool safetyFactor × 256 credited bits before emitting each 32-byte block:
// ⌈2 × 256 / 7⌉ = 74 raw bytes per block at the ESP32 credit.
const hw = serialEntropy({ port, minEntropyPerSample: 7, safetyFactor: 2 })

// 0.2.0 validates at construction — EntropyError('invalid_request'):
serialEntropy({ port, safetyFactor: 0 })        // was: every block = SHA-256('')
serialEntropy({ port, minEntropyPerSample: 9 }) // was: silently over-credited`
