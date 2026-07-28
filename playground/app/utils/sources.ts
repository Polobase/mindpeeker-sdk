// SSR-safe entropy-source metadata (no @mindpeeker imports, so the layout can
// use it during prerender). The actual providers live in ~/lib/entropy (client
// only). Selection is persisted in localStorage and applied on reload.

export interface SourceMeta {
  readonly id: string
  readonly label: string
  readonly note: string
}

export const SOURCE_META: readonly SourceMeta[] = [
  { id: 'crypto', label: 'Browser CSPRNG', note: 'crypto.getRandomValues — local, instant' },
  { id: 'jitter', label: 'CPU timing jitter', note: 'local hardware timing noise' },
  { id: 'drand', label: 'drand beacon', note: 'League of Entropy — public, ~3 s rounds' },
  { id: 'curby', label: 'CURBy — quantum', note: 'CU Boulder quantum Bell-test beacon' },
  { id: 'anu', label: 'ANU — quantum vacuum', note: 'ANU quantum RNG (may be CORS-blocked)' },
]

const KEY = 'mp-entropy-source'

export function currentSourceId(): string {
  if (typeof localStorage === 'undefined') return 'crypto'
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
    // ignore
  }
}

export function sourceLabel(id: string): string {
  return SOURCE_META.find((s) => s.id === id)?.label ?? 'Browser CSPRNG'
}
