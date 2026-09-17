# @mindpeeker/visualizer

## 0.2.0

### Minor Changes

- The dashboard socket checks the page origin, unserializable static documents no longer break every later client, producer failures are reported, and the demo draws a pointwise band next to an anytime-valid boundary and records hash-chained trials for verified replay. See "Behaviour changes in 0.2.0" in the package README for the full list.

  - BREAKING: `/ws` handshakes whose `Origin` names another host get HTTP 403 unless the origin is listed in the new `allowedOrigins` option; on a loopback bind a non-loopback `Host` header is refused too. Pages served through a reverse proxy need their public origin in `allowedOrigins`.
  - BREAKING: inbound socket messages close the connection (1003) and messages over 1 KiB are refused (0.1.0 accepted up to 16 MiB).
  - BREAKING: `attachStatic` serializes the document immediately. A document that cannot be serialized (BigInt, cycles, a throwing `toJSON`, `undefined`, a function) throws `VisualizerError('invalid_channel')` and registers nothing; 0.1.0 registered the channel and then dropped every later client with close code 1006.
  - BREAKING: `createDashboard` validates `port` (integer 0–65535), `host`, `allowedOrigins` and `onChannelError` and throws `VisualizerError('server')`; 0.1.0 let `Bun.serve` silently bind another port. `Dashboard.url` brackets IPv6 hosts.
  - BREAKING: wire protocol 2 with negotiation. `PROTOCOL_VERSION` is 2 and `MIN_PROTOCOL_VERSION` 1; a client that sends no `v` still gets protocol 1, a malformed `v` gets HTTP 400. Frame kinds 1–3 keep layout byte 1, so decoders compare the first byte with the kind's layout version rather than `PROTOCOL_VERSION`. The new kind 4 carries up to 8 bands per point.
  - BREAKING (types): the `Dashboard` interface gains the required `setNote`; `SeriesPoint`/`SeriesSample` gain `bands`; `ChannelInfo` gains `bandLabels`, `note`, `error` and `range`; `VisualizerErrorCode` gains `invalid_options`.
  - BREAKING: `parseTextMessage` validates message structure and throws `protocol` for directories and static messages it accepted before; attaching a non-iterable source or a non-string name throws `invalid_channel` at attach time; matrix producers with non-string labels or an invalid `range` error the channel.
  - BREAKING: `stop()` calls `return()` on every consumed iterator right away, returns the same promise to every caller and removes its signal listener. On connect, all static documents are sent before retained frames, and the replay to a late joiner is capped by the 4 MiB buffered-amount budget.
  - BREAKING: `engines` names only Bun (`>=1.2`); the package now depends on `@mindpeeker/psi`, and the tarball includes a LICENSE file.
  - Producer failures are reported through `onChannelError` (default `console.error`) and as `error` in the directory entry.
  - Client: bars are drawn from a zero baseline (0.1.0 min–max normalized, so the smallest bar was always empty), panels follow their box size and device pixel ratio, panel data is cleared on reconnect, the socket uses `wss:` under https, and a protocol mismatch stops reconnecting. Assets are served with `Cache-Control: no-cache`, and `app.js.map` is served.
  - Demo CLI: every trial is plotted with source-driven pacing (0.1.0 slept 150 ms per trial and dropped about 97% of trials). The cumulative-deviation panel is labeled as a two-sided 90% pointwise χ² band (0.1.0 called it a "±0.05 envelope") and adds negentropy's time-uniform `netvarBoundary` (α = 0.05). A new panel shows the running netvar Z with the anytime-valid p in its caption. `--record <file>` writes hash-chained psi JSONL v2 trials and `--replay <file>` refuses a broken chain. Health-tested sources are restarted after a session-ending `health_test` and reported in the panel badge. `--port` and `--baud` must be strict decimal integers.
  - New exports: `MIN_PROTOCOL_VERSION`, `isSupportedProtocolVersion`, `MAX_SERIES_BANDS`, `BANDS_PREFIX_BYTES`, `FRAME_KIND.bands`, `isValidRange`, the `allowedOrigins` and `onChannelError` options, and `DashboardHandle.reset()` in the browser client.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @mindpeeker/entropy@0.2.0
  - @mindpeeker/negentropy@0.2.0
  - @mindpeeker/psi@0.2.0
