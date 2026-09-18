/**
 * The six channels the `mindpeeker-viz` demo publishes, expressed as a
 * protocol-2 channel directory the bundled WebGL2 client can consume directly.
 *
 * The CLI builds this through `createDashboard(...).attach*()`, which sends
 * the directory as JSON over the socket; in the browser there is no socket, so
 * the driver hands the very same `DirectoryMessage` to `mountDashboard`'s
 * `applyDirectory`. Names, band labels and the rate-card geometry are the
 * CLI's (`src/demo.ts`: `CHANNEL_LABELS`, `SAMPLE_RATE_CARD`), kept here
 * because `src/demo.ts` itself is Bun-only (`node:fs`, `node:path`).
 *
 * CLIENT-ONLY: imports `@viz/*`.
 */
import { BAND_LABELS } from '@viz/src/demo/monitor'
import { PROTOCOL_VERSION } from '@viz/src/protocol'
import type {
  ChannelInfo,
  ChannelKind,
  ChannelStatus,
  DirectoryMessage,
  RateCardGeometry,
} from '@viz/src/types'

/** Channel ids — the `u16` every binary frame carries in its header. */
export const CHANNEL = Object.freeze({
  noise: 0,
  negentropy: 1,
  cumdev: 2,
  netvar: 3,
  histogram: 4,
  rateCard: 5,
})

/** Panel titles, verbatim from the CLI demo (`CHANNEL_LABELS` in `src/demo.ts`). */
export const CHANNEL_LABELS = Object.freeze({
  negentropy: 'windowed negentropy (logcosh)',
  cumdev: 'cumulative deviation · pointwise χ² band and anytime-valid boundary',
  netvar: 'running netvar Z of the Stouffer Z series',
  histogram: 'byte histogram',
  rateCard: 'rate card',
})

/** The CLI's sample Malcolm Rae base-44 layout (`SAMPLE_RATE_CARD` in `src/demo.ts`). */
export const SAMPLE_RATE_CARD: RateCardGeometry = Object.freeze({
  type: 'rate-card',
  sectors: 44,
  rings: Object.freeze([0.3, 0.5, 0.7, 0.9]) as readonly number[],
  pointerSector: 17,
  label: 'sample base-44 rate card',
})

/** Bytes per source chunk and the CLI's own pause between chunks. */
export const SOURCE_CHUNK_BYTES = 256
export const SOURCE_INTERVAL_MS = 50

/** Window and hop of the negentropy channel, as the CLI configures them. */
export const NEGENTROPY_WINDOW = 512
export const NEGENTROPY_HOP = 128

/** Histogram bins (width 8 over the byte range) and the per-chunk decay. */
export const HISTOGRAM_BINS = 32
export const HISTOGRAM_DECAY = 0.9

/** What the directory builder needs to know about the current run. */
export interface DirectoryState {
  /** Noise panel title, e.g. `crypto noise` — the provider name, like the CLI. */
  readonly noiseName: string
  /** Status of the five streaming channels. */
  readonly status: ChannelStatus
  /** Reason shown on the badge while `status` is `error`. */
  readonly error?: string
  /** Producer note on the noise panel (source description / health text). */
  readonly noiseNote?: string
  /** Producer note under the cumulative-deviation caption (e.g. the recording head). */
  readonly cumdevNote?: string
  /** Producer note under the netvar caption — the CLI puts the anytime p here. */
  readonly netvarNote?: string
}

/**
 * Build the protocol-2 directory for the six demo channels. `bandLabels` is a
 * protocol-2 field: it is what puts `two-sided 90% pointwise` and
 * `anytime-valid (α = 0.05)` in the chart legend, and a protocol-1 client
 * would neither receive it nor the kind-4 frames the labels describe.
 */
export function buildDirectory(state: DirectoryState): DirectoryMessage {
  const streaming = (
    id: number,
    name: string,
    kind: ChannelKind,
    extra: Partial<ChannelInfo> = {},
  ): ChannelInfo => ({
    id,
    name,
    kind,
    status: state.status,
    ...(state.status === 'error' && state.error ? { error: state.error } : {}),
    ...extra,
  })
  const channels: readonly ChannelInfo[] = [
    streaming(
      CHANNEL.noise,
      `${state.noiseName} noise`,
      'bytes',
      state.noiseNote ? { note: state.noiseNote } : {},
    ),
    streaming(CHANNEL.negentropy, CHANNEL_LABELS.negentropy, 'series'),
    streaming(CHANNEL.cumdev, CHANNEL_LABELS.cumdev, 'series', {
      bandLabels: [BAND_LABELS.pointwise, BAND_LABELS.anytime],
      ...(state.cumdevNote ? { note: state.cumdevNote } : {}),
    }),
    streaming(CHANNEL.netvar, CHANNEL_LABELS.netvar, 'series', {
      bandLabels: [BAND_LABELS.pointwise],
      ...(state.netvarNote ? { note: state.netvarNote } : {}),
    }),
    streaming(CHANNEL.histogram, CHANNEL_LABELS.histogram, 'matrix', {
      colLabels: histogramLabels(),
    }),
    { id: CHANNEL.rateCard, name: CHANNEL_LABELS.rateCard, kind: 'static', status: 'live' },
  ]
  return { type: 'directory', version: PROTOCOL_VERSION, channels }
}

/** Column labels of the histogram matrix: the low edge of each 8-wide bin. */
export function histogramLabels(): readonly string[] {
  return Array.from({ length: HISTOGRAM_BINS }, (_, i) => `${i * 8}`)
}
