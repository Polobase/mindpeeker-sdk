# @mindpeeker/visualizer

Real-time dashboard for entropy/negentropy/PSI data: a Bun-native
WebSocket server plus a zero-dependency WebGL2 browser client.

Point any `AsyncIterable` at it — raw bytes, statistic series, matrices,
or a static JSON document — and get a live panel per channel: scrolling
noise bitmap, rolling line chart with labeled envelope bands (e.g. a
pointwise χ² band next to a time-uniform, anytime-valid boundary),
heatmap/bar chart, and a radial rate-card dial. The demo CLI records the
trials behind its charts as a hash-chained psi JSONL v2 file and replays a
verified recording.

> **Bun-only at runtime.** `createDashboard` uses `Bun.serve` and
> `Bun.file`; the demo CLI uses `Bun.argv`. `package.json` therefore declares
> only `engines.bun` (≥ 1.2) — there is no Node.js engine and no Node.js or
> browser entry point for the *server*. The wire protocol (`protocol.ts`) and
> all client code are pure/browser-safe, enforced by
> `test/client-safety.test.ts`.

## Quick start

```sh
# demo dashboard: <source> noise → bitmap, windowed negentropy → series,
# GCP cumulative deviation + pointwise and anytime-valid envelopes → banded
# chart, running netvar Z + anytime p → chart, histogram → bars,
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

**Health badges.** Every physical-noise source (`jitter`, `serial`/`esp32`,
`camera`, `mic`, `hwrng`) runs `@mindpeeker/entropy`'s SP 800-90B health
tests. Its noise panel's badge reads `SP 800-90B health tests: no failures`
until a device session ends with `EntropyError('health_test')` (entropy
retests silently inside a session up to its `maxHealthFailures`); the badge
then shows the failure count and reason, the terminal prints it, and the demo
opens a fresh device session — which reruns the start-up test. After three
sessions in a row fail before delivering a byte, the failure is final and the
panels show `error`. The software CSPRNG is not health-tested and has no
badge note.

The demo plumbing lives in [`src/demo.ts`](src/demo.ts) (`startDemo`,
`startReplay`, `fanOut`, `paced`, `histogramMatrix`, …) with the argument
parser, statistics monitor, recording and health modules under
[`src/demo/`](src/demo/), and the source registry in
[`src/sources.ts`](src/sources.ts); `src/cli.ts` is a thin entry over them.
These modules are internal to the CLI (not package exports).

### Envelopes: pointwise vs anytime-valid

The cumulative-deviation panel plots $D(t) = \sum_{s \le t}(Z_s^2 - 1)$ with
two envelopes, each named in the legend:

- **`two-sided 90% pointwise`** (shaded):
  $[\chi^2_{\text{isf}}(0.95, t) - t,\ \chi^2_{\text{isf}}(0.05, t) - t]$,
  computed per step with `chi2Isf`, so every value is bit-identical to
  negentropy's `significanceEnvelope`. It is the right yardstick for **one**
  pre-registered look at a fixed $t$. Watching it continuously is not: in
  negentropy's seeded simulation, 46% of 3 000-step $H_0$ paths cross its
  upper edge somewhere (and the time-uniform boundaries 0.9–3.2%).
- **`anytime-valid (α = 0.05)`** (a line): the time-uniform boundary
  `netvarBoundary(t, 0.05, { a: 1, b: 1, sided: 'upper' })` from negentropy's
  Gamma-mixture test martingale, computed in $O(1)$ per step. $D(t)$ at or above
  it is exactly $M_t \ge 1/\alpha$, so by Ville's inequality an $H_0$ path
  touches it *anywhere, ever*, with probability at most 5% — however often
  you look and whenever you stop. The mixture covers variance *excess* only
  (the GCP hypothesis), so there is no lower boundary; it is an exact test
  supermartingale for $Z$'s built from independent fair bits.

The second trial panel, **running netvar Z of the Stouffer Z series**, plots
$D(t)/\sqrt{v\,t}$ with $v = 2 - 2/n$ ($n$ fair bits per step: 200 live), the
exact per-step variance of $Z^2 - 1$ — so the value has mean 0 and variance 1
under $H_0$ exactly and is approximately normal for large $t$ — with a
±Φ⁻¹(0.95) pointwise band. Its caption shows the running **anytime p**,
`anytimeP` over the `netvarLogM` path, i.e. $\min(1, 1/\max_{s \le t} M_s)$:
non-increasing, and $P_{H_0}(\exists t: p_t \le \alpha) \le \alpha$. When it
reaches α the caption says `≤ α = 0.05`. Both envelopes and the p-value are
statements about chance under $H_0$; whether a crossing reflects anything
else is the hypothesis under test, not something the chart establishes.

### Recording and replay

```sh
bun dist/cli.js --source esp32 --record session.jsonl   # live, trials written as they are plotted
bun dist/cli.js --replay session.jsonl                  # verify the chain, then replay it
```

`--record <file>` creates a **new** file (an existing file is never
overwritten) and writes the trials behind the two trial panels as a psi JSONL
schema-v2 recording (`recordSession(…, { chain: true })`): a session header,
then one line per 200-bit trial whose `prev` is the SHA-256 of the line before
it. Each line is on disk before its point is plotted; Ctrl+C flushes and
closes the file. Check a recording anywhere with psi's `verifyChain`, and
publish its head to fix it in time.

`--replay <file>` reads the file into memory once, runs `verifyChain` on that
copy first (so the bytes replayed are the bytes verified), and **refuses a
broken chain** (exit 1, e.g. `refusing to replay run.jsonl: hash chain broken
at record 102: line 102 prev does not match the SHA-256 of the line before
it`). A verified recording drives the cumulative-deviation and netvar panels
through the same path the live demo uses — lines → per-round Stouffer Z
$\sum_i z_i/\sqrt N$ over the header's sources → the statistics above — so a
replay plots exactly the values the live session plotted, at the recorded
pace (gaps capped at 1 s). Multi-source psi recordings replay too (one Stouffer
Z per lock-step round). The byte panels need raw bytes, which a trial
recording does not hold, so a replay serves only the two trial panels; the
cumulative-deviation caption names the file and the chain head.

Programmatic:

```ts
import { createDashboard } from '@mindpeeker/visualizer'

const dash = createDashboard({
  port: 0,                                         // 0 = pick a free one
  onChannelError: (channel, error) => log.warn(channel, error), // default: console.error
})
console.log(dash.url)

dash.attachByteStream('noise', provider.stream({ chunkBytes: 256 }))
dash.attachSeries('z', zSamples())                 // numbers or {t?, value, band? | bands?}
dash.attachMatrix('corr', correlationFrames())     // {rows, cols, data: Float32Array, range?}
dash.attachStatic('rate card', { type: 'rate-card', sectors: 44, rings: [0.3, 0.6, 0.9] })
dash.setNote('noise', 'SP 800-90B health tests: no failures') // short status text

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
- **Late joiners see history, in a fixed order, within the budget.** On
  connect a client receives (1) the channel directory for its protocol
  version, (2) every static document, in registration order, then (3) each
  streaming channel's retained frames, oldest first, channel by channel in
  registration order. The replay never exceeds the 4 MiB buffered-amount
  budget: when the retained history is larger, frames are chosen newest first,
  round-robin over the channels, and each channel stops at its first frame
  that does not fit — so it replays a contiguous newest suffix that joins the
  live frames without a gap.
- **The directory is push-updated** on every attach, producer
  end/error (with the error reason), matrix label/range change and series
  band-label change; `setNote` changes are coalesced into at most one update
  per 100 ms.
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

**Protocol version negotiation.** The client opens `/ws?v=2` with the
newest protocol version it speaks; the server answers with
$\min(v, 2)$ in every directory's `version`. A client that sends no `v` (any
client built before protocol 2) gets protocol 1; a malformed `v` (`0`, `abc`,
`2.5`, a repeated `v`) gets HTTP 400. The bundled client accepts protocol 1
or 2 from the server, so it also works against an older server.

Binary frames (all integers/floats **little-endian** via `DataView`):

| offset | size | field |
|---|---|---|
| 0 | u8 | layout version: `1` for kinds 1–3, `2` for kind 4 |
| 1 | u8 | kind (`1` bytes, `2` series, `3` matrix, `4` multi-band series) |
| 2 | u16 | channel id |
| 4 | … | payload (see below) |

| kind | payload |
|---|---|
| 1 `bytes` | the raw chunk, verbatim |
| 2 `series` | repeated 32-byte points: `f64 t, f64 value, f64 lo, f64 hi`; absent band ⇒ `lo = hi = NaN` |
| 3 `matrix` | `u16 rows, u16 cols`, then `rows·cols` row-major `f32` |
| 4 `bands` (protocol 2) | `u16 bandCount` (1–8), then repeated points: `f64 t, f64 value`, then `bandCount × (f64 lo, f64 hi)`; NaN ⇒ no band at that point, ±∞ ⇒ an unbounded side |

The first byte is the layout version of the frame's kind, so frames are
encoded once and shared by every socket, and a protocol-1 decoder rejects
kind 4. A protocol-1 session never receives kind 4: a multi-band emission
reaches it as a kind-2 frame carrying the first band.

Text frames are JSON: `{type: 'directory', version, channels: [{id, name,
kind, status, rowLabels?, colLabels?, range?, bandLabels?, error?, note?}]}`
and `{type: 'static', id, name, data}`. Matrix labels, `range` and series
`bandLabels` ride in the directory, not the binary frames (`bandLabels` only
in protocol 2); `error` is present only while `status` is `'error'`; `note` is
producer status text, an additive field older clients ignore.

`encode*`/`decodeFrame` live in `src/protocol.ts`, shared verbatim by
server and client and exhaustively round-trip tested (including NaN band
handling, alignment-hostile buffer offsets, and malformed-frame
rejection with `VisualizerError('protocol', …)`). `parseTextMessage`
validates structure, not just the type tag: a directory needs an integer
`version` and a `channels` array whose entries have a `u16` id, string name,
known kind/status, string-array labels (`rowLabels`, `colLabels`,
`bandLabels`), a finite `range` with `lo < hi` and a string `error`/`note`; a
static message needs a `u16` id, a string name and `data`. A directory
announcing an unsupported protocol version is returned unchecked so the
client can report the mismatch.

## Panels

- **Noise bitmap** (`bytes`): a 256×256 `R8` texture ring. Each chunk
  fills whole rows via `texSubImage2D` at a wrapping row pointer; the
  fragment shader adds the row offset to the v coordinate mod 1 — one
  quad, no full re-uploads, scrolling for free.
- **Series** (`series`): rolling window of the last 4096 points,
  y-autoscaled over values ∪ finite band bounds. The first band is a
  translucent `TRIANGLE_STRIP` under a `LINE_STRIP`; every further band
  (`bands[1…]`) is drawn as boundary lines along its finite sides only, so a
  one-sided boundary is a single line and a missing band leaves a gap. A
  legend in the bottom-right corner names each band from `bandLabels`; the
  caption shows the latest point and, on a second line, the channel's
  `note`. Y-axis labels sit on their gridlines (below the line when there is
  no room above). Built for the GCP cumulative deviation
  $D(t) = \sum_{s \le t}\bigl(Z(s)^2 - 1\bigr)$ with its pointwise $\chi^2$
  envelope and the anytime-valid boundary (see *Envelopes* above).
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

The other panels show a channel's `note` in the status badge (`live — …`),
and an `error` reason while the channel is in error.

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
- `.attachSeries(name, src: AsyncIterable<number | {t?, value, band?, bands?}>)`
  — bare numbers get an auto-incrementing `t`. `bands` is 1–8
  `SeriesBand`s `{lo, hi, label?}` (never together with `band`; malformed
  bands error the channel with `protocol`); labels are published in the
  directory as `bandLabels`, and a sample without `bands` keeps the last
  published labels.
- `.attachMatrix(name, src: AsyncIterable<{rows, cols, data, rowLabels?, colLabels?, range?}>)`
- `.attachStatic(name, json)` — serialized once, up front; a document
  `JSON.stringify` cannot encode (BigInt, cycles, a throwing `toJSON`,
  `undefined`) throws `VisualizerError('invalid_channel')` and registers
  nothing.
- `.setNote(name, note | undefined)` — short status text for a channel
  (`ChannelInfo.note`, cut to 200 characters), sent to connected clients with
  the next directory update (coalesced to at most one per 100 ms) and to late
  joiners with their directory. An unknown channel or a non-string note throws
  `invalid_channel`; after `stop()`, `server`.
- Attach validation: a non-string or empty name, a duplicate name, or a
  source that is not (async) iterable throws `invalid_channel`; attaching
  after `stop()` throws `server`.
- `.stop(): Promise<void>` — see *Design invariants*. Idempotent; also
  triggered by the `signal` option.
- Protocol: `encodeBytesFrame`, `encodeSeriesFrame(id, points, { version? })`
  (kind 4 when a point has `bands`; `version: 1` downgrades to kind 2),
  `encodeMatrixFrame`, `decodeFrame`, `parseTextMessage`, `isValidRange`,
  `isSupportedProtocolVersion`, `PROTOCOL_VERSION` (2), `MIN_PROTOCOL_VERSION`
  (1), `FRAME_KIND`, `HEADER_BYTES`, `SERIES_POINT_BYTES`,
  `MATRIX_PREFIX_BYTES`, `BANDS_PREFIX_BYTES`, `MAX_SERIES_BANDS` (8); types
  `SeriesBand`, `SeriesPoint`, `SeriesSample`, `ChannelInfo`, ….
- `VisualizerError` with `code`:
  - `invalid_channel` — bad name/source/static document at attach time, or a
    `setNote` on an unknown channel / with a non-string note;
  - `protocol` — malformed frame or text message, or a producer emission
    violating the format (matrix size, non-string labels, invalid `range`,
    malformed series `bands`);
  - `server` — invalid `DashboardOptions`, attach after `stop()`, or the
    runtime failing to bind;
  - `invalid_options` — demo CLI arguments or source selection (unknown flag
    or source, missing value, bad `--port`/`--baud`, `--replay` combined with
    live flags, malformed `SourceOptions`), a `--record` file that exists or
    cannot be written, or a `--replay` file that cannot be read or whose hash
    chain is broken;
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
- The demo's shaded band is the **two-sided 90% pointwise** envelope
  $[\chi^2_{0.05}(t) - t,\ \chi^2_{0.95}(t) - t]$ (the de Moivre–Laplace
  $\chi^2$ approximation for Binomial trials). Pointwise means an $H_0$ path
  leaves it *somewhere* far more often than 10% of the time — only a
  pre-registered endpoint carries the stated level. The **anytime-valid**
  boundary beside it carries its level along the whole path (Ville 1939;
  Ramdas et al. 2023, *Game-theoretic statistics and safe anytime-valid
  inference*); it is wider for exactly that reason — at $t = 1000$ the
  one-sided boundary sits at $D \approx 159$ where the pointwise band's upper
  edge is at $\approx 75$.
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
2. Six panels appear: crypto noise, windowed negentropy (logcosh),
   cumulative deviation · pointwise χ² band and anytime-valid boundary,
   running netvar Z of the Stouffer Z series, byte histogram, rate card.
3. The noise bitmap scrolls continuously with fresh random rows.
4. The negentropy chart draws a jittery line near 0 with y-axis ticks.
5. The cumdev chart shows a wandering line inside a widening shaded band,
   an orange boundary line well above the band, and a legend naming
   `two-sided 90% pointwise` and `anytime-valid (α = 0.05)`; the netvar chart
   shows a line around 0 in a ±1.64 band and `anytime p = …` under its
   caption.
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
    `error — …`; with the device plugged in, the panels go live and the noise
    badge reads `live — SP 800-90B health tests: no failures`.
11. `bun dist/cli.js --record /tmp/run.jsonl`, let it run, Ctrl+C; then
    `bun dist/cli.js --replay /tmp/run.jsonl`: two panels replay the same
    curves, the cumdev caption reads `replay of run.jsonl · chain ok · head …`.
    Edit one `sum` in the file and replay again: the CLI exits 1 with
    `refusing to replay … hash chain broken at record …`.

## Verification (automated)

```sh
bun run typecheck   # src+test+scripts, the build config, then client (DOM lib, no bun types)
bun test            # protocol, ring, replay budget, server integration, security, demo
                    # (monitor vs negentropy, record/replay chains, health), client math
bun run build       # tsc → dist/, Bun.build → dist/client/ (app.js + app.js.map)
```

## Behaviour changes in 0.2.0

- **Wire protocol 2** with negotiation: the client requests `/ws?v=2`;
  `PROTOCOL_VERSION` is now 2 and `MIN_PROTOCOL_VERSION` 1. A client that
  sends no `v` still gets protocol 1 unchanged; a malformed `v` gets HTTP 400.
  Kinds 1–3 keep layout byte `1`, so a decoder compares the first byte with
  the frame kind's layout version (1, or 2 for the new kind 4) instead of
  with `PROTOCOL_VERSION`. `encodeSeriesFrame` emits kind 4 for points with
  `bands` (`{ version: 1 }` downgrades); `decodeFrame` accepts kind 4;
  `SeriesPoint`/`SeriesSample` gained `bands`, `ChannelInfo` gained
  `bandLabels` and `note`; `parseTextMessage` validates `bandLabels`/`note` and
  checks entries of every supported version. The bundled client accepts
  protocol 1 or 2 from a server.
- `Dashboard.setNote` is new (a required member of the `Dashboard`
  interface — breaks object literals implementing it).
- The replay to a late joiner respects the 4 MiB buffered-amount budget (0.1
  sent the whole retained history regardless): each channel replays its
  newest frames that fit.
- A matrix channel without labels or `range` no longer sends a redundant
  directory update with its first frame.
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
- Demo CLI, envelopes: the cumulative-deviation panel is titled
  `cumulative deviation · pointwise χ² band and anytime-valid boundary` and
  draws the pointwise band (computed with `chi2Isf`, bit-identical to
  `significanceEnvelope`) plus negentropy's time-uniform `netvarBoundary`
  (α = 0.05, one-sided Gamma(1, 1) mixture), both labeled; a new sixth panel
  `running netvar Z of the Stouffer Z series` shows $D/\sqrt{v\,t}$ with the
  anytime-valid p in its caption. Trials now flow as hash-chained psi JSONL v2
  lines (the `@mindpeeker/psi` dependency is new), `--record <file>` persists
  them (never overwriting a file), `--replay <file>` verifies the chain and
  refuses a broken one. `startDemo` is now async and `startReplay` new;
  `cumdevSeries` maps monitor points instead of reading bytes.
- Demo CLI, health: health-tested sources are wrapped so a session ending
  with `EntropyError('health_test')` is reported (badge note, terminal line)
  and restarted; three failures in a row before any output are final.
- Demo CLI: every trial is plotted with source-driven pacing (0.1 slept
  150 ms per trial and silently dropped ~97% of trials); the cumdev panel
  title names its bands (0.1: `cumulative deviation ±0.05 envelope`, which was
  a 90% pointwise band); the histogram is no longer throttled to one frame per
  400 ms; `--port`/`--baud` must be strict decimal integers (`--baud 921k`
  exits 1 instead of failing at the first read); channel failures are printed;
  Ctrl+C awaits the drain before exiting; the serial source closes its tty
  when a session ends. `resolveSource` throws
  `VisualizerError('invalid_options')` instead of `RangeError`.
