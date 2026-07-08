/**
 * Kind of data a dashboard channel carries, which also selects the client
 * panel that renders it: `bytes` → scrolling noise bitmap, `series` → rolling
 * line chart with envelope band, `matrix` → heatmap (bar chart for $1 \times N$),
 * `static` → one JSON document (e.g. radial-dial geometry).
 */
export type ChannelKind = 'bytes' | 'series' | 'matrix' | 'static'

/** Lifecycle of a channel's producer as reported in the directory. */
export type ChannelStatus = 'live' | 'ended' | 'error'

/**
 * One entry of the channel directory the server sends as JSON on connect and
 * whenever the set of channels (or a channel's status/labels) changes. The
 * `id` is the `u16` used to tag binary frames for this channel.
 */
export interface ChannelInfo {
  readonly id: number
  readonly name: string
  readonly kind: ChannelKind
  readonly status: ChannelStatus
  /** Latest matrix row labels, when the producer supplied any. */
  readonly rowLabels?: readonly string[]
  /** Latest matrix column labels, when the producer supplied any. */
  readonly colLabels?: readonly string[]
}

/** JSON text frame listing every channel. Always the first message a client receives. */
export interface DirectoryMessage {
  readonly type: 'directory'
  /** Wire-protocol version, so clients can reject servers they do not speak. */
  readonly version: number
  readonly channels: readonly ChannelInfo[]
}

/** JSON text frame carrying a static channel's document. */
export interface StaticMessage {
  readonly type: 'static'
  readonly id: number
  readonly name: string
  readonly data: unknown
}

/** Union of all JSON text frames the server emits. */
export type TextMessage = DirectoryMessage | StaticMessage

/**
 * One decoded point of a series channel. The optional `band` is a
 * $[\mathrm{lo}, \mathrm{hi}]$ envelope drawn as a shaded region behind the
 * line — e.g. the pointwise $\chi^2$ significance envelope around the GCP
 * cumulative deviation $D(t) = \sum_{s \le t}\bigl(Z(s)^2 - 1\bigr)$
 * (Nelson & Bancel, "The GCP: Design and Analytical Results").
 */
export interface SeriesPoint {
  readonly t: number
  readonly value: number
  readonly band?: readonly [number, number]
}

/**
 * What `attachSeries` accepts per emission: a bare number (the server assigns
 * `t` as a running sample index) or an explicit point with optional time and
 * envelope band.
 */
export type SeriesSample =
  | number
  | {
      readonly t?: number
      readonly value: number
      readonly band?: readonly [number, number]
    }

/**
 * What `attachMatrix` accepts per emission: a dense row-major
 * $\mathrm{rows} \times \mathrm{cols}$ matrix. Labels ride along in the JSON
 * directory (not the binary frame) and update whenever they change.
 */
export interface MatrixFrameInput {
  readonly rows: number
  readonly cols: number
  /** Row-major values, `data.length === rows * cols`. */
  readonly data: Float32Array
  readonly rowLabels?: readonly string[]
  readonly colLabels?: readonly string[]
}

/**
 * Radial-dial geometry for the client's rate-card panel — concentric rings
 * plus `sectors` radial lines, the layout of a Malcolm Rae style radionic
 * rate card (base-44 angular encoding: one sector per symbol position, rates
 * written as ring/sector coordinates).
 */
export interface RateCardGeometry {
  readonly type: 'rate-card'
  /** Number of radial divisions (44 for a classic Rae card). */
  readonly sectors: number
  /** Ring radii as fractions of the dial radius, each in $(0, 1]$. */
  readonly rings: readonly number[]
  /** Sector index the pointer line marks, if any (0-based, top, clockwise). */
  readonly pointerSector?: number
  readonly label?: string
}

/** Options for `createDashboard`. */
export interface DashboardOptions {
  /** TCP port; `0` (default) asks the OS for a free one. */
  readonly port?: number
  /** Hostname to bind, default `localhost`. */
  readonly host?: string
  /** Aborting stops the dashboard exactly like calling `stop()`. */
  readonly signal?: AbortSignal
  /**
   * Frames retained per channel for replay to late-joining clients. Oldest
   * frames are dropped first, so producers are never blocked by consumers.
   * Default 256.
   */
  readonly ringCapacity?: number
}

/**
 * A running dashboard. All `attach*` methods register a channel, announce it
 * to every connected client via a directory update, and start pumping the
 * source in the background — a slow or absent client never exerts
 * backpressure on a producer (frames beyond the ring capacity, or beyond a
 * socket's buffered-amount budget, are dropped, never queued unboundedly).
 */
export interface Dashboard {
  /** Root URL serving the client app, e.g. `http://localhost:52814/`. */
  readonly url: string
  /** The actual bound port (resolved when `port: 0` was requested). */
  readonly port: number
  /** Stream raw bytes to a scrolling noise-bitmap panel. */
  attachByteStream(name: string, src: AsyncIterable<Uint8Array>): void
  /** Stream scalar samples (optionally banded) to a rolling line-chart panel. */
  attachSeries(name: string, src: AsyncIterable<SeriesSample>): void
  /** Stream dense matrices to a heatmap panel (bar mode for one row). */
  attachMatrix(name: string, src: AsyncIterable<MatrixFrameInput>): void
  /** Publish one JSON document (e.g. {@link RateCardGeometry} for the dial panel). */
  attachStatic(name: string, json: unknown): void
  /** Close every socket, stop the server, halt all channel pumps. Idempotent. */
  stop(): Promise<void>
}
