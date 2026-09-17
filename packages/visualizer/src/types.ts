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
  /**
   * Producer-supplied normalization range of a matrix channel, $[\mathrm{lo},
   * \mathrm{hi}]$ with `lo < hi`. When present the client maps values through
   * this fixed range (clamped), so frames are comparable over time.
   */
  readonly range?: readonly [number, number]
  /**
   * Short reason the producer failed (the error message plus its `cause`
   * chain), present only while `status` is `'error'`.
   */
  readonly error?: string
  /**
   * Legend labels of a series channel's bands, index-aligned with
   * `SeriesPoint.bands` (empty string = unlabeled). Protocol 2 only: a
   * protocol-1 directory omits it, because protocol-1 frames carry only the
   * first band.
   */
  readonly bandLabels?: readonly string[]
  /**
   * Short producer text set with `Dashboard.setNote` — e.g. a health-test event
   * of a hardware source, or an anytime-valid p-value. Series panels draw it in
   * the chart caption, the other panels next to the status badge. Additive:
   * clients that do not know the field ignore it.
   */
  readonly note?: string
}

/** JSON text frame listing every channel. Always the first message a client receives. */
export interface DirectoryMessage {
  readonly type: 'directory'
  /**
   * The protocol version negotiated for this connection: `min(v, PROTOCOL_VERSION)`
   * for a client that opened `/ws?v=<v>`, 1 for a client that sent no `v`.
   * Clients reject versions they do not speak.
   */
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
 * One envelope of a multi-band series point. Bounds may be ±∞ (a one-sided
 * boundary: only the finite side is drawn) or NaN (no band at this point).
 */
export interface SeriesBand {
  readonly lo: number
  readonly hi: number
  /**
   * Legend label. Producers set it per sample; the server publishes it in the
   * directory (`ChannelInfo.bandLabels`), never in binary frames, so decoded
   * bands carry no label.
   */
  readonly label?: string
}

/**
 * One decoded point of a series channel. The optional `band` is a
 * $[\mathrm{lo}, \mathrm{hi}]$ envelope drawn as a shaded region behind the
 * line — e.g. the pointwise $\chi^2$ significance envelope around the GCP
 * cumulative deviation $D(t) = \sum_{s \le t}\bigl(Z(s)^2 - 1\bigr)$
 * (Nelson & Bancel, "The GCP: Design and Analytical Results").
 *
 * `bands` (protocol 2, frame kind 4) carries several envelopes at once — e.g.
 * that pointwise band next to a time-uniform, anytime-valid boundary. The
 * first band is shaded, later ones are drawn as boundary lines. A point has
 * `band` or `bands`, never both.
 */
export interface SeriesPoint {
  readonly t: number
  readonly value: number
  readonly band?: readonly [number, number]
  readonly bands?: readonly SeriesBand[]
}

/**
 * What `attachSeries` accepts per emission: a bare number (the server assigns
 * `t` as a running sample index) or an explicit point with optional time and
 * either one envelope `band` or up to eight labeled `bands` (see
 * {@link SeriesPoint}).
 */
export type SeriesSample =
  | number
  | {
      readonly t?: number
      readonly value: number
      readonly band?: readonly [number, number]
      readonly bands?: readonly SeriesBand[]
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
  /**
   * Fixed normalization range `[lo, hi]` (finite, `lo < hi`), published in the
   * directory like the labels. Without it the client normalizes each frame:
   * heatmaps min–max, bars (one row) over $[\min(0, \min), \max(0, \max)]$ so
   * bar height stays proportional to magnitude.
   */
  readonly range?: readonly [number, number]
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
  /**
   * Ring radii as fractions of the dial radius, each in $(0, 1]$. Sector lines
   * run from the innermost to the outermost ring; with fewer than two distinct
   * radii they start at the centre.
   */
  readonly rings: readonly number[]
  /**
   * Sector index the pointer line marks, if any (0-based, top, clockwise); an
   * integer in $[0, \mathrm{sectors})$ — the client rejects anything else.
   */
  readonly pointerSector?: number
  readonly label?: string
}

/** Options for `createDashboard`. Invalid values throw `VisualizerError('server')`. */
export interface DashboardOptions {
  /** TCP port, an integer in $[0, 65535]$; `0` (default) asks the OS for a free one. */
  readonly port?: number
  /**
   * Hostname to bind (non-empty), default `localhost`. IPv6 literals may be
   * given bare (`::1`) or bracketed; `Dashboard.url` always brackets them.
   */
  readonly host?: string
  /** Aborting stops the dashboard exactly like calling `stop()`. */
  readonly signal?: AbortSignal
  /**
   * Frames retained per channel for replay to late-joining clients. Oldest
   * frames are dropped first, so producers are never blocked by consumers.
   * Default 256.
   */
  readonly ringCapacity?: number
  /**
   * Extra browser origins (e.g. `'https://lab.example'`) allowed to open the
   * `/ws` socket. By default only same-host pages are accepted: a handshake
   * whose `Origin` names another host is refused with HTTP 403 (cross-site
   * WebSocket hijacking guard); handshakes without an `Origin` header
   * (non-browser clients) are accepted. When bound to a loopback host, the
   * request's `Host` must also be a loopback name or the host of one of these
   * origins (DNS-rebinding guard). Each entry must be an absolute
   * `scheme://host[:port]` origin.
   */
  readonly allowedOrigins?: readonly string[]
  /**
   * Called once when a channel's producer (its source or the frame encoder)
   * fails; the channel's directory entry turns `status: 'error'` with a short
   * `error` message either way. Default: `console.error`. Errors thrown by the
   * callback itself are logged and otherwise ignored. Failures caused by
   * `stop()` are not reported.
   */
  readonly onChannelError?: (channel: string, error: unknown) => void
}

/**
 * A running dashboard. All `attach*` methods register a channel, announce it
 * to every connected client via a directory update, and start pumping the
 * source in the background — a slow or absent client never exerts
 * backpressure on a producer (frames beyond the ring capacity, or beyond a
 * socket's buffered-amount budget, are dropped, never queued unboundedly —
 * that budget also caps the history replayed to a late joiner).
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
  /**
   * Publish one JSON document (e.g. {@link RateCardGeometry} for the dial
   * panel). The document is serialized once, up front: an unserializable
   * value (BigInt, cycles, `undefined`) throws
   * `VisualizerError('invalid_channel')` and registers nothing.
   */
  attachStatic(name: string, json: unknown): void
  /**
   * Set (or clear, with `undefined`) a channel's short status text
   * (`ChannelInfo.note`, at most 200 characters — longer text is cut). Late
   * joiners see the current note; connected clients get it with the next
   * directory update, sent at most every 100 ms however often notes change.
   *
   * @throws {VisualizerError} `invalid_channel` for an unknown channel or a
   *   note that is neither a string nor `undefined`; `server` after `stop()`.
   */
  setNote(name: string, note: string | undefined): void
  /**
   * Stop the dashboard: every pump stops waiting on its source and the
   * iterators the dashboard consumes are closed with `return()` immediately,
   * every socket gets a 1000 close, and the server stops. Cleanup waits are
   * bounded (a source blocked inside an `await` only finishes its `return()`
   * once that await settles). Idempotent: every call — including the one
   * triggered by the `signal` option — returns the same in-flight promise.
   */
  stop(): Promise<void>
}
