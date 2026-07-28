// Client-side entropy for every demo. The *source* is selectable (persisted in
// localStorage, applied on reload): the browser CSPRNG by default, or a public
// beacon / quantum RNG. Non-local sources are wrapped in a crypto `fallback`, so
// a blocked or rate-limited network source degrades gracefully instead of
// breaking a demo.
//
// Two accessors:
//   getBytes / stream   — the SELECTED source (with crypto fallback). Discrete
//                         draws (oracle, rate, field, gematria, scan) use these.
//   localBytes / localStream — always the browser CSPRNG, for the high-rate live
//                         panels (visualizer, negentropy, psi, flow) where a
//                         network source could not keep up.

import type { EntropyProvider } from '@mindpeeker/entropy'
import { fallback } from '@mindpeeker/entropy'
import {
  anuLegacy,
  cryptoProvider,
  curby,
  drand,
  jitterEntropy,
} from '@mindpeeker/entropy/providers'

export interface SourceDef {
  readonly id: string
  readonly label: string
  readonly note: string
  /** Absent for the local CSPRNG; present for selectable alternatives. */
  readonly make?: () => EntropyProvider
}

export const SOURCES: readonly SourceDef[] = [
  { id: 'crypto', label: 'Browser CSPRNG', note: 'crypto.getRandomValues — local, instant' },
  {
    id: 'jitter',
    label: 'CPU timing jitter',
    note: 'local hardware timing noise (supplementary)',
    make: () => jitterEntropy({ allowCoarseClock: true }),
  },
  {
    id: 'drand',
    label: 'drand beacon',
    note: 'League of Entropy — public, verifiable, ~3 s rounds (network)',
    make: () => drand(),
  },
  {
    id: 'curby',
    label: 'CURBy — quantum',
    note: 'CU Boulder quantum Bell-test beacon (network)',
    make: () => curby(),
  },
  {
    id: 'anu',
    label: 'ANU — quantum vacuum',
    note: 'ANU quantum RNG (network; may be blocked by CORS)',
    make: () => anuLegacy(),
  },
]

const KEY = 'mp-entropy-source'

export function currentSourceId(): string {
  try {
    return localStorage.getItem(KEY) || 'crypto'
  } catch {
    return 'crypto'
  }
}

export function setSourceId(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // ignore (private mode / disabled storage) — the default source still works
  }
}

export function sourceLabel(): string {
  return SOURCES.find((s) => s.id === currentSourceId())?.label ?? 'Browser CSPRNG'
}

const local = cryptoProvider()

function build(): EntropyProvider {
  const def = SOURCES.find((s) => s.id === currentSourceId())
  if (!def?.make) return local
  // Selected source first, then the local CSPRNG — a blocked/slow network source
  // times out (3.5 s) and the draw still completes.
  return fallback([def.make(), local], { attemptTimeoutMs: 3500 })
}

/** The selected source (with automatic crypto fallback). For discrete draws. */
export const provider = build()

export async function getBytes(n: number): Promise<Uint8Array> {
  const { bytes } = await provider.getBytes(n)
  return bytes
}

export function stream(opts?: { chunkBytes?: number; signal?: AbortSignal }) {
  return provider.stream(opts)
}

/** The local browser CSPRNG — always fast, for high-rate live panels. */
export async function localBytes(n: number): Promise<Uint8Array> {
  const { bytes } = await local.getBytes(n)
  return bytes
}

export function localStream(opts?: { chunkBytes?: number; signal?: AbortSignal }) {
  return local.stream(opts)
}
