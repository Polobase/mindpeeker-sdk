# Data sources

Public feeds that the packages read, or that analyses built on them are likely to need. No
feed data is bundled in the npm packages (see [`data-licenses.md`](data-licenses.md)); check
each provider's terms before redistributing what you download. Dated statements were checked
on the date given and can go stale.

## Global Consciousness Project basket files (GCP 1.0)

The GCP archive publishes one gzip-compressed CSV file per day of network data at

```text
https://global-mind.org/data/eggsummary/YYYY/basketdata-YYYY-MM-DD.csv.gz
```

The format is documented by the project ([basket CSV format](https://global-mind.org/basket_CSV_v2.html),
[data retrieval](http://global-mind.org/data/retrieval.html),
[data access](https://www.global-mind.org/data_access.html)); the files are written by John
Walker's `basketran`. The research workflow found files through 2025-11-01 when it checked the
archive in September 2026. `parseBasketCsv` in `@mindpeeker/psi` reads them:

| Record | Fields |
|---|---|
| `10` protocol | item 1 samples per record, 2 seconds per record, 3 records per packet, 4 trial size |
| `11` content | item 1 eggs reporting, 2 start and 3 end (Unix seconds, optional civil time), 4 seconds of data |
| `12` egg IDs | `"gmtime"`, a civil-time label (void if suppressed), then one egg ID per data column |
| `13` data | Unix time, civil time (or void), then one trial value per egg: the number of one-bits in a 200-bit trial |

Rules that matter for analysis:

- **A void field is a missing sample, never 0.** Every second has a type-13 row, even when all
  eggs are missing.
- **The GCP's own exclusion** removes trial values above 145 and below 55 from 200-bit files.
  `parseBasketCsv` applies it by default (`GCP_BASKET_FILTER`); `filter: false` keeps every
  value.
- **The formal GCP analyses normalized each egg by its empirical mean and variance**, not by
  the theoretical binomial moments. Pass `calibration: { history }` to psi's `analyzeEvent` to
  do the same.
- The parser is strict: contiguous one-per-second rows, civil times that match their Unix
  times, one value per egg column, and a row count equal to "seconds of data", so a truncated
  download is an error rather than a shorter day. A real file (2015-01-01, 41 eggs × 86 400
  seconds) parses in about 1.1 s.

Bun 1.3.1 has no global `DecompressionStream`; decompress with `Bun.gunzipSync` and pass the
text. In browsers, Deno and Node, the psi README shows the streaming form.

```ts
import { analyzeEvent, parseBasketCsv } from '@mindpeeker/psi'

const url = 'https://global-mind.org/data/eggsummary/2015/basketdata-2015-01-01.csv.gz'
const gzipped = new Uint8Array(await (await fetch(url)).arrayBuffer())
const text = new TextDecoder().decode(Bun.gunzipSync(gzipped))

const day = await parseBasketCsv(text, { eggs: [1, 37, 103, 108, 110], align: 'complete' })
const event = analyzeEvent(day.series, { startMs: day.startMs, endMs: day.startMs + 3_600_000 })
console.log(day.protocol.trialSize, day.missing, day.filtered, event)
```

The psi test fixtures are synthetic files generated to this format; no GCP data is checked in.

## Geomagnetic and solar indices

No package reads these feeds yet (a `geomag` package is proposed for a later release).
Time-of-day and sidereal-time analyses use `@mindpeeker/ephemeris`; an analysis that relates
trial outcomes to geomagnetic activity has to fetch the indices itself. The hypothesis that
psi performance depends on geomagnetic activity or local sidereal time is contested: see the
ephemeris README for the Spottiswoode local-sidereal-time claim, its seasonal confound, and
later analyses.

### NOAA Space Weather Prediction Center

JSON products are listed at <https://services.swpc.noaa.gov/json/> and
<https://services.swpc.noaa.gov/products/>, for example the 1-minute planetary K index
(`json/planetary_k_index_1m.json`), `products/noaa-planetary-k-index.json` and the hourly Dst
(`json/geospace/geospace_dst_1_hour.json`).

**2026 format changes.** NWS
[Service Change Notice 26-21](https://www.weather.gov/media/notification/pdf_2026/scn26-21_Data_Format_Changes_Impacting_SWPC_Products.pdf)
(issued 2026-03-02) announced:

- **On or about 2026-03-31**, `products/kyoto-dst.json`, `products/10cm-flux-30-day.json`,
  `products/noaa-planetary-k-index.json` and `products/noaa-planetary-k-index-forecast.json`
  changed from "a format where the first entry contains the keys and the subsequent entries
  contain the corresponding values" (an array of arrays with a header row) to one JSON object
  per record with key-value pairs. `products/summary/10cm-flux.json`,
  `products/summary/solar-wind-mag-field.json` and `products/summary/solar-wind-speed.json`
  gained the outer brackets of a standard JSON array. In all seven, values other than
  `time_tag` became unquoted numbers. Static examples of the new formats are at
  <https://services.swpc.noaa.gov/text/scn/fy26-03/>.
- **On or about 2026-04-30**, the real-time solar wind products under `products/solar-wind/`
  (`mag-` and `plasma-` files for 1-day, 2-hour, 3-day, 5-minute, 6-hour and 7-day, and
  `ephemerides.json`) were removed. Their replacements are `json/rtsw/rtsw_mag_1m.json`,
  `json/rtsw/rtsw_wind_1m.json` and `json/rtsw/rtsw_ephemerides_1h.json`, which add a `source`
  field (the satellite) and an `active` flag (whether SWPC forecasters considered that satellite
  active), carry numeric values, and cover four of the old time frames (1-day, 2-hour, 5-minute,
  6-hour); 3-day and 7-day users must retrieve and keep the 1-day file. Renamed fields:
  `density` → `proton_density`, `speed` → `proton_speed`, `temperature` →
  `proton_temperature`, `lon_gsm` → `phi_gsm`, and `lat_gsm` → `theta_bsm` (as printed in the
  notice).

A parser for these feeds should accept both shapes for archived downloads made before the
change.

### GFZ Potsdam Kp, ap and Hpo indices

GFZ publishes the definitive Kp index series (DOI
[10.5880/Kp.0001](https://doi.org/10.5880/Kp.0001)) with nowcasts and the Hp30/Hp60 indices at
<https://kp.gfz.de/en/data>: text files (for example `Kp_ap_Ap_SN_F107_since_1932.txt`), FTP,
and a JSON web service of the form

```text
https://kp.gfz.de/app/json/?start=2026-01-30T00:00:00Z&end=2026-02-02T23:59:59Z&index=Kp&status=def
```

(the format is described at <https://kp.gfz.de/app/format/json.txt>). The research brief
records the licence as CC BY 4.0; the data page checked on 2026-09-17 did not show a licence
statement, so confirm the terms on the DOI landing page before redistributing.

No machine-readable feed of Schumann resonance measurements was found; claims that rely on one
cannot be checked with public data.

## Randomness beacons

Public beacons are read by `@mindpeeker/entropy` providers. Beacon output is public by design:
use it for commitments and time anchors, never as a secret. The entropy README has the full
provider table and a per-beacon table of what `verify` establishes; the dated facts below were
checked live by the implementation work on 2026-09-17.

| Beacon | Provider | Cadence | Verification in the SDK | Notes |
|---|---|---|---|---|
| drand (League of Entropy) | `drand()` | 3 s rounds | `verify: 'structural'`: chain parameters match the pinned `DRAND_CHAINS` (`quicknet`, `default`, `evmnet`), signature length, round not in the future, `randomness` = SHA-256(signature). The BLS signature is not verified | `drandRoundAt` / `drandRoundTime` convert between rounds and time |
| NIST Randomness Beacon 2.0 | `nistBeacon()` | 60 s pulses | `verify: 'hash'` (output hash and chain linkage) or `true` (adds certificate id and RSA PKCS#1 v1.5 / SHA-512 signature) | NIST calls the service a beta and NIST IR 8213 is still an initial public draft. Chain 2 started 2022-09-21. No pulses between 2/1525305 (2025-10-01T14:08Z) and 2/1525306 (2025-11-13T14:00Z). Since 2/1925734 (2026-09-03T21:08Z) pulses carry 512-byte signatures but name a 2048-bit certificate, so `verify: true` fails; `'hash'` passes. The deployed byte layout differs from the draft (uint32 length prefixes) |
| NQSN (Singapore) | `nqsn()` | 60 s | `verify: true` passes end to end | |
| Inmetro (Brazil) | `inmetro()` | `variant: 'combination'`: 10 min | `verify: 'hash'` passes | the certificate route answered HTTP 400, so `verify: true` fails; an incomplete TLS chain breaks Node and Bun `fetch` |
| Random UChile | `uchile()` | 60 s | none: pulses use cipherSuite 1, which is not verifiable here | |
| CURBy (CU Boulder and NIST) | `curby()` | — | digest length matches its multihash code; freshness guard | Twine chain with 64-byte SHA3-512 digests. The JWS is not verified, and using the block CID digest as the pulse value is this library's choice, not a confirmed CURBy definition. The CURBy-Q round API has been stalled since round 28297 (2025-08-22) |
| Ethereum RANDAO | `randao()` | one completed epoch per 6.4 min | shape only | block proposers can bias it by about one bit |
| Bitcoin, Solana, Tezos, Flow | `bitcoinBeacon()`, `solanaBeacon()`, `tezosBeacon()`, `flowBeacon()` | Bitcoin ~10 min, Solana ~400 ms | shape checks only (Tezos: base58check of the block hash) | block producers can influence these values (Bitcoin miners at high cost, Solana leaders); Tezos is read through the TzKT indexer; see the entropy README caveats |

To anchor a registration or a recording in time, store the beacon round with the record
(`result.sources[i].rounds`, or `getRound(n)` to re-fetch) and see `@mindpeeker/ledger`
`TimeBracket` records: a beacon round gives a no-earlier-than bound, and a no-later-than bound
needs an external witness.

Cloud QRNG services (ANU, RANDOM.ORG, QCi, SuperRand, Outshift and others) are private sources
rather than beacons; their quotas and authentication are listed in the entropy README's provider
table.
