/**
 * Binary wire protocol shared verbatim by the Bun server and the browser
 * client — pure functions over typed arrays, no runtime APIs, so the same
 * module bundles into the client and unit-tests headlessly.
 *
 * Frame layout (all multi-byte integers and floats little-endian, written
 * explicitly through `DataView` so the encoding is platform-independent):
 *
 * ```
 * [u8 version = 1][u8 kind][u16 channelId][payload…]
 * ```
 *
 * - kind 1 (`bytes`):  payload is the raw byte chunk.
 * - kind 2 (`series`): payload is repeated 32-byte points
 *   `(f64 t, f64 value, f64 lo, f64 hi)`; an absent band is encoded as
 *   `lo = hi = NaN` (NaN survives IEEE 754 round-trips, and no meaningful
 *   band bound is NaN, so no escape byte is needed).
 * - kind 3 (`matrix`): payload is `u16 rows, u16 cols` followed by
 *   `rows·cols` row-major `f32` values.
 *
 * JSON text frames ({@link TextMessage}) carry the channel directory and
 * static documents; everything high-rate is binary.
 */
import { VisualizerError } from './errors.js'
import type { SeriesPoint, TextMessage } from './types.js'

/** Version byte every frame starts with. Bump on any incompatible change. */
export const PROTOCOL_VERSION = 1

/** Frame kind bytes. Frozen data table, not an enum, per SDK style. */
export const FRAME_KIND = Object.freeze({
  bytes: 1,
  series: 2,
  matrix: 3,
} as const)

/** Fixed header size: version, kind, channel id. */
export const HEADER_BYTES = 4
/** Encoded size of one series point: four `f64`s. */
export const SERIES_POINT_BYTES = 32
/** Matrix payload prefix: `u16 rows` + `u16 cols`. */
export const MATRIX_PREFIX_BYTES = 4

/** A decoded binary frame, discriminated on `kind`. */
export type DecodedFrame =
  | { readonly kind: 'bytes'; readonly channelId: number; readonly bytes: Uint8Array }
  | { readonly kind: 'series'; readonly channelId: number; readonly points: readonly SeriesPoint[] }
  | {
      readonly kind: 'matrix'
      readonly channelId: number
      readonly rows: number
      readonly cols: number
      readonly data: Float32Array
    }

function checkChannelId(channelId: number): void {
  if (!Number.isInteger(channelId) || channelId < 0 || channelId > 0xffff) {
    throw new VisualizerError('invalid_channel', `channel id must be a u16, got ${channelId}`)
  }
}

function header(kind: number, channelId: number, payloadBytes: number): DataView {
  const view = new DataView(new ArrayBuffer(HEADER_BYTES + payloadBytes))
  view.setUint8(0, PROTOCOL_VERSION)
  view.setUint8(1, kind)
  view.setUint16(2, channelId, true)
  return view
}

/** Encode a raw byte chunk (kind 1) for a `bytes` channel. */
export function encodeBytesFrame(channelId: number, bytes: Uint8Array): Uint8Array {
  checkChannelId(channelId)
  const view = header(FRAME_KIND.bytes, channelId, bytes.length)
  const out = new Uint8Array(view.buffer)
  out.set(bytes, HEADER_BYTES)
  return out
}

/**
 * Encode series points (kind 2). Each point is `(t, value, lo, hi)` as four
 * little-endian `f64`s; a missing band becomes `lo = hi = NaN`.
 */
export function encodeSeriesFrame(channelId: number, points: readonly SeriesPoint[]): Uint8Array {
  checkChannelId(channelId)
  const view = header(FRAME_KIND.series, channelId, points.length * SERIES_POINT_BYTES)
  let offset = HEADER_BYTES
  for (const point of points) {
    view.setFloat64(offset, point.t, true)
    view.setFloat64(offset + 8, point.value, true)
    view.setFloat64(offset + 16, point.band ? point.band[0] : Number.NaN, true)
    view.setFloat64(offset + 24, point.band ? point.band[1] : Number.NaN, true)
    offset += SERIES_POINT_BYTES
  }
  return new Uint8Array(view.buffer)
}

/**
 * Encode a dense row-major matrix (kind 3). `rows`/`cols` must be `u16`s in
 * $[1, 65535]$ and `data.length` must equal `rows * cols`.
 */
export function encodeMatrixFrame(
  channelId: number,
  frame: { readonly rows: number; readonly cols: number; readonly data: Float32Array },
): Uint8Array {
  checkChannelId(channelId)
  const { rows, cols, data } = frame
  const validDim = (n: number) => Number.isInteger(n) && n >= 1 && n <= 0xffff
  if (!validDim(rows) || !validDim(cols)) {
    throw new VisualizerError('protocol', `matrix dims must be u16 ≥ 1, got ${rows}×${cols}`)
  }
  if (data.length !== rows * cols) {
    throw new VisualizerError(
      'protocol',
      `matrix data length ${data.length} does not match ${rows}×${cols}`,
    )
  }
  const view = header(FRAME_KIND.matrix, channelId, MATRIX_PREFIX_BYTES + 4 * data.length)
  view.setUint16(HEADER_BYTES, rows, true)
  view.setUint16(HEADER_BYTES + 2, cols, true)
  let offset = HEADER_BYTES + MATRIX_PREFIX_BYTES
  for (let i = 0; i < data.length; i++) {
    view.setFloat32(offset, data[i] as number, true)
    offset += 4
  }
  return new Uint8Array(view.buffer)
}

/**
 * Decode one binary frame. Throws `VisualizerError('protocol', …)` on any
 * malformed input: wrong version, unknown kind, truncated header, a series
 * payload that is not a multiple of 32 bytes, or a matrix payload whose size
 * disagrees with its declared dimensions. Handles `Uint8Array`s that view a
 * larger buffer at any alignment (floats are read through `DataView`, never
 * by typed-array aliasing, so decoding is endianness- and alignment-safe).
 */
export function decodeFrame(frame: Uint8Array): DecodedFrame {
  if (frame.byteLength < HEADER_BYTES) {
    throw new VisualizerError('protocol', `frame too short: ${frame.byteLength} bytes`)
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const version = view.getUint8(0)
  if (version !== PROTOCOL_VERSION) {
    throw new VisualizerError('protocol', `unsupported protocol version ${version}`)
  }
  const kind = view.getUint8(1)
  const channelId = view.getUint16(2, true)
  const payloadBytes = frame.byteLength - HEADER_BYTES

  if (kind === FRAME_KIND.bytes) {
    return { kind: 'bytes', channelId, bytes: frame.slice(HEADER_BYTES) }
  }

  if (kind === FRAME_KIND.series) {
    if (payloadBytes % SERIES_POINT_BYTES !== 0) {
      throw new VisualizerError(
        'protocol',
        `series payload ${payloadBytes} is not a multiple of ${SERIES_POINT_BYTES}`,
      )
    }
    const points: SeriesPoint[] = []
    for (let offset = HEADER_BYTES; offset < frame.byteLength; offset += SERIES_POINT_BYTES) {
      const t = view.getFloat64(offset, true)
      const value = view.getFloat64(offset + 8, true)
      const lo = view.getFloat64(offset + 16, true)
      const hi = view.getFloat64(offset + 24, true)
      const band = Number.isNaN(lo) || Number.isNaN(hi) ? undefined : ([lo, hi] as const)
      points.push(band ? { t, value, band } : { t, value })
    }
    return { kind: 'series', channelId, points }
  }

  if (kind === FRAME_KIND.matrix) {
    if (payloadBytes < MATRIX_PREFIX_BYTES) {
      throw new VisualizerError('protocol', 'matrix frame missing rows/cols prefix')
    }
    const rows = view.getUint16(HEADER_BYTES, true)
    const cols = view.getUint16(HEADER_BYTES + 2, true)
    const expected = MATRIX_PREFIX_BYTES + 4 * rows * cols
    if (rows < 1 || cols < 1 || payloadBytes !== expected) {
      throw new VisualizerError(
        'protocol',
        `matrix payload ${payloadBytes} does not match declared ${rows}×${cols}`,
      )
    }
    const data = new Float32Array(rows * cols)
    let offset = HEADER_BYTES + MATRIX_PREFIX_BYTES
    for (let i = 0; i < data.length; i++) {
      data[i] = view.getFloat32(offset, true)
      offset += 4
    }
    return { kind: 'matrix', channelId, rows, cols, data }
  }

  throw new VisualizerError('protocol', `unknown frame kind ${kind}`)
}

const CHANNEL_KINDS: ReadonlySet<string> = new Set(['bytes', 'series', 'matrix', 'static'])
const CHANNEL_STATUSES: ReadonlySet<string> = new Set(['live', 'ended', 'error'])

function protocolError(message: string): VisualizerError {
  return new VisualizerError('protocol', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isU16(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff
}

/**
 * `true` when `value` is a finite `[lo, hi]` pair with `lo < hi` — the shape of
 * a matrix channel's normalization `range`.
 */
export function isValidRange(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    (value[0] as number) < (value[1] as number)
  )
}

function checkStringList(value: unknown, where: string): void {
  if (value === undefined) return
  if (!Array.isArray(value) || !value.every((label) => typeof label === 'string')) {
    throw protocolError(`${where} must be an array of strings`)
  }
}

function checkChannelInfo(entry: unknown, index: number): void {
  const where = `directory.channels[${index}]`
  if (!isRecord(entry)) throw protocolError(`${where} is not an object`)
  if (!isU16(entry.id)) throw protocolError(`${where}.id must be a u16`)
  if (typeof entry.name !== 'string') throw protocolError(`${where}.name must be a string`)
  if (typeof entry.kind !== 'string' || !CHANNEL_KINDS.has(entry.kind)) {
    throw protocolError(`${where}.kind is not a channel kind`)
  }
  if (typeof entry.status !== 'string' || !CHANNEL_STATUSES.has(entry.status)) {
    throw protocolError(`${where}.status is not a channel status`)
  }
  checkStringList(entry.rowLabels, `${where}.rowLabels`)
  checkStringList(entry.colLabels, `${where}.colLabels`)
  if (entry.range !== undefined && !isValidRange(entry.range)) {
    throw protocolError(`${where}.range must be a finite [lo, hi] with lo < hi`)
  }
  if (entry.error !== undefined && typeof entry.error !== 'string') {
    throw protocolError(`${where}.error must be a string`)
  }
}

/**
 * Parse and structurally validate a JSON text frame into a
 * {@link TextMessage} — the client's single entry point for text messages, so
 * a malformed frame surfaces as `VisualizerError('protocol', …)` here instead
 * of a `TypeError` deeper in the renderer. Checks:
 *
 * - `directory`: integer `version` and a `channels` array. When `version`
 *   equals {@link PROTOCOL_VERSION}, every entry must carry a `u16` `id`, a
 *   string `name`, a known `kind` and `status`, string-array labels, a valid
 *   `range` and a string `error` when present. A directory announcing another
 *   version is returned without entry checks, so the caller can report the
 *   mismatch.
 * - `static`: `u16` `id`, string `name`, and a `data` member.
 */
export function parseTextMessage(text: string): TextMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new VisualizerError('protocol', 'text frame is not valid JSON', { cause })
  }
  if (!isRecord(parsed)) {
    throw protocolError('text frame is not a directory or static message')
  }
  if (parsed.type === 'directory') {
    if (!Number.isInteger(parsed.version)) {
      throw protocolError('directory.version must be an integer')
    }
    if (!Array.isArray(parsed.channels)) {
      throw protocolError('directory.channels must be an array')
    }
    if (parsed.version === PROTOCOL_VERSION) parsed.channels.forEach(checkChannelInfo)
    return parsed as unknown as TextMessage
  }
  if (parsed.type === 'static') {
    if (!isU16(parsed.id)) throw protocolError('static.id must be a u16')
    if (typeof parsed.name !== 'string') throw protocolError('static.name must be a string')
    if (!Object.hasOwn(parsed, 'data')) throw protocolError('static message has no data')
    return parsed as unknown as TextMessage
  }
  throw protocolError('text frame is not a directory or static message')
}
