# @mindpeeker/visualizer

Real-time dashboard for entropy/negentropy/PSI data: a Bun-native
WebSocket server plus a zero-dependency WebGL2 browser client.

Point any `AsyncIterable` at it — raw bytes, statistic series, matrices,
or a static JSON document — and get a live panel per channel: scrolling
noise bitmap, rolling line chart with significance-envelope shading,
heatmap/bar chart, and a radial rate-card dial.

> **Bun-only at runtime.** `createDashboard` uses `Bun.serve` and
> `Bun.file`; the demo CLI uses `Bun.argv`. This package deliberately
> trades portability for a dependency-free server — there is no Node.js
> or browser entry point for the *server*. The wire protocol
> (`protocol.ts`) and all client code are pure/browser-safe, enforced by
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
hardware's health-tested raw samples). A single device session is fanned out to
every panel, so one camera or serial port is opened **exactly once**; if the
device is absent the byte panels show an `error` status while the server stays
up. The source registry lives in [`src/sources.ts`](src/sources.ts) and is used
only by the CLI — the library API is unchanged.

Programmatic:

```ts
import { createDashboard } from '@mindpeeker/visualizer'

const dash = createDashboard({ port: 0 })          // port 0 = pick a free one
console.log(dash.url)

dash.attachByteStream('noise', provider.stream({ chunkBytes: 256 }))
dash.attachSeries('z', zSamples())                 // numbers or {t?, value, band?}
dash.attachMatrix('corr', correlationFrames())     // {rows, cols, data: Float32Array}
dash.attachStatic('rate card', { type: 'rate-card', sectors: 44, rings: [0.3, 0.6, 0.9] })

await dash.stop()                                  // clean 1000 close to every client
```

## Architecture

```
producers (AsyncIterable)          Bun server                      browser
─────────────────────────   ───────────────────────────   ─────────────────────────
attachByteStream ──┐         per-channel ring buffer        WebSocket client
attachSeries ──────┼──▶ encode ──▶ (drop-oldest, 256) ──▶  decode ──▶ panel registry
attachMatrix ──────┘                    │                        │
attachStatic ──▶ JSON                   ├─ fan-out to sockets    ├─ noise bitmap (GL ring texture)
                                        │  (buffered-amount      ├─ line chart + band (GL strips)
    Bun.serve ◀── HTTP GET /            │   budget, drop)        ├─ heatmap / bars (R32F + LUT)
    dist/client (static)                └─ replay to joiners     └─ radial dial (line lists)
```

Design invariants:

- **Producers never block.** Frames go into a per-channel drop-oldest
  ring buffer (default 256; `ringCapacity` option) and are fanned out
  only to sockets whose `getBufferedAmount()` is under a 4 MiB budget.
  A slow, hung, or absent client costs a producer nothing.
- **Late joiners see history.** On connect a client receives the channel
  directory (JSON), every static document, then each channel's retained
  frames, oldest first.
- **The directory is push-updated** on every attach, producer
  end/error, and matrix-label change.

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
kind, status, rowLabels?, colLabels?}]}` and `{type: 'static', id, name,
data}`. Matrix labels ride in the directory, not the binary frames.

`encode*`/`decodeFrame` live in `src/protocol.ts`, shared verbatim by
server and client and exhaustively round-trip tested (including NaN band
handling, alignment-hostile buffer offsets, and malformed-frame
rejection with `VisualizerError('protocol', …)`).

## Panels

- **Noise bitmap** (`bytes`): a 256×256 `R8` texture ring. Each chunk
  fills whole rows via `texSubImage2D` at a wrapping row pointer; the
  fragment shader adds the row offset to the v coordinate mod 1 — one
  quad, no full re-uploads, scrolling for free.
- **Series** (`series`): rolling window of the last 4096 points,
  y-autoscaled over values ∪ band bounds. The envelope band is a
  translucent `TRIANGLE_STRIP` under a `LINE_STRIP`. Built for the GCP
  cumulative deviation $D(t) = \sum_{s \le t}\bigl(Z(s)^2 - 1\bigr)$
  with its pointwise $\chi^2$ quantile envelope
  $\chi^2_{1-p}(t) - t$ (Nelson & Bancel; see `@mindpeeker/negentropy`
  for the caveat that the envelope is *pointwise*, not path-wise).
- **Matrix** (`matrix`): min–max-normalized `R32F` texture colored
  through a 256×1 viridis LUT (frozen 10-stop table, linear sRGB
  interpolation). A $1 \times N$ matrix switches to bar mode — the same
  texture drives a bar-height cutoff in the shader.
- **Radial dial** (`static`): renders `{type: 'rate-card', sectors,
  rings, pointerSector?}` — the Malcolm Rae base-44 card layout —
  as tessellated line lists (sector 0 at 12 o'clock, clockwise), with a
  pulsing pointer and a slow radar sweep as the phase animation.

**Why a 2D-canvas overlay for text/axes:** WebGL2 core cannot rasterize
text; a glyph atlas or SDF font would break the zero-dependency budget.
Each panel stacks a transparent `CanvasRenderingContext2D` canvas over
its GL canvas — GL draws data, 2D draws crisp DPI-aware words.

## API

- `createDashboard(opts?: {port?, host?, signal?, ringCapacity?}): Dashboard`
- `Dashboard.url` / `.port` — where the client is served.
- `.attachByteStream(name, src: AsyncIterable<Uint8Array>)`
- `.attachSeries(name, src: AsyncIterable<number | {t?, value, band?}>)`
  — bare numbers get an auto-incrementing `t`.
- `.attachMatrix(name, src: AsyncIterable<{rows, cols, data, rowLabels?, colLabels?}>)`
- `.attachStatic(name, json)`
- `.stop(): Promise<void>` — closes every socket with code 1000, then
  stops the server. Idempotent; also triggered by the `signal` option.
- Protocol: `encodeBytesFrame`, `encodeSeriesFrame`, `encodeMatrixFrame`,
  `decodeFrame`, `parseTextMessage`, `PROTOCOL_VERSION`, `FRAME_KIND`.
- `VisualizerError` with `code: 'invalid_channel' | 'protocol' | 'server'
  | 'aborted'` (`protocol` is a refinement added for malformed-frame
  rejection, symmetric between server and client).

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
  $\operatorname{Var}[D(t)] = 2t$.
- Windowed negentropy $J(x) = H(\mathcal{N}(\mu,\sigma^2)) - H(x) \ge 0$
  (zero iff Gaussian) uses the Hyvärinen log-cosh contrast from
  `@mindpeeker/negentropy`; the demo plots the raw stream, so values
  hover near 0 — order would show as a sustained rise.
- Viridis (Smith & van der Walt) is used for the heatmap because it is
  perceptually uniform and colorblind-safe; the LUT interpolates a
  frozen 10-stop subsample in sRGB, exact at the stops.

## Caveats

- **Bun-only server** (see banner). The client bundle is plain ESM and
  runs in any WebGL2 browser.
- **GL rendering is not CI-testable.** Tests cover the protocol, ring
  buffer, server integration (real sockets), and every pure client
  function (scales, ticks, LUT, vertex generation, dial tessellation) —
  but nobody in CI looks at pixels. See the checklist below.
- The significance envelope drawn by the demo is **pointwise**; an $H_0$
  path wanders outside it somewhere far more often than $p$.
- `stop()` bounds its wait on Bun ≤ 1.3, where `server.stop(true)`'s
  promise can fail to settle after server-initiated websocket closes
  even though the port is already released.
- Frames may be dropped for slow clients (by design); the client shows
  whatever arrives and never asks for retransmission.
- One WebSocket message per producer emission — batch upstream if you
  emit at very high rates (e.g. accumulate series points before
  yielding).

## Manual verification checklist

After `bun run build`, run `bun dist/cli.js` and open the printed URL:

1. Header shows **connected** (green).
2. Five panels appear: crypto noise, windowed negentropy, cumulative
   deviation ±0.05 envelope, byte histogram, rate card.
3. The noise bitmap scrolls continuously with fresh random rows.
4. The negentropy chart draws a jittery line near 0 with y-axis ticks.
5. The cumdev chart shows a wandering line inside a widening shaded
   band.
6. The histogram renders ~32 viridis-colored bars of similar height,
   fluctuating.
7. The dial shows 4 rings, 44 radial lines, a pulsing pointer at sector
   17, and a slow sweep line.
8. Reload the page: panels repopulate immediately (ring replay).
9. Ctrl+C the CLI: the header flips to **disconnected — retrying**.

## Verification (automated)

```sh
bun run typecheck   # src+test+scripts, then client (DOM lib, no bun types)
bun test            # 68 tests: protocol, ring, server integration, client math
bun run build       # tsc → dist/, Bun.build → dist/client/
```
