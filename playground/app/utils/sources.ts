// SSR-safe entropy-source metadata and preferences (no @mindpeeker imports, so
// the layout can use it during prerender). The providers themselves live in
// ~/lib/entropy, which is imported only from client-only code.
//
// The selection and the DRBG seed are persisted in localStorage and applied on
// reload (a demo builds its provider once, at mount).

export type SourceKind = 'csprng' | 'trng' | 'beacon' | 'qrng'

export interface SourceMeta {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly kind: SourceKind
  /** Same seed + same requests ⇒ same bytes. */
  readonly deterministic: boolean
  /** Needs the network (and falls back to the local CSPRNG when blocked). */
  readonly network: boolean
}

export const SOURCE_META: readonly SourceMeta[] = [
  {
    id: 'crypto',
    label: 'Browser CSPRNG',
    note: 'crypto.getRandomValues — local, instant',
    kind: 'csprng',
    deterministic: false,
    network: false,
  },
  {
    id: 'drbg',
    label: 'Seeded DRBG (reproducible)',
    note: 'SP 800-90A HMAC_DRBG over the seed below — a deterministic control, never a secret',
    kind: 'csprng',
    deterministic: true,
    network: false,
  },
  {
    id: 'jitter',
    label: 'CPU timing jitter',
    note: 'local hardware timing noise (coarse browser clock)',
    kind: 'trng',
    deterministic: false,
    network: false,
  },
  {
    id: 'drand',
    label: 'drand beacon',
    note: 'League of Entropy — public, verifiable, ~3 s rounds',
    kind: 'beacon',
    deterministic: false,
    network: true,
  },
  {
    id: 'curby',
    label: 'CURBy — quantum',
    note: 'CU Boulder + NIST quantum Bell-test beacon (public)',
    kind: 'beacon',
    deterministic: false,
    network: true,
  },
  {
    id: 'anu',
    label: 'ANU — quantum vacuum',
    note: 'ANU quantum RNG, 1 request/minute (may be CORS-blocked)',
    kind: 'qrng',
    deterministic: false,
    network: true,
  },
]

const SOURCE_KEY = 'mp-entropy-source'
const SEED_KEY = 'mp-drbg-seed'

export const DEFAULT_SOURCE_ID = 'crypto'
export const DEFAULT_SEED_LABEL = 'mindpeeker playground'

/**
 * Prefix in front of every seed label, so even a one-character label yields the
 * ≥ 32 seed bytes `drbgProvider` requires (mirrors the cookbook's helper).
 */
export const SEED_PREFIX = 'mindpeeker playground drbg seed v1 / '

export function currentSourceId(): string {
  try {
    const stored = localStorage.getItem(SOURCE_KEY)
    return stored && SOURCE_META.some((s) => s.id === stored) ? stored : DEFAULT_SOURCE_ID
  } catch {
    return DEFAULT_SOURCE_ID
  }
}

export function setSourceId(id: string): void {
  try {
    localStorage.setItem(SOURCE_KEY, id)
  } catch {
    // private mode / storage disabled — the default source still works
  }
}

/** The editable seed label behind the deterministic DRBG source. */
export function currentSeedLabel(): string {
  try {
    return localStorage.getItem(SEED_KEY) || DEFAULT_SEED_LABEL
  } catch {
    return DEFAULT_SEED_LABEL
  }
}

export function setSeedLabel(label: string): void {
  const value = label.trim() || DEFAULT_SEED_LABEL
  try {
    localStorage.setItem(SEED_KEY, value)
  } catch {
    // ignore
  }
}

export function sourceMeta(id: string = currentSourceId()): SourceMeta {
  return SOURCE_META.find((s) => s.id === id) ?? (SOURCE_META[0] as SourceMeta)
}

export function sourceLabel(id: string = currentSourceId()): string {
  return sourceMeta(id).label
}

export function isDeterministicSource(id: string = currentSourceId()): boolean {
  return sourceMeta(id).deterministic
}
