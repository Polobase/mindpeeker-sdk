// Client-only entropy access for every demo. It imports @mindpeeker/* (which
// resolves to package SOURCE through the Vite aliases in nuxt.config.ts), so it
// may be imported ONLY from `*.client.vue` components, from modules those
// components import, or from a Web Worker under app/workers/ — never from a
// page or an SSR-safe component.
//
// Two accessors:
//   getBytes / stream / withReader — the SELECTED source (header picker), with
//     a local CSPRNG fallback for network sources. Discrete draws use these.
//   localBytes / localStream       — always the browser CSPRNG, for high-rate
//     live panels a beacon could never feed.
//   drbgSource(label)              — an independent, reproducible control arm.

import type { EntropyProvider } from '@mindpeeker/entropy'
import { fallback } from '@mindpeeker/entropy'
import {
  anuLegacy,
  cryptoProvider,
  curby,
  drand,
  drbgProvider,
  jitterEntropy,
} from '@mindpeeker/entropy/providers'
import { type ByteReader, byteReader } from '@mindpeeker/oracle'
import {
  currentSeedLabel,
  currentSourceId,
  SEED_PREFIX,
  type SourceKind,
  sourceMeta,
} from '~/utils/sources'

const local = cryptoProvider()

/** Seed bytes for a label: the shared prefix keeps every seed ≥ 32 bytes. */
export function seedBytes(label: string): Uint8Array {
  return new TextEncoder().encode(`${SEED_PREFIX}${label}`)
}

/**
 * An independent deterministic provider (SP 800-90A HMAC_DRBG) for control
 * arms and replay: the same label always yields the same byte sequence for the
 * same sequence of requests. A DRBG is a control, never a secret.
 */
export function drbgSource(seedLabel: string): EntropyProvider {
  return drbgProvider({ seed: seedBytes(seedLabel) })
}

const MAKE: Record<string, () => EntropyProvider> = {
  drbg: () => drbgSource(currentSeedLabel()),
  jitter: () => jitterEntropy({ allowCoarseClock: true }),
  drand: () => drand(),
  curby: () => curby(),
  anu: () => anuLegacy(),
}

function build(): EntropyProvider {
  const id = currentSourceId()
  const make = MAKE[id]
  if (!make) return local
  const made = make()
  // Local sources are already reliable; only network sources get a fallback so
  // a blocked or slow beacon still completes the draw (and says so).
  return sourceMeta(id).network ? fallback([made, local], { attemptTimeoutMs: 3500 }) : made
}

let selected = build()

/**
 * The selected source. A stable object whose calls delegate to the current
 * provider, so `restartSource()` can rewind a deterministic source without
 * invalidating references held by components.
 */
export const provider: EntropyProvider = {
  get name() {
    return selected.name
  },
  get kind() {
    return selected.kind
  },
  get privacy() {
    return selected.privacy
  },
  getBytes: (length, opts) => selected.getBytes(length, opts),
  stream: (opts) => selected.stream(opts),
}

/** The browser CSPRNG, whatever the header says. */
export const localProvider: EntropyProvider = local

/**
 * Rebuild the selected provider. For the seeded DRBG this rewinds the stream to
 * its first byte, so a demo that wants "same seed ⇒ same result on every run"
 * calls it before each run; for every other source it is a no-op in practice.
 */
export function restartSource(): void {
  selected = build()
}

export async function getBytes(n: number, opts?: { signal?: AbortSignal }): Promise<Uint8Array> {
  return (await provider.getBytes(n, opts)).bytes
}

export async function localBytes(n: number, opts?: { signal?: AbortSignal }): Promise<Uint8Array> {
  return (await local.getBytes(n, opts)).bytes
}

/** The selected source as an AsyncIterable (oracle casts, scan, field). */
export function stream(opts?: { chunkBytes?: number; signal?: AbortSignal }) {
  return provider.stream(opts)
}

/** The local CSPRNG as an AsyncIterable — for high-rate live panels. */
export function localStream(opts?: { chunkBytes?: number; signal?: AbortSignal }) {
  return local.stream(opts)
}

export interface WithReaderOptions {
  signal?: AbortSignal
  chunkBytes?: number
  /** Draw from this provider instead of the selected source (e.g. a control arm). */
  source?: EntropyProvider
}

/**
 * Open an oracle `ByteReader` over the selected stream, hand it to `fn`, and
 * close it — on success, failure and abort alike, so a device session or socket
 * is always released. Several casts inside one `fn` share the reader and their
 * bytes stay disjoint.
 *
 * ```ts
 * const cast = await withReader((reader) => castHexagram(reader), { signal })
 * ```
 */
export async function withReader<T>(
  fn: (reader: ByteReader) => Promise<T>,
  opts: WithReaderOptions = {},
): Promise<T> {
  const reader = byteReader(opts.source ?? provider, {
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.chunkBytes ? { chunkBytes: opts.chunkBytes } : {}),
  })
  try {
    return await fn(reader)
  } finally {
    await reader.close().catch(() => {})
  }
}

export interface SourceSummary {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly kind: SourceKind
  readonly deterministic: boolean
  readonly network: boolean
  /** The provider's own name, e.g. `hmac-drbg(seed:1f2e3d4c)` or `fallback(drand, crypto)`. */
  readonly providerName: string
  /** The seed label behind a deterministic source. */
  readonly seedLabel?: string
}

/** Everything a demo needs to say which source produced a result. */
export function sourceSummary(): SourceSummary {
  const meta = sourceMeta()
  return {
    id: meta.id,
    label: meta.label,
    note: meta.note,
    kind: meta.kind,
    deterministic: meta.deterministic,
    network: meta.network,
    providerName: provider.name,
    ...(meta.deterministic ? { seedLabel: currentSeedLabel() } : {}),
  }
}
