# @mindpeeker/visualizer

Real-time dashboard for entropy/negentropy/PSI data: a Bun-native
WebSocket server plus a zero-dependency WebGL2 browser client.

Point any `AsyncIterable` at it — raw bytes, statistic series, matrices,
or a static JSON document — and get a live panel per channel: scrolling
noise bitmap, rolling line chart with significance-envelope shading,
heatmap/bar chart, and a radial rate-card dial.

> **Bun-only at runtime.** `createDashboard` uses `Bun.serve` and
> `Bun.file`; the demo CLI uses `Bun.argv`. `package.json` therefore declares
> only `engines.bun` (≥ 1.2) — there is no Node.js engine and no Node.js or
> browser entry point for the *server*. The wire protocol (`protocol.ts`) and
> all client code are pure/browser-safe, enforced by
> `test/client-safety.test.ts`.

## Quick start

```sh
# demo dashboard: <source> noise → bitmap, windowed negentropy → series,
# GCP cumulative deviation + envelope → banded chart, histogram → bars,
# sample base-44 rate card → dial
bun run build           # once, to bundle the client
bun dist/cli.js         # or: mindpeeker-viz after npm-installing the package
# → mindpeeker visualizer demo → http://localhost:52814/
```

### Choosing an entropy source

The demo defaults to the software CSPRNG, but `--source` points it at any
`@mindpeeker/entropy` provider — including live hardware:

```sh
bun dist/cli.js --list-sources          # print the table below
bun dist/cli.js --source esp32          # ESP32 TRNG on /dev/cu.usbserial-110 @ 921600
bun dist/cli.js --source camera         # webcam sensor noise via ffmpeg
bun dist/cli.js --source mic --raw      # microphone LSBs, unconditioned passthrough
bun dist/cli.js --source serial --serial-path /dev/ttyUSB0 --baud 115200
```

| `--source`        | what it captures                                             | needs |
|-------------------|-------------------------------------------------------------|-------|
| `crypto` (default)| software CSPRNG (`crypto.getRandomValues`)                   | —     |
| `jitter`          | CPU clock jitter                                            | —     |
| `serial` / `esp32`| serial TRNG, e.g. an ESP32 running the AetherOnePi firmware  | a USB serial device |
| `camera`          | webcam sensor noise (frame-diff sign bits)                  | `ffmpeg`, a camera |
| `mic`             | microphone thermal/ambient noise (sample LSBs)             | `ffmpeg`, a mic |
| `hwrng`           | kernel hardware RNG (`/dev/hwrng`)                          | Linux/Pi, usually root |

Source-specific flags: `--serial-path`, `--baud`, `--camera-device`,
`--mic-device`, `--hwrng-path`, and `--raw` (skip SHA-256 conditioning, pass the
hardware's health-tested raw samples). Invalid arguments (`--port` outside
0–65535, a `--baud` that is not a positive integer, an unknown flag or source)
exit with status 1 and a message. A single device session is fanned out to
every panel, so one camera or serial port is opened **exactly once**. If the
device is absent the server stays up, every streaming panel shows an `error`
badge with the reason, and the terminal prints it once, e.g.
`channel 'esp32 noise' failed: opening /dev/cu.usbserial-110 failed: ENOENT … — no such device (unplugged, or wrong path?)`
(later channels failing for the same reason print `(same reason)`).

The demo plumbing lives in [`src/demo.ts`](src/demo.ts) (`parseArgs`,
`fanOut`, `paced`, `cumdevSeries`, `histogramMatrix`, `startDemo`) and the
source registry in [`src/sources.ts`](src/sources.ts); `src/cli.ts` is a thin
entry over them. These modules are internal to the CLI (not package exports).

Programmatic:

```ts
import { createDashboard } from '@mindpeeker/visualizer'

const dash = createDashboard({
  port: 0,                                         // 0 = pick a free one
  onChannelError: (channel, error) => log.warn(channel, error), // default: console.error
})
console.log(dash.url)

dash.attachByteStream('noise', provider.stream({ chunkBytes: 256 }))
dash.attachSeries('z', zSamples())                 // numbers or {t?, value, band?}
dash.attachMatrix('corr', correlationFrames())     // {rows, cols, data: Float32Array, range?}
dash.attachStatic('rate card', { type: 'rate-card', sectors: 44, rings: [0.3, 0.6, 0.9] })

await dash.stop()                                  // closes sources, 1000 close to every client
```

## Architecture

```
producers (AsyncIterable)          Bun server                      browser
─────────────────────────   ───────────────────────────   ─────────────────────────
attachByteStream ──┐         per-channel ring buffer        WebSocket client
attachSeries ──────┼──▶ encode ──▶ (drop-oldest, 256) ──▶  decode ──▶ panel registry
attachMatrix ──────┘                    │                        │
attachStatic ──▶ JSON (once)            ├─ fan-out to sockets    ├─ noise bitmap (GL ring texture)
                                        │  (buffered-amount      ├─ line chart + band (GL strips)
    Bun.serve ◀── HTTP GET /            │   budget, drop)        ├─ heatmap / bars (R32F + LUT)
    dist/client (static, no-cache)      └─ replay to joiners     └─ radial dial (line lists)
```

Design invariants:

- **Producers never block.** Frames go into a per-channel drop-oldest
  ring buffer (default 256; `ringCapacity` option) and are fanned out
  only to sockets whose `getBufferedAmount()` is under a 4 MiB budget.
  A slow, hung, or absent client costs a producer nothing.
- **Late joiners see history, in a fixed order.** On connect a client
  receives (1) the channel directory, (2) every static document, in
  registration order, then (3) each streaming channel's retained frames,
  oldest first, channel by channel in registration order.
- **The directory is push-updated** on every attach, producer
  end/error (with the error reason), and matrix label/range change.
- **Failures surface.** A producer that throws — its source or the frame
  encoder, e.g. a matrix whose `data.length` does not match `rows × cols` —
  turns its channel `status: 'error'` with an `error` reason (the message and
  its `cause` chain) in the directory, and is reported once through
  `onChannelError(channel, error)` (default `console.error`).
- **`stop()` owns the pumps.** It pre-empts every pending pull, calls
  `return()` on each iterator the dashboard consumes (waits are bounded: a
  generator suspended inside an `await` only runs its `finally` once that
  await settles), closes every socket with 1000, stops the server, and removes
  the `signal` listener it added. Every call returns the same in-flight
  promise.

## Security

The dashboard streams raw entropy and statistics, so the socket is guarded
even though it binds `localhost` by default:

- **Origin check.** A `/ws` handshake carrying an `Origin` header is accepted
  only when that origin's host equals the request's `Host` (same host and
  port) or is listed in `allowedOrigins`; anything else — including the
  opaque origin `null` — gets HTTP 403. This stops a page on another site
  from reading the stream (cross-site WebSocket hijacking). Clients that send
  no `Origin` (non-browser tools) are accepted.
- **DNS-rebinding guard.** When bound to a loopback host (`localhost`,
  `127.0.0.0/8`, `::1`), the `Host` header must also be a loopback name or the
  host of an `allowedOrigins` entry.
- **Send-only socket.** Any inbound message closes the socket (1003), and the
  runtime refuses inbound messages larger than 1 KiB (`maxPayloadLength`).
- **Behind a reverse proxy** (e.g. `https://lab.example/`), add the public
  origin: `createDashboard({ allowedOrigins: ['https://lab.example'] })`. The
  client connects with `wss:` automatically when the page is served over
  https.
- There is no authentication and no TLS in the server itself. Binding a
  non-loopback host (`--host 0.0.0.0`) exposes the stream to the network;
  put an authenticating proxy in front if that matters.

## Wire protocol

Binary frames (all integers/floats **little-endian** via `DataView`):

| offset | size | field |
|---|---|---|
| 0 | u8 | version = `1` |
| 1 | u8 | kind (`1` bytes, `2` series, `3` matrix) |
| 2 | u16 | channel id |
| 4 | … | payload (see below) |

| kind | payload |
|---|---|
| 1 `bytes` | the raw chunk, verbatim |
| 2 `series` | repeated 32-byte points: `f64 t, f64 value, f64 lo, f64 hi`; absent band ⇒ `lo = hi = NaN` |
| 3 `matrix` | `u16 rows, u16 cols`, then `rows·cols` row-major `f32` |

Text frames are JSON: `{type: 'directory', version, channels: [{id, name,
kind, status, rowLabels?, colLabels?, range?, error?}]}` and `{type: 'static',
id, name, data}`. Matrix labels and `range` ride in the directory, not the
binary frames; `error` is present only while `status` is `'error'`.

`encode*`/`decodeFrame` live in `src/protocol.ts`, shared verbatim by
server and client and exhaustively round-trip tested (including NaN band
handling, alignment-hostile buffer offsets, and malformed-frame
rejection with `VisualizerError('protocol', …)`). `parseTextMessage`
validates structure, not just the type tag: a directory needs an integer
`version` and a `channels` array whose entries have a `u16` id, string name,
known kind/status, string-array labels, a finite `range` with `lo < hi` and a
string `error`; a static message needs a `u16` id, a string name and `data`.
A directory announcing another protocol version is returned unchecked so the
client can report the mismatch.

## Panels

- **Noise bitmap** (`bytes`): a 256×256 `R8` texture ring. Each chunk
  fills whole rows via `texSubImage2D` at a wrapping row pointer; the
  fragment shader adds the row offset to the v coordinate mod 1 — one
  quad, no full re-uploads, scrolling for free.
- **Series** (`series`): rolling window of the last 4096 points,
  y-autoscaled over values ∪ band bounds. The envelope band is a
  translucent `TRIANGLE_STRIP` under a `LINE_STRIP`; y-axis labels sit on
  their gridlines (below the line when there is no room above). Built for
  the GCP cumulative deviation $D(t) = \sum_{s \le t}\bigl(Z(s)^2 - 1\bigr)$
  with its pointwise $\chi^2$ quantile envelope (Nelson & Bancel; see
  `@mindpeeker/negentropy` for the caveat that the envelope is *pointwise*,
  not path-wise).
- **Matrix** (`matrix`): an `R32F` texture colored through a 256×1 viridis
  LUT (frozen 10-stop table, linear sRGB interpolation). Normalization: the
  producer's `range` when given (values clamped, so frames are comparable
  over time); otherwise heatmaps are min–max normalized per frame and a
  $1 \times N$ matrix switches to **bar mode** over
  $[\min(0, \min v), \max(0, \max v)]$ — bars grow from the zero baseline, so
  bar height is proportional to magnitude and a flat histogram shows bars of
  equal height. The caption shows the mapped span (`range` or `scale lo…hi`).
- **Radial dial** (`static`): renders `{type: 'rate-card', sectors,
  rings, pointerSector?}` — the Malcolm Rae base-44 card layout —
  as tessellated line lists (sector 0 at 12 o'clock, clockwise), with a
  pulsing pointer and a slow radar sweep as the phase animation. Sector
  lines run between the innermost and outermost ring, or from the centre
  when there are fewer than two distinct radii. An invalid document
  (`pointerSector` not an integer in $[0, \mathrm{sectors})$, a radius
  outside $(0, 1]$) shows an `error` badge with the reason.

Every panel tracks its box with a `ResizeObserver` and the display's
`devicePixelRatio` with a resolution media query, resizing both canvases
(and the dial's aspect correction) so lines stay crisp and the dial stays
circular; the grid's column count is fixed before panels are created and
drops to one column on narrow screens. On every (re)connect the client
clears panel data before the server replays its retained frames (no
duplicated history, no retrace), and a server speaking another protocol
version closes the socket for good (reload after upgrading).

**Why a 2D-canvas overlay for text/axes:** WebGL2 core cannot rasterize
text; a glyph atlas or SDF font would break the zero-dependency budget.
Each panel stacks a transparent `CanvasRenderingContext2D` canvas over
its GL canvas — GL draws data, 2D draws crisp DPI-aware words.

## API

- `createDashboard(opts?): Dashboard` with `DashboardOptions`:
  - `port?` — integer in $[0, 65535]$, default `0` (ephemeral);
  - `host?` — non-empty bind host, default `localhost`; IPv6 literals may be
    bare (`::1`), `Dashboard.url` brackets them (`http://[::1]:PORT/`);
  - `signal?` — aborting stops the dashboard like `stop()`;
  - `ringCapacity?` — frames retained per channel, integer ≥ 1, default 256;
  - `allowedOrigins?` — extra `scheme://host[:port]` origins allowed to open
    the socket (see *Security*);
  - `onChannelError?(channel, error)` — producer failure hook, default
    `console.error`.

  Invalid options throw `VisualizerError('server')` before anything binds.
- `Dashboard.url` / `.port` — where the client is served.
- `.attachByteStream(name, src: AsyncIterable<Uint8Array>)`
- `.attachSeries(name, src: AsyncIterable<number | {t?, value, band?}>)`
  — bare numbers get an auto-incrementing `t`.
- `.attachMatrix(name, src: AsyncIterable<{rows, cols, data, rowLabels?, colLabels?, range?}>)`
- `.attachStatic(name, json)` — serialized once, up front; a document
  `JSON.stringify` cannot encode (BigInt, cycles, a throwing `toJSON`,
  `undefined`) throws `VisualizerError('invalid_channel')` and registers
  nothing.
- Attach validation: a non-string or empty name, a duplicate name, or a
  source that is not (async) iterable throws `invalid_channel`; attaching
  after `stop()` throws `server`.
- `.stop(): Promise<void>` — see *Design invariants*. Idempotent; also
  triggered by the `signal` option.
- Protocol: `encodeBytesFrame`, `encodeSeriesFrame`, `encodeMatrixFrame`,
  `decodeFrame`, `parseTextMessage`, `isValidRange`, `PROTOCOL_VERSION`,
  `FRAME_KIND`, `HEADER_BYTES`, `SERIES_POINT_BYTES`, `MATRIX_PREFIX_BYTES`.
- `VisualizerError` with `code`:
  - `invalid_channel` — bad name/source/static document at attach time;
  - `protocol` — malformed frame or text message, or a producer emission
    violating the format (matrix size, non-string labels, invalid `range`);
  - `server` — invalid `DashboardOptions`, attach after `stop()`, or the
    runtime failing to bind;
  - `invalid_options` — demo CLI arguments or source selection (unknown flag
    or source, missing value, bad `--port`/`--baud`, malformed
    `SourceOptions`);
  - `aborted` — the caller's `AbortSignal` fired before start.

Live sources plug in structurally — anything with
`stream(opts?): AsyncIterable<Uint8Array>` works, so every
`@mindpeeker/entropy` provider is a valid producer without this package
importing entropy for typing (the dependency exists only for the demo
CLI).

## Theory notes

- A trial of $k$ bits under $H_0$ is $\mathrm{Binomial}(k, \tfrac12)$;
  the demo uses the GCP convention $k = 200$, so
  $z = (S - 100)/\sqrt{50}$ and $\sum(z^2 - 1)$ is the classic
  cumulative-deviation plot, flat in expectation under $H_0$ with
  $\mathrm{Var}[D(t)] \approx 2t$. The demo plots **every** trial the source
  delivers ($t$ is the trial count; the source's own pacing sets the rate) and
  accumulates $D(t)$ with the same Neumaier-compensated sum, in the same order,
  as negentropy's batch `cumulativeDeviation`, so each plotted value equals the
  batch statistic exactly.
- The demo's band is the **two-sided 90% pointwise** envelope
  $[\chi^2_{0.05}(t) - t,\ \chi^2_{0.95}(t) - t]$ (the de Moivre–Laplace
  $\chi^2$ approximation for Binomial trials). Pointwise means an $H_0$ path
  leaves it *somewhere* far more often than 10% of the time — only a
  pre-registered endpoint carries the stated level.
- Windowed negentropy $J(x) = H(\mathcal{N}(\mu,\sigma^2)) - H(x) \ge 0$
  (zero iff Gaussian) uses the Hyvärinen log-cosh contrast from
  `@mindpeeker/negentropy`; the demo plots the raw stream, so values
  hover near 0 — order would show as a sustained rise.
- The demo histogram decays every bin by 0.9 per 256-byte chunk before
  counting it: for uniform bytes each of the 32 bins settles at mean 80,
  standard deviation ≈ 6.4, so bars (drawn as value / max from a zero
  baseline) sit around 70–100 % of the panel height.
- Viridis (Smith & van der Walt) is used for the heatmap because it is
  perceptually uniform and colorblind-safe; the LUT interpolates a
  frozen 10-stop subsample in sRGB, exact at the stops.

## Caveats

- **Bun-only server** (see banner). The client bundle is plain ESM and
  runs in any WebGL2 browser.
- **GL rendering is not CI-testable.** Tests cover the protocol, ring
  buffer, server integration (real sockets, handshake policy, lifecycle),
  the demo plumbing, and every pure client function (scales, ticks, LUT,
  vertex generation, dial tessellation, matrix normalization, directory
  reconciliation) — but nobody in CI looks at pixels. See the checklist
  below.
- `stop()` bounds its waits: on Bun ≤ 1.3 `server.stop(true)`'s promise can
  fail to settle after server-initiated websocket closes even though the
  port is already released, and a source blocked inside an `await` finishes
  its cleanup only once that await settles.
- Frames may be dropped for slow clients (by design); the client shows
  whatever arrives and never asks for retransmission.
- One WebSocket message (one series point, one matrix) per producer
  emission — thin or aggregate upstream if you emit at very high rates.

## Manual verification checklist

After `bun run build`, run `bun dist/cli.js` and open the printed URL:

1. Header shows **connected** (green).
2. Five panels appear: crypto noise, windowed negentropy (logcosh),
   cumulative deviation · two-sided 90% pointwise χ² envelope, byte
   histogram, rate card.
3. The noise bitmap scrolls continuously with fresh random rows.
4. The negentropy chart draws a jittery line near 0 with y-axis ticks.
5. The cumdev chart shows a wandering line inside a widening shaded
   band.
6. The histogram renders 32 viridis-colored bars of similar height, mostly
   in the top third of the panel, fluctuating.
7. The dial shows 4 rings, 44 radial lines, a pulsing pointer at sector
   17, and a slow sweep line — still a circle after resizing the window or
   zooming.
8. Reload the page: panels repopulate immediately (ring replay).
9. Ctrl+C the CLI: the header flips to **disconnected — retrying**; restart
   it on the same `--port` and the charts restart cleanly (no line drawn back
   across the chart).
10. `bun dist/cli.js --source esp32 --serial-path /dev/nonexistent`: the
    terminal prints the ENOENT reason once and the badges read
    `error — …`; with the device plugged in, the panels go live.

## Verification (automated)

```sh
bun run typecheck   # src+test+scripts, the build config, then client (DOM lib, no bun types)
bun test            # protocol, ring, server integration, security, demo, client math
bun run build       # tsc → dist/, Bun.build → dist/client/ (app.js + app.js.map)
```

## Behaviour changes in 0.2.0

- `attachStatic` serializes the document immediately: an unserializable
  document now throws `VisualizerError('invalid_channel')` and registers
  nothing (0.1 registered the channel, threw a raw `TypeError`, and dropped
  every later client with 1006). A document that serializes to nothing
  (`undefined`, a function) is rejected too.
- `createDashboard` validates `port` (integer 0–65535) and `host`
  (non-empty string) and throws `VisualizerError('server')`; 0.1 let
  `Bun.serve` silently bind a different port (`70000` → 65535, `-1`/`NaN` →
  ephemeral). `allowedOrigins` and `onChannelError` are validated as well.
- `/ws` handshakes from another origin get HTTP 403 unless listed in
  `allowedOrigins`; on a loopback bind a non-loopback `Host` is refused too.
  Pages served through a reverse proxy need their public origin in
  `allowedOrigins`.
- Inbound socket messages close the connection (1003); messages over 1 KiB
  are refused by the runtime (0.1 accepted and ignored up to 16 MiB).
- `Dashboard.url` brackets IPv6 hosts (`http://[::1]:PORT/`).
- Producer failures are reported through `onChannelError` (default
  `console.error`, so they now appear on stderr) and as `error` in the
  directory entry; `ChannelInfo` gained `error?` and `range?`,
  `MatrixFrameInput` gained `range?`.
- On connect, all static documents are sent before any retained binary
  frame (0.1 interleaved them per channel in registration order).
- `stop()` calls `return()` on every consumed iterator right away (0.1 only
  stopped at the source's next emission), returns the same promise to every
  caller (0.1 resolved a second call before the drain), and removes its
  `signal` listener.
- Attaching a non-iterable source, or a non-string name, throws
  `invalid_channel` at attach time (0.1 registered the channel and marked it
  `error`). Sync iterables are still accepted.
- Matrix producers: non-string labels or an invalid `range` error the
  channel with `protocol`; a label array mutated in place is now detected.
- `parseTextMessage` validates message structure and throws `protocol` for
  directories/static messages it accepted before (e.g. missing `channels`).
- Client: bar mode normalizes from a zero baseline (0.1 min–max normalized,
  so the smallest bar was always empty and the largest always full); panels
  resize with their box and DPR; panel data is cleared on reconnect; the
  socket uses `wss:` under https; a protocol mismatch closes the socket and
  stops reconnecting; `tessellateDial` rejects a `pointerSector` outside
  $[0, \mathrm{sectors})$ and draws spokes from the centre for a single ring;
  `DashboardHandle` gained `reset()`.
- Client assets are served with `Cache-Control: no-cache`, and `app.js.map`
  is served (0.1 answered 404).
- Demo CLI: every trial is plotted with source-driven pacing (0.1 slept
  150 ms per trial and silently dropped ~97% of trials); the cumdev panel is
  titled `cumulative deviation · two-sided 90% pointwise χ² envelope` (0.1:
  `±0.05 envelope`); the histogram is no longer throttled to one frame per
  400 ms; `--port`/`--baud` must be strict decimal integers (`--baud 921k`
  exits 1 instead of failing at the first read); channel failures are printed;
  Ctrl+C awaits the drain before exiting; the serial source closes its tty
  when a session ends. `resolveSource` throws
  `VisualizerError('invalid_options')` instead of `RangeError`.
