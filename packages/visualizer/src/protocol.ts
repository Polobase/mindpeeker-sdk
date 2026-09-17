/**
 * Binary wire protocol shared verbatim by the Bun server and the browser
 * client — pure functions over typed arrays, no runtime APIs, so the same
 * module bundles into the client and unit-tests headlessly.
 *
 * Frame layout (all multi-byte integers and floats little-endian, written
 * explicitly through `DataView` so the encoding is platform-independent):
 *
 * ```
 * [u8 layout version][u8 kind][u16 channelId][payload…]
 * ```
 *
 * - kind 1 (`bytes`):  payload is the raw byte chunk.
 * - kind 2 (`series`): payload is repeated 32-byte points
 *   `(f64 t, f64 value, f64 lo, f64 hi)`; an absent band is encoded as
 *   `lo = hi = NaN` (NaN survives IEEE 754 round-trips, and no meaningful
 *   band bound is NaN, so no escape byte is needed).
 * - kind 3 (`matrix`): payload is `u16 rows, u16 cols` followed by
 *   `rows·cols` row-major `f32` values.
 * - kind 4 (`bands`, protocol 2): payload is `u16 bandCount` followed by
 *   repeated points `(f64 t, f64 value, bandCount × (f64 lo, f64 hi))`.
 *
 * The first byte names the protocol version that defined the frame's layout:
 * 1 for kinds 1–3, 2 for kind 4. Frames are encoded once and shared by every
 * socket; a decoder rejects a byte that does not match the kind, so a
 * protocol-1 decoder rejects every kind-4 frame.
 *
 * Version negotiation: a client opens `/ws?v=<n>` with the newest version it
 * speaks; the server answers with `min(n, PROTOCOL_VERSION)` in every
 * directory's `version` (no `v` means 1). A protocol-1 session never receives
 * kind-4 frames — the server downgrades multi-band points to kind 2 carrying
 * their first band — and its directory carries no `bandLabels`.
 *
 * JSON text frames ({@link TextMessage}) carry the channel directory and
 * static documents; everything high-rate is binary.
 */
import { VisualizerError } from './errors.js'
import type { SeriesBand, SeriesPoint, TextMessage } from './types.js'

/** Newest protocol version this build speaks (the client requests it with `/ws?v=`). */
export const PROTOCOL_VERSION = 2
/** Oldest protocol version this build still serves and decodes. */
export const MIN_PROTOCOL_VERSION = 1

/** Frame kind bytes. Frozen data table, not an enum, per SDK style. */
export const FRAME_KIND = Object.freeze({
  bytes: 1,
  series: 2,
  matrix: 3,
  bands: 4,
} as const)

/** Layout version byte each frame kind carries (index = kind byte). */
const LAYOUT_VERSION: readonly number[] = Object.freeze([0, 1, 1, 1, 2])

/** Fixed header size: version, kind, channel id. */
export const HEADER_BYTES = 4
/** Encoded size of one series point: four `f64`s. */
export const SERIES_POINT_BYTES = 32
/** Matrix payload prefix: `u16 rows` + `u16 cols`. */
export const MATRIX_PREFIX_BYTES = 4
/** Multi-band series payload prefix: `u16 bandCount`. */
export const BANDS_PREFIX_BYTES = 2
/** Most bands one series point may carry. */
export const MAX_SERIES_BANDS = 8

/** A decoded binary frame, discriminated on `kind` (kinds 2 and 4 both decode to `series`). */
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

/** `true` for a protocol version this build serves and decodes. */
export function isSupportedProtocolVersion(version: unknown): version is number {
  return (
    Number.isInteger(version) &&
    (version as number) >= MIN_PROTOCOL_VERSION &&
    (version as number) <= PROTOCOL_VERSION
  )
}

function protocolError(message: string): VisualizerError {
  return new VisualizerError('protocol', message)
}

function checkChannelId(channelId: number): void {
  if (!Number.isInteger(channelId) || channelId < 0 || channelId > 0xffff) {
    throw new VisualizerError('invalid_channel', `channel id must be a u16, got ${channelId}`)
  }
}

function header(kind: number, channelId: number, payloadBytes: number): DataView {
  const view = new DataView(new ArrayBuffer(HEADER_BYTES + payloadBytes))
  view.setUint8(0, LAYOUT_VERSION[kind] as number)
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

/** Throw `protocol` unless `bands` is 1…{@link MAX_SERIES_BANDS} `{lo, hi}` number pairs. */
function checkBands(bands: unknown): asserts bands is readonly SeriesBand[] {
  if (!Array.isArray(bands) || bands.length < 1 || bands.length > MAX_SERIES_BANDS) {
    throw protocolError(`series bands must be an array of 1…${MAX_SERIES_BANDS} bands`)
  }
  for (const band of bands) {
    const b = band as Partial<SeriesBand> | null
    if (
      typeof b !== 'object' ||
      b === null ||
      typeof b.lo !== 'number' ||
      typeof b.hi !== 'number'
    ) {
      throw protocolError('every series band needs numeric lo and hi')
    }
    if (b.label !== undefined && typeof b.label !== 'string') {
      throw protocolError('a series band label must be a string')
    }
  }
}

/**
 * Encode series points. Points with only a single `band` (or none) become one
 * kind-2 frame of `(t, value, lo, hi)` records, a missing band written as
 * `lo = hi = NaN`. As soon as one point carries `bands`, the frame is kind 4
 * with `bandCount` = the longest `bands` array; shorter band lists (and a
 * point's single `band` counts as its first band) are padded with NaN pairs.
 * Band `label`s are not encoded — they ride in the directory.
 *
 * `version: 1` encodes for a protocol-1 session instead: always kind 2, a
 * multi-band point keeping only its first band.
 *
 * @throws {VisualizerError} `protocol` for a point with both `band` and
 *   `bands`, or `bands` that is not 1…{@link MAX_SERIES_BANDS} numeric
 *   `{lo, hi}` pairs; `invalid_channel` for a channel id outside `u16`.
 */
export function encodeSeriesFrame(
  channelId: number,
  points: readonly SeriesPoint[],
  opts: { readonly version?: number } = {},
): Uint8Array {
  checkChannelId(channelId)
  let bandCount = 0
  for (const point of points) {
    if (point.bands === undefined) continue
    if (point.band !== undefined) throw protocolError('a series point has both band and bands')
    checkBands(point.bands)
    bandCount = Math.max(bandCount, point.bands.length)
  }
  const version = opts.version ?? PROTOCOL_VERSION
  if (bandCount === 0 || version < 2) return encodeSingleBand(channelId, points)
  const pointBytes = 16 * (1 + bandCount)
  const view = header(FRAME_KIND.bands, channelId, BANDS_PREFIX_BYTES + points.length * pointBytes)
  view.setUint16(HEADER_BYTES, bandCount, true)
  let offset = HEADER_BYTES + BANDS_PREFIX_BYTES
  for (const point of points) {
    view.setFloat64(offset, point.t, true)
    view.setFloat64(offset + 8, point.value, true)
    const bands: readonly SeriesBand[] =
      point.bands ?? (point.band ? [{ lo: point.band[0], hi: point.band[1] }] : [])
    for (let i = 0; i < bandCount; i++) {
      const band = bands[i]
      view.setFloat64(offset + 16 + 16 * i, band ? band.lo : Number.NaN, true)
      view.setFloat64(offset + 24 + 16 * i, band ? band.hi : Number.NaN, true)
    }
    offset += pointBytes
  }
  return new Uint8Array(view.buffer)
}

/** Kind 2: one optional band per point (a multi-band point keeps its first band). */
function encodeSingleBand(channelId: number, points: readonly SeriesPoint[]): Uint8Array {
  const view = header(FRAME_KIND.series, channelId, points.length * SERIES_POINT_BYTES)
  let offset = HEADER_BYTES
  for (const point of points) {
    const first = point.bands?.[0]
    const lo = point.band ? point.band[0] : first ? first.lo : Number.NaN
    const hi = point.band ? point.band[1] : first ? first.hi : Number.NaN
    view.setFloat64(offset, point.t, true)
    view.setFloat64(offset + 8, point.value, true)
    view.setFloat64(offset + 16, lo, true)
    view.setFloat64(offset + 24, hi, true)
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
    throw protocolError(`matrix dims must be u16 ≥ 1, got ${rows}×${cols}`)
  }
  if (data.length !== rows * cols) {
    throw protocolError(`matrix data length ${data.length} does not match ${rows}×${cols}`)
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
 * malformed input: a version byte outside the supported range or not matching
 * the kind's layout, an unknown kind, a truncated header, a series payload
 * that is not a whole number of points, a band count outside
 * $[1, 8]$, or a matrix payload whose size disagrees with its declared
 * dimensions. Kind-4 points decode with `bands` (every bound as sent, NaN and
 * ±∞ included); kind-2 points with an optional `band`. Handles `Uint8Array`s
 * that view a larger buffer at any alignment (floats are read through
 * `DataView`, never by typed-array aliasing).
 */
export function decodeFrame(frame: Uint8Array): DecodedFrame {
  if (frame.byteLength < HEADER_BYTES) {
    throw protocolError(`frame too short: ${frame.byteLength} bytes`)
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const version = view.getUint8(0)
  if (!isSupportedProtocolVersion(version)) {
    throw protocolError(`unsupported protocol version ${version}`)
  }
  const kind = view.getUint8(1)
  if (!(kind >= FRAME_KIND.bytes && kind <= FRAME_KIND.bands)) {
    throw protocolError(`unknown frame kind ${kind}`)
  }
  if (LAYOUT_VERSION[kind] !== version) {
    throw protocolError(
      `frame kind ${kind} has layout version ${LAYOUT_VERSION[kind]}, got ${version}`,
    )
  }
  const channelId = view.getUint16(2, true)
  const payloadBytes = frame.byteLength - HEADER_BYTES

  if (kind === FRAME_KIND.bytes) {
    return { kind: 'bytes', channelId, bytes: frame.slice(HEADER_BYTES) }
  }
  if (kind === FRAME_KIND.series) return decodeSeries(view, channelId, payloadBytes)
  if (kind === FRAME_KIND.bands) return decodeBands(view, channelId, payloadBytes)

  if (payloadBytes < MATRIX_PREFIX_BYTES) {
    throw protocolError('matrix frame missing rows/cols prefix')
  }
  const rows = view.getUint16(HEADER_BYTES, true)
  const cols = view.getUint16(HEADER_BYTES + 2, true)
  const expected = MATRIX_PREFIX_BYTES + 4 * rows * cols
  if (rows < 1 || cols < 1 || payloadBytes !== expected) {
    throw protocolError(`matrix payload ${payloadBytes} does not match declared ${rows}×${cols}`)
  }
  const data = new Float32Array(rows * cols)
  let offset = HEADER_BYTES + MATRIX_PREFIX_BYTES
  for (let i = 0; i < data.length; i++) {
    data[i] = view.getFloat32(offset, true)
    offset += 4
  }
  return { kind: 'matrix', channelId, rows, cols, data }
}

function decodeSeries(view: DataView, channelId: number, payloadBytes: number): DecodedFrame {
  if (payloadBytes % SERIES_POINT_BYTES !== 0) {
    throw protocolError(`series payload ${payloadBytes} is not a multiple of ${SERIES_POINT_BYTES}`)
  }
  const points: SeriesPoint[] = []
  for (let offset = HEADER_BYTES; offset < view.byteLength; offset += SERIES_POINT_BYTES) {
    const t = view.getFloat64(offset, true)
    const value = view.getFloat64(offset + 8, true)
    const lo = view.getFloat64(offset + 16, true)
    const hi = view.getFloat64(offset + 24, true)
    const band = Number.isNaN(lo) || Number.isNaN(hi) ? undefined : ([lo, hi] as const)
    points.push(band ? { t, value, band } : { t, value })
  }
  return { kind: 'series', channelId, points }
}

function decodeBands(view: DataView, channelId: number, payloadBytes: number): DecodedFrame {
  if (payloadBytes < BANDS_PREFIX_BYTES) {
    throw protocolError('bands frame missing its band count')
  }
  const bandCount = view.getUint16(HEADER_BYTES, true)
  if (bandCount < 1 || bandCount > MAX_SERIES_BANDS) {
    throw protocolError(`bands frame declares ${bandCount} bands (1…${MAX_SERIES_BANDS})`)
  }
  const pointBytes = 16 * (1 + bandCount)
  if ((payloadBytes - BANDS_PREFIX_BYTES) % pointBytes !== 0) {
    throw protocolError(
      `bands payload ${payloadBytes} is not a whole number of ${pointBytes}-byte points`,
    )
  }
  const points: SeriesPoint[] = []
  for (
    let offset = HEADER_BYTES + BANDS_PREFIX_BYTES;
    offset < view.byteLength;
    offset += pointBytes
  ) {
    const bands: SeriesBand[] = []
    for (let i = 0; i < bandCount; i++) {
      bands.push({
        lo: view.getFloat64(offset + 16 + 16 * i, true),
        hi: view.getFloat64(offset + 24 + 16 * i, true),
      })
    }
    points.push({
      t: view.getFloat64(offset, true),
      value: view.getFloat64(offset + 8, true),
      bands,
    })
  }
  return { kind: 'series', channelId, points }
}

const CHANNEL_KINDS: ReadonlySet<string> = new Set(['bytes', 'series', 'matrix', 'static'])
const CHANNEL_STATUSES: ReadonlySet<string> = new Set(['live', 'ended', 'error'])

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

function checkOptionalString(value: unknown, where: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw protocolError(`${where} must be a string`)
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
  checkStringList(entry.bandLabels, `${where}.bandLabels`)
  if (entry.range !== undefined && !isValidRange(entry.range)) {
    throw protocolError(`${where}.range must be a finite [lo, hi] with lo < hi`)
  }
  checkOptionalString(entry.error, `${where}.error`)
  checkOptionalString(entry.note, `${where}.note`)
}

/**
 * Parse and structurally validate a JSON text frame into a
 * {@link TextMessage} — the client's single entry point for text messages, so
 * a malformed frame surfaces as `VisualizerError('protocol', …)` here instead
 * of a `TypeError` deeper in the renderer. Checks:
 *
 * - `directory`: integer `version` and a `channels` array. When the version
 *   is supported ({@link isSupportedProtocolVersion}), every entry must carry
 *   a `u16` `id`, a string `name`, a known `kind` and `status`, string-array
 *   labels (`rowLabels`, `colLabels`, `bandLabels`), a valid `range`, and a
 *   string `error`/`note` when present. A directory announcing an unsupported
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
    if (isSupportedProtocolVersion(parsed.version)) parsed.channels.forEach(checkChannelInfo)
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
