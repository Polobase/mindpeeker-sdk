/**
 * Per-channel server state and its wire renditions: the directory JSON for a
 * negotiated protocol version, retained frames encoded for protocol 1 and 2,
 * and producer-emission normalization. Pure (no Bun APIs).
 */
import { VisualizerError } from '../errors.js'
import type { RingBuffer } from '../internal/ring.js'
import { encodeSeriesFrame, isValidRange } from '../protocol.js'
import type {
  ChannelInfo,
  ChannelKind,
  ChannelStatus,
  DirectoryMessage,
  MatrixFrameInput,
  SeriesPoint,
  SeriesSample,
} from '../types.js'

/**
 * One retained frame in the encodings sockets may need. For kinds 1–3 both
 * fields are the same bytes; a multi-band series emission has a kind-4 `v2`
 * and a kind-2 `v1` downgrade carrying the first band.
 */
export interface Frame {
  readonly v1: Uint8Array
  readonly v2: Uint8Array
}

/** A frame every protocol version decodes identically. */
export function sharedFrame(bytes: Uint8Array): Frame {
  return { v1: bytes, v2: bytes }
}

/** The encoding of `frame` for a socket that negotiated `version`. */
export function rendition(frame: Frame, version: number): Uint8Array {
  return version >= 2 ? frame.v2 : frame.v1
}

/** Mutable server-side state of one channel. */
export interface Channel {
  readonly id: number
  readonly name: string
  readonly kind: ChannelKind
  status: ChannelStatus
  error?: string
  note?: string
  rowLabels?: readonly string[]
  colLabels?: readonly string[]
  range?: readonly [number, number]
  bandLabels?: readonly string[]
  /** JSON of the last published labels/range, for change detection. */
  metaKey: string
  readonly ring: RingBuffer<Frame>
  /** Pre-serialized `static` text frame (static channels only). */
  staticText?: string
}

/**
 * The directory JSON for a socket speaking `version`: protocol 1 omits
 * `bandLabels` (its frames carry only the first band).
 */
export function directoryText(channels: Iterable<Channel>, version: number): string {
  const list: ChannelInfo[] = [...channels].map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    status: c.status,
    ...(c.rowLabels ? { rowLabels: c.rowLabels } : {}),
    ...(c.colLabels ? { colLabels: c.colLabels } : {}),
    ...(c.range ? { range: c.range } : {}),
    ...(c.bandLabels && version >= 2 ? { bandLabels: c.bandLabels } : {}),
    ...(c.status === 'error' && c.error !== undefined ? { error: c.error } : {}),
    ...(c.note !== undefined ? { note: c.note } : {}),
  }))
  const message: DirectoryMessage = { type: 'directory', version, channels: list }
  return JSON.stringify(message)
}

/** Validate optional matrix labels; a frozen copy, or `undefined` when absent. */
export function labelList(
  value: unknown,
  field: string,
  channel: string,
): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((label) => typeof label === 'string')) {
    throw new VisualizerError('protocol', `matrix ${field} must be an array of strings`, {
      channel,
    })
  }
  return Object.freeze([...value])
}

/** The directory metadata one matrix emission carries (validated, frozen). */
export function matrixMeta(
  frame: MatrixFrameInput,
  channel: string,
): Pick<Channel, 'rowLabels' | 'colLabels' | 'range'> {
  const rowLabels = labelList(frame.rowLabels, 'rowLabels', channel)
  const colLabels = labelList(frame.colLabels, 'colLabels', channel)
  if (frame.range !== undefined && !isValidRange(frame.range)) {
    throw new VisualizerError('protocol', 'matrix range must be a finite [lo, hi] with lo < hi', {
      channel,
    })
  }
  const range = frame.range ? Object.freeze([frame.range[0], frame.range[1]] as const) : undefined
  return { rowLabels, colLabels, range }
}

/** One series emission, normalized and encoded for both protocol versions. */
export interface SeriesEmission {
  readonly frame: Frame
  /** Band labels (`''` when unlabeled) when the sample carried `bands`. */
  readonly bandLabels?: readonly string[]
}

/**
 * Normalize a producer's {@link SeriesSample} (a bare number takes `autoT` as
 * its `t`) and encode it. A sample with `bands` yields a kind-4 `v2` frame, a
 * kind-2 `v1` downgrade and its labels; anything else one shared kind-2 frame.
 *
 * @throws {VisualizerError} `protocol` for malformed `bands` (see
 *   `encodeSeriesFrame`), tagged with the channel name.
 */
export function seriesEmission(
  channelId: number,
  channel: string,
  sample: SeriesSample,
  autoT: number,
): SeriesEmission {
  if (typeof sample === 'number') {
    return { frame: sharedFrame(encodeSeriesFrame(channelId, [{ t: autoT, value: sample }])) }
  }
  const t = sample.t ?? autoT
  try {
    if (sample.bands === undefined) {
      const point: SeriesPoint = { t, value: sample.value, band: sample.band }
      return { frame: sharedFrame(encodeSeriesFrame(channelId, [point])) }
    }
    const point: SeriesPoint = {
      t,
      value: sample.value,
      bands: sample.bands,
      ...(sample.band !== undefined && { band: sample.band }),
    }
    const v2 = encodeSeriesFrame(channelId, [point])
    const v1 = encodeSeriesFrame(channelId, [point], { version: 1 })
    const bandLabels = Object.freeze(sample.bands.map((band) => band.label ?? ''))
    return { frame: { v1, v2 }, bandLabels }
  } catch (error) {
    if (error instanceof VisualizerError && error.code === 'protocol') {
      throw new VisualizerError('protocol', error.message, { channel, cause: error })
    }
    throw error
  }
}
