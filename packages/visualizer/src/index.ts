/**
 * @mindpeeker/visualizer — real-time dashboard for entropy/negentropy/PSI
 * data. Bun-only at runtime (`createDashboard` uses `Bun.serve`); the wire
 * protocol module is pure and shared with the bundled WebGL2 browser client.
 */
export type { VisualizerErrorCode, VisualizerErrorOptions } from './errors.js'
export { VisualizerError } from './errors.js'
export type { DecodedFrame } from './protocol.js'
export {
  BANDS_PREFIX_BYTES,
  decodeFrame,
  encodeBytesFrame,
  encodeMatrixFrame,
  encodeSeriesFrame,
  FRAME_KIND,
  HEADER_BYTES,
  isSupportedProtocolVersion,
  isValidRange,
  MATRIX_PREFIX_BYTES,
  MAX_SERIES_BANDS,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  parseTextMessage,
  SERIES_POINT_BYTES,
} from './protocol.js'
export { createDashboard } from './server/dashboard.js'
export type {
  ChannelInfo,
  ChannelKind,
  ChannelStatus,
  Dashboard,
  DashboardOptions,
  DirectoryMessage,
  MatrixFrameInput,
  RateCardGeometry,
  SeriesBand,
  SeriesPoint,
  SeriesSample,
  StaticMessage,
  TextMessage,
} from './types.js'
