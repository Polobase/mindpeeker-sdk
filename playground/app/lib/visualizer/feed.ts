/**
 * Which bytes the live dashboard runs on, resolved through `~/lib/entropy`
 * only (so the header's source picker and DRBG seed govern this page too).
 *
 * Three modes:
 *
 * - `source` — the header-selected source. A local source (`crypto`, `jitter`,
 *   a seeded DRBG) is streamed directly. A **network beacon** cannot be: drand
 *   publishes 32 bytes every 3 s and `getBytes` re-reads the *same* round in
 *   between, so a fast poll would paint duplicate rows and feed the trial
 *   channel dependent bits. The honest expansion is explicit instead: draw one
 *   round, seed an SP 800-90A HMAC_DRBG with it, stream that. The panels then
 *   show a deterministic expansion of ~256 beacon bits, not fresh beacon
 *   entropy, and the noise panel's note says so.
 * - `local` — the browser CSPRNG at full rate, whatever the header says.
 * - `control` — an independent seeded DRBG: restart it and the identical path
 *   is replayed, which is what a control arm is for.
 *
 * CLIENT-ONLY: imports `~/lib/entropy`.
 */
import {
  drbgSource,
  getBytes,
  localProvider,
  localStream,
  provider,
  restartSource,
  sourceSummary,
  stream,
} from '~/lib/entropy'
import { toHex } from '~/lib/format'
import { currentSeedLabel } from '~/utils/sources'

export type FeedMode = 'source' | 'local' | 'control'

export interface Feed {
  readonly mode: FeedMode
  /** The provider's own name — what the trial recording's header records. */
  readonly providerName: string
  /** Short panel-title prefix: the noise panel is titled `<label> noise`. */
  readonly label: string
  /** One line for the noise panel's badge note. */
  readonly note: string
  /** True when the same run repeats byte for byte on a restart. */
  readonly deterministic: boolean
  /** True when a beacon round was expanded through a DRBG. */
  readonly seeded: boolean
  stream(opts: { chunkBytes: number; signal: AbortSignal }): AsyncIterable<Uint8Array>
}

/** Seed label of the reproducible control arm. */
export function controlSeedLabel(): string {
  return `${currentSeedLabel()} / visualizer control`
}

/** Bytes drawn from a beacon to seed the expansion (256 bits). */
export const BEACON_SEED_BYTES = 32

/**
 * Resolve a feed. Only the beacon path awaits anything (one `getBytes` draw);
 * pass the run's signal so a slow beacon can be cancelled.
 */
export async function resolveFeed(mode: FeedMode, signal: AbortSignal): Promise<Feed> {
  if (mode === 'local') {
    return {
      mode,
      providerName: localProvider.name,
      label: 'crypto',
      note: 'browser CSPRNG (crypto.getRandomValues) — full rate, not the header source',
      deterministic: false,
      seeded: false,
      stream: (opts) => localStream(opts),
    }
  }
  if (mode === 'control') {
    const label = controlSeedLabel()
    const source = drbgSource(label)
    return {
      mode,
      providerName: source.name,
      label: 'control DRBG',
      note: `reproducible HMAC_DRBG control arm · seed “${label}” — restart replays this path byte for byte`,
      deterministic: true,
      seeded: false,
      stream: (opts) => source.stream(opts),
    }
  }

  const summary = sourceSummary()
  if (!summary.network) {
    // A deterministic source is rewound so “same seed ⇒ same dashboard” holds.
    if (summary.deterministic) restartSource()
    return {
      mode,
      providerName: provider.name,
      label: summary.id,
      note: summary.deterministic
        ? `${summary.label} · seed “${summary.seedLabel ?? ''}” — restart replays this path byte for byte`
        : `${summary.label} — ${summary.note}`,
      deterministic: summary.deterministic,
      seeded: false,
      stream: (opts) => stream(opts),
    }
  }

  const seed = await getBytes(BEACON_SEED_BYTES, { signal })
  const hex = toHex(seed, { max: seed.length, sep: '' })
  const source = drbgSource(`visualizer / ${summary.id} / ${hex}`)
  return {
    mode,
    providerName: source.name,
    label: `${summary.id}-seeded`,
    note: `${BEACON_SEED_BYTES * 8} bits drawn through ${provider.name}, expanded by HMAC_DRBG — a deterministic expansion of one round, not fresh beacon entropy`,
    deterministic: true,
    seeded: true,
    stream: (opts) => source.stream(opts),
  }
}
