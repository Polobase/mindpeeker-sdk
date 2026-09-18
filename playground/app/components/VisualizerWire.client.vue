<script setup lang="ts">
/**
 * The wire protocol, inspected live: every frame the panels above received was
 * produced by `encode*` and read back by `decodeFrame`, so the sizes and the
 * layout bytes in this table are the ones a WebSocket would have carried.
 */
import { cumdevSample } from '@viz/src/demo/monitor'
import {
  BANDS_PREFIX_BYTES,
  decodeFrame,
  encodeSeriesFrame,
  FRAME_KIND,
  HEADER_BYTES,
  isSupportedProtocolVersion,
  isValidRange,
  MATRIX_PREFIX_BYTES,
  MAX_SERIES_BANDS,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  SERIES_POINT_BYTES,
} from '@viz/src/protocol'
import { CHANNEL, HISTOGRAM_BINS } from '~/lib/visualizer/channels'
import { type DriverSnapshot, toPoint } from '~/lib/visualizer/driver'
import { fmtBytes, fmtNum, toHex } from '~/lib/format'

const props = defineProps<{ snapshot?: DriverSnapshot }>()

const LAYOUT = [
  { offset: '0', size: 'u8', field: 'layout version — 1 for kinds 1–3, 2 for kind 4' },
  { offset: '1', size: 'u8', field: 'kind — 1 bytes, 2 series, 3 matrix, 4 multi-band series' },
  { offset: '2', size: 'u16', field: 'channel id (little-endian, like every multi-byte field)' },
  { offset: '4', size: '…', field: 'payload' },
]

/** Exact encoded size of each channel's frame, from the documented layout. */
const expectedSizes = computed(() => {
  const chunk = props.snapshot?.chunks
    ? Math.round((props.snapshot.bytes ?? 0) / props.snapshot.chunks)
    : 0
  return new Map<number, { formula: string; bytes: number }>([
    [
      CHANNEL.noise,
      { formula: `${HEADER_BYTES} + chunk (${chunk} B)`, bytes: HEADER_BYTES + chunk },
    ],
    [
      CHANNEL.negentropy,
      {
        formula: `${HEADER_BYTES} + 1 × ${SERIES_POINT_BYTES}`,
        bytes: HEADER_BYTES + SERIES_POINT_BYTES,
      },
    ],
    [
      CHANNEL.cumdev,
      {
        formula: `${HEADER_BYTES} + ${BANDS_PREFIX_BYTES} + 1 × 16·(1 + 2 bands)`,
        bytes: HEADER_BYTES + BANDS_PREFIX_BYTES + 16 * 3,
      },
    ],
    [
      CHANNEL.netvar,
      {
        formula: `${HEADER_BYTES} + ${BANDS_PREFIX_BYTES} + 1 × 16·(1 + 1 band)`,
        bytes: HEADER_BYTES + BANDS_PREFIX_BYTES + 16 * 2,
      },
    ],
    [
      CHANNEL.histogram,
      {
        formula: `${HEADER_BYTES} + ${MATRIX_PREFIX_BYTES} + 4 × ${HISTOGRAM_BINS} f32`,
        bytes: HEADER_BYTES + MATRIX_PREFIX_BYTES + 4 * HISTOGRAM_BINS,
      },
    ],
  ])
})

/** The expected formula and size for one channel, plus whether the wire agrees. */
function expectedFor(row: { channelId: number; lastBytes: number }): {
  formula: string
  bytes: number
  matches: boolean
} {
  const hit = expectedSizes.value.get(row.channelId)
  if (!hit) return { formula: '—', bytes: 0, matches: false }
  return { ...hit, matches: hit.bytes === row.lastBytes }
}

/** A live round trip: the latest cumulative-deviation point, encoded and read back. */
const roundTrip = computed(() => {
  const point = props.snapshot?.point
  if (!point) return undefined
  const frame = encodeSeriesFrame(CHANNEL.cumdev, [toPoint(cumdevSample(point))])
  const decoded = decodeFrame(frame)
  if (decoded.kind !== 'series') return undefined
  const first = decoded.points[0]
  return {
    frame,
    hex: toHex(frame, { max: 40, sep: ' ' }),
    bytes: frame.byteLength,
    layoutVersion: frame[0] ?? 0,
    kindByte: frame[1] ?? 0,
    channelId: decoded.channelId,
    t: first?.t ?? 0,
    value: first?.value ?? 0,
    bands: first?.bands ?? [],
  }
})

const versionChecks = [1, 2, 3].map((v) => ({ v, ok: isSupportedProtocolVersion(v) }))
const rangeChecks: { text: string; ok: boolean }[] = [
  { text: '[0, 1]', ok: isValidRange([0, 1]) },
  { text: '[1, 0]', ok: isValidRange([1, 0]) },
  { text: '[0, ∞)', ok: isValidRange([0, Number.POSITIVE_INFINITY]) },
]

const snippet = `import {
  decodeFrame, encodeSeriesFrame, FRAME_KIND, MAX_SERIES_BANDS, PROTOCOL_VERSION,
} from '@mindpeeker/visualizer'

// One point, two envelopes → frame kind 4 (protocol 2), layout byte 2.
const frame = encodeSeriesFrame(2, [{
  t, value: deviation,
  bands: [
    { lo: pointwiseLo, hi: pointwiseHi, label: 'two-sided 90% pointwise' },
    { lo: -Infinity,   hi: anytimeUpper, label: 'anytime-valid (α = 0.05)' }, // one-sided
  ],
}])
frame[0] === 2 && frame[1] === FRAME_KIND.bands   // layout version, kind
encodeSeriesFrame(2, points, { version: 1 })      // downgrade: kind 2, first band only

const decoded = decodeFrame(frame)                // { kind: 'series', channelId, points }
// ±Infinity survives verbatim (an unbounded side), NaN means "no band here".`
</script>

<template>
  <DemoSection
    title="Frames on the wire"
    :api="[
      'encodeSeriesFrame',
      'decodeFrame',
      'FRAME_KIND',
      'PROTOCOL_VERSION',
      'HEADER_BYTES',
      'SERIES_POINT_BYTES',
      'BANDS_PREFIX_BYTES',
      'isSupportedProtocolVersion',
      'isValidRange',
    ]"
    description="Nothing here is a mock: each row counts frames that really went through
      encode → decode on their way to a panel, and the expected column is the size the documented
      layout predicts. Protocol 2 added frame kind 4, which carries several envelopes per point —
      that is what lets one chart show a pointwise band and an anytime-valid boundary at once."
  >
    <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-4">
      <StatTile label="PROTOCOL_VERSION" :value="PROTOCOL_VERSION" :digits="0" size="sm" tone="primary" />
      <StatTile label="MIN_PROTOCOL_VERSION" :value="MIN_PROTOCOL_VERSION" :digits="0" size="sm" />
      <StatTile label="HEADER_BYTES" :value="HEADER_BYTES" :digits="0" size="sm" />
      <StatTile label="SERIES_POINT_BYTES" :value="SERIES_POINT_BYTES" :digits="0" size="sm" />
      <StatTile label="BANDS_PREFIX_BYTES" :value="BANDS_PREFIX_BYTES" :digits="0" size="sm" />
      <StatTile label="MAX_SERIES_BANDS" :value="MAX_SERIES_BANDS" :digits="0" size="sm" />
    </div>

    <div class="overflow-x-auto rounded-md border border-default">
      <table class="w-full text-sm">
        <caption class="sr-only">
          Frames encoded and decoded per channel
        </caption>
        <thead class="text-muted text-xs uppercase bg-elevated/50">
          <tr>
            <th scope="col" class="text-left py-1.5 px-3 font-medium">channel</th>
            <th scope="col" class="text-left py-1.5 px-3 font-medium">kind</th>
            <th scope="col" class="text-right py-1.5 px-3 font-medium">layout byte</th>
            <th scope="col" class="text-right py-1.5 px-3 font-medium">last frame</th>
            <th scope="col" class="text-left py-1.5 px-3 font-medium">expected size</th>
            <th scope="col" class="text-right py-1.5 px-3 font-medium">frames</th>
            <th scope="col" class="text-right py-1.5 px-3 font-medium">total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!snapshot?.wire.length">
            <td colspan="7" class="py-3 px-3 text-muted text-sm">
              No frames yet — start the dashboard above.
            </td>
          </tr>
          <tr
            v-for="row in snapshot?.wire ?? []"
            :key="row.channelId"
            class="border-t border-default text-xs"
          >
            <td class="py-1.5 px-3 max-w-[18rem] truncate" :title="row.channel">
              {{ row.channelId }} · {{ row.channel }}
            </td>
            <td class="py-1.5 px-3 font-mono">{{ row.kindName }} ({{ row.kindByte }})</td>
            <td class="py-1.5 px-3 text-right font-mono tabular-nums">{{ row.layoutVersion }}</td>
            <td class="py-1.5 px-3 text-right font-mono tabular-nums">{{ row.lastBytes }} B</td>
            <td class="py-1.5 px-3 font-mono text-dimmed whitespace-nowrap">
              {{ expectedFor(row).formula }}
              <span v-if="expectedFor(row).matches" class="text-success">
                = {{ expectedFor(row).bytes }} B ✓
              </span>
            </td>
            <td class="py-1.5 px-3 text-right font-mono tabular-nums">
              {{ fmtNum(row.frames, { digits: 0 }) }}
            </td>
            <td class="py-1.5 px-3 text-right font-mono tabular-nums">
              {{ fmtBytes(row.totalBytes) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-4 grid gap-3 lg:grid-cols-2">
      <!-- min-w-0: the hex dump below never wraps, and without it this grid item's
           automatic minimum size would widen the column past the viewport. -->
      <div class="flex min-w-0 flex-col gap-3">
        <div class="min-w-0 rounded-md border border-default p-3">
          <h3 class="text-sm font-semibold text-highlighted">
            One frame, encoded and read back just now
          </h3>
          <p v-if="!roundTrip" class="text-sm text-muted mt-1">
            Waiting for the first trial…
          </p>
          <template v-else>
            <p class="text-xs text-muted mt-1">
              The latest cumulative-deviation point re-encoded here, byte for byte as the panel
              received it: kind {{ roundTrip.kindByte }} ({{ FRAME_KIND.bands === roundTrip.kindByte ? 'bands' : 'series' }}),
              layout byte {{ roundTrip.layoutVersion }}, channel {{ roundTrip.channelId }},
              {{ roundTrip.bytes }} bytes.
            </p>
            <pre class="mt-2 overflow-x-auto rounded bg-elevated p-2 font-mono text-[11px] leading-relaxed">{{ roundTrip.hex }}{{ roundTrip.bytes > 40 ? ' …' : '' }}</pre>
            <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-mono tabular-nums">
              <dt class="text-muted">decoded t</dt>
              <dd>{{ fmtNum(roundTrip.t, { digits: 0 }) }}</dd>
              <dt class="text-muted">decoded value</dt>
              <dd>{{ fmtNum(roundTrip.value, { digits: 4 }) }}</dd>
              <template v-for="(band, i) in roundTrip.bands" :key="i">
                <dt class="text-muted">band {{ i }}</dt>
                <dd>
                  [{{ fmtNum(band.lo, { digits: 2 }) }}, {{ fmtNum(band.hi, { digits: 2 }) }}]
                </dd>
              </template>
            </dl>
          </template>
        </div>

        <div class="rounded-md border border-default p-3">
          <h3 class="text-sm font-semibold text-highlighted">Header layout</h3>
          <table class="mt-2 w-full text-xs">
            <tbody>
              <tr v-for="row in LAYOUT" :key="row.offset" class="border-t border-default first:border-t-0">
                <td class="py-1 pr-3 font-mono tabular-nums text-muted">+{{ row.offset }}</td>
                <td class="py-1 pr-3 font-mono text-muted">{{ row.size }}</td>
                <td class="py-1">{{ row.field }}</td>
              </tr>
            </tbody>
          </table>
          <div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-muted">isSupportedProtocolVersion:</span>
            <UBadge
              v-for="check in versionChecks"
              :key="check.v"
              :color="check.ok ? 'success' : 'neutral'"
              variant="subtle"
              class="font-mono"
            >
              {{ check.v }} → {{ check.ok }}
            </UBadge>
          </div>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-muted">isValidRange:</span>
            <UBadge
              v-for="check in rangeChecks"
              :key="check.text"
              :color="check.ok ? 'success' : 'neutral'"
              variant="subtle"
              class="font-mono"
            >
              {{ check.text }} → {{ check.ok }}
            </UBadge>
          </div>
        </div>
      </div>

      <CodeSnippet :code="snippet" title="encoding a two-band point" />
    </div>

    <HonestNote variant="fixed-in-0.2" class="mt-4">
      Protocol 2 is negotiated, not assumed: the client opens
      <code class="font-mono text-xs">/ws?v=2</code> and the server answers with
      <code class="font-mono text-xs">min(v, 2)</code> in every directory. Kinds 1–3 keep layout byte
      1, so a decoder compares the first byte with the kind's layout version rather than with
      <code class="font-mono text-xs">PROTOCOL_VERSION</code> — and a protocol-1 decoder rejects
      kind 4. A protocol-1 session never receives kind 4 at all: the server downgrades a multi-band
      point to a kind-2 frame carrying its first band, and sends no
      <code class="font-mono text-xs">bandLabels</code>.
    </HonestNote>

    <template #footer>
      Text frames are JSON and carry the directory and static documents;
      <code class="font-mono text-xs">parseTextMessage</code> validates their structure, not just the
      type tag. Matrix labels, a matrix <code class="font-mono text-xs">range</code>, series
      <code class="font-mono text-xs">bandLabels</code>, the producer
      <code class="font-mono text-xs">note</code> and an error reason all ride in the directory, never
      in a binary frame.
    </template>
  </DemoSection>
</template>
