// Which entropy source a section of the oracle page draws from. CLIENT-ONLY
// (it imports ~/lib/entropy, which imports the SDK).
//
// Single ceremonial casts always use the header-selected source. Frequency
// checks need thousands of bytes, and a beacon delivers one network round per
// 32 bytes, so those sections offer three arms:
//
//   selected — the header source (the default whenever it is local)
//   local    — the browser CSPRNG, for the long runs
//   control  — an independent seeded DRBG: same seed ⇒ same histogram

import type { EntropyProvider } from '@mindpeeker/entropy'
import { drbgSource, localProvider, sourceSummary } from '~/lib/entropy'
import { currentSeedLabel, sourceMeta } from '~/utils/sources'

export type SampleSourceId = 'selected' | 'local' | 'control'

export interface SampleSourceOption {
  readonly label: string
  readonly value: SampleSourceId
}

/** Label for the seeded control arm — independent of the header's DRBG stream. */
export const CONTROL_SEED_SUFFIX = ' / oracle control'

/** Select items for a "sample from" picker, labelled with the live source names. */
export function sampleSourceOptions(): SampleSourceOption[] {
  const summary = sourceSummary()
  return [
    { label: `Selected source — ${summary.label}`, value: 'selected' },
    { label: 'Local CSPRNG — fast, for long runs', value: 'local' },
    {
      label: `Seeded DRBG control — ${currentSeedLabel()}${CONTROL_SEED_SUFFIX}`,
      value: 'control',
    },
  ]
}

/**
 * The provider to draw from, or `undefined` for "the selected source" (which
 * `withReader` uses when no `source` is given).
 */
export function sampleProvider(id: SampleSourceId): EntropyProvider | undefined {
  if (id === 'local') return localProvider
  // A fresh DRBG per run, so the same seed replays the same histogram.
  if (id === 'control') return drbgSource(`${currentSeedLabel()}${CONTROL_SEED_SUFFIX}`)
  return undefined
}

/** Provider name for the accounting badge (the DRBG names itself by seed digest). */
export function sampleSourceName(id: SampleSourceId): string {
  if (id === 'selected') return sourceSummary().providerName
  const provider = sampleProvider(id)
  return provider?.name ?? sourceSummary().providerName
}

/** True when the arm fetches over the network (only the selected source can). */
export function isNetworkSample(id: SampleSourceId): boolean {
  return id === 'selected' && sourceMeta().network
}

/** The selected source, unless it is a beacon — then the local CSPRNG. */
export function defaultSampleSource(): SampleSourceId {
  return sourceMeta().network ? 'local' : 'selected'
}

/**
 * Whether a demo may cast on mount: a network beacon should never fire
 * requests before the visitor asked for a reading.
 */
export function autoRunAllowed(): boolean {
  return !sourceMeta().network
}

/** `≈ 360 B — one drand round per 32 B` — the price of a run, before it runs. */
export function sampleHint(id: SampleSourceId, bytes: number): string {
  const size = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${Math.round(bytes)} B`
  if (!isNetworkSample(id)) return `≈ ${size} from ${sampleSourceName(id)}`
  return `≈ ${size} from ${sourceMeta().label} — a beacon serves ~32 B per network round`
}
