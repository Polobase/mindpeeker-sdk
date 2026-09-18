<script setup lang="ts">
/**
 * The `mindpeeker-viz` demo dashboard, running without its Bun server: the
 * package's own WebGL2 client is mounted into the page with `mountDashboard`
 * and fed frames the CLI's encoders produced, decoded by `decodeFrame`.
 */
import type { DashboardHandle } from '@viz/client/mount'
import { mountDashboard } from '@viz/client/mount'
import { PROTOCOL_VERSION } from '@viz/src/protocol'
import type { ChannelStatus, RateCardGeometry } from '@viz/src/types'
import { buildDirectory, CHANNEL, SAMPLE_RATE_CARD, SOURCE_INTERVAL_MS } from '~/lib/visualizer/channels'
import {
  BITS_PER_TRIAL,
  createDriver,
  type Driver,
  type DriverSnapshot,
} from '~/lib/visualizer/driver'
import { type Feed, type FeedMode, resolveFeed } from '~/lib/visualizer/feed'
import { fmtBytes, fmtDuration, fmtNum } from '~/lib/format'
import { sourceSummary } from '~/lib/entropy'

const FEEDS: { label: string; value: FeedMode }[] = [
  { label: 'header source', value: 'source' },
  { label: 'browser CSPRNG (full rate)', value: 'local' },
  { label: 'seeded control DRBG', value: 'control' },
]

const PACING: { label: string; value: number }[] = [
  { label: `CLI pace · ${SOURCE_INTERVAL_MS} ms`, value: SOURCE_INTERVAL_MS },
  { label: 'normal · 120 ms', value: 120 },
  { label: 'calm · 250 ms', value: 250 },
  { label: 'slow · 500 ms', value: 500 },
]

/** 256 bytes per chunk, like the CLI; a clock-jitter source gets a smaller pull. */
const CHUNK_BYTES = 256
const JITTER_CHUNK_BYTES = 64

const feedMode = ref<FeedMode>('source')
const pacing = ref(120)
const gridEl = ref<HTMLElement>()
const snap = shallowRef<DriverSnapshot>()
const feed = shallowRef<Feed>()
const startError = ref<unknown>()
const starting = ref(false)
const geometry = shallowRef<RateCardGeometry>(SAMPLE_RATE_CARD)

let handle: DashboardHandle | undefined
let driver: Driver | undefined
let sampler: ReturnType<typeof setInterval> | undefined
let controller: AbortController | undefined
let disposed = false

const dirState = reactive({
  noiseName: 'crypto',
  status: 'live' as ChannelStatus,
  error: undefined as string | undefined,
  noiseNote: undefined as string | undefined,
  cumdevNote: undefined as string | undefined,
  netvarNote: undefined as string | undefined,
})

function syncDirectory(): void {
  handle?.applyDirectory(
    buildDirectory({
      noiseName: dirState.noiseName,
      status: dirState.status,
      ...(dirState.error ? { error: dirState.error } : {}),
      ...(dirState.noiseNote ? { noiseNote: dirState.noiseNote } : {}),
      ...(dirState.cumdevNote ? { cumdevNote: dirState.cumdevNote } : {}),
      ...(dirState.netvarNote ? { netvarNote: dirState.netvarNote } : {}),
    }),
  )
}

const running = computed(() => snap.value?.running === true)
const paused = computed(() => snap.value?.paused === true)

const chunkBytes = computed(() =>
  feedMode.value === 'source' && sourceSummary().id === 'jitter' ? JITTER_CHUNK_BYTES : CHUNK_BYTES,
)

const throughput = computed(() => {
  const s = snap.value
  if (!s || s.elapsedMs < 500) return undefined
  return (s.bytes / s.elapsedMs) * 1000
})

async function stopDriver(): Promise<void> {
  const current = driver
  driver = undefined
  await current?.stop()
}

async function start(): Promise<void> {
  if (disposed || !handle) return
  startError.value = undefined
  starting.value = true
  controller?.abort()
  const local = new AbortController()
  controller = local
  try {
    await stopDriver()
    const resolved = await resolveFeed(feedMode.value, local.signal)
    if (disposed || local.signal.aborted || !handle) return
    feed.value = resolved
    handle.reset()
    dirState.noiseName = resolved.label
    dirState.status = 'live'
    dirState.error = undefined
    dirState.noiseNote = resolved.note
    dirState.cumdevNote = 'trials flow as hash-chained psi JSONL v2 — see the CLI tab'
    dirState.netvarNote = 'anytime p = 1.00'
    syncDirectory()
    handle.setStatic(CHANNEL.rateCard, geometry.value)
    driver = createDriver({
      handle,
      feed: resolved,
      chunkBytes: chunkBytes.value,
      intervalMs: pacing.value,
      onNote: (text) => {
        dirState.netvarNote = text
        syncDirectory()
      },
      onError: (error) => {
        startError.value = error
        dirState.status = 'error'
        dirState.error = error instanceof Error ? error.message : String(error)
        syncDirectory()
      },
      onEnd: () => {
        dirState.status = 'ended'
        syncDirectory()
      },
    })
    driver.start()
    snap.value = driver.snapshot()
  } catch (error) {
    if (!local.signal.aborted) startError.value = error
  } finally {
    // a later start() owns the flag once it has replaced this controller
    if (controller === local) starting.value = false
  }
}

function togglePause(): void {
  if (!driver) return
  if (paused.value) driver.resume()
  else driver.pause()
  snap.value = driver.snapshot()
}

function applyGeometry(next: RateCardGeometry): void {
  geometry.value = next
  handle?.setStatic(CHANNEL.rateCard, next)
}

watch(pacing, (ms) => driver?.setIntervalMs(ms))
watch(feedMode, () => void start())

useElementReady(gridEl, (el) => {
  handle = mountDashboard(el)
  syncDirectory()
  handle.setStatic(CHANNEL.rateCard, geometry.value)
  void start()
  sampler = setInterval(() => {
    if (driver) snap.value = driver.snapshot()
  }, 250)
  return () => {
    disposed = true
    controller?.abort()
    if (sampler) clearInterval(sampler)
    sampler = undefined
    void stopDriver()
    handle?.destroy()
    handle = undefined
  }
})

const snippet = `import { mountDashboard } from '@mindpeeker/visualizer/client/mount' // by path: the
// package publishes its Bun server + protocol; the WebGL2 client is not an export
import { decodeFrame, encodeBytesFrame, encodeSeriesFrame, PROTOCOL_VERSION } from '@mindpeeker/visualizer'
import { cumdevSample, NetvarMonitor } from '@mindpeeker/visualizer/src/demo/monitor'

const dash = mountDashboard(gridElement)
dash.applyDirectory({
  type: 'directory',
  version: PROTOCOL_VERSION, // 2 — kind-4 frames and bandLabels
  channels: [
    { id: 0, name: 'crypto noise', kind: 'bytes', status: 'live' },
    {
      id: 2,
      name: 'cumulative deviation · pointwise χ² band and anytime-valid boundary',
      kind: 'series',
      status: 'live',
      bandLabels: ['two-sided 90% pointwise', 'anytime-valid (α = 0.05)'],
    },
  ],
})

const monitor = new NetvarMonitor(200) // fair bits behind each Stouffer Z
dash.pushFrame(decodeFrame(encodeBytesFrame(0, chunk)))
dash.pushFrame(decodeFrame(encodeSeriesFrame(2, [cumdevSample(monitor.add(z))])))`

const serverSnippet = `// what a Bun host runs instead — same panels, frames over a WebSocket
import { createDashboard } from '@mindpeeker/visualizer'

const dash = createDashboard({ port: 0 })          // 0 = pick a free port
console.log(dash.url)                              // http://localhost:PORT/

dash.attachByteStream('crypto noise', provider.stream({ chunkBytes: 256 }))
dash.attachSeries('cumulative deviation · …', cumdevSeries(points))
dash.attachMatrix('byte histogram', histogramMatrix(bytes))
dash.attachStatic('rate card', { type: 'rate-card', sectors: 44, rings: [0.3, 0.5, 0.7, 0.9], pointerSector: 17 })
dash.setNote('running netvar Z of the Stouffer Z series', 'anytime p = 0.41')

await dash.stop()                                  // closes sources, 1000 to every client`
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      title="Six live channels"
      :api="[
        'mountDashboard',
        'applyDirectory',
        'pushFrame',
        'encodeBytesFrame',
        'encodeSeriesFrame',
        'encodeMatrixFrame',
        'decodeFrame',
      ]"
      description="The package's WebGL2 panels, mounted into this page and fed by the CLI demo's own
        producers: raw bytes, windowed negentropy, the cumulative deviation with both envelopes, the
        running netvar Z, a decaying byte histogram and a base-44 rate card. Every frame is encoded
        with the wire encoders and decoded again, so the panels see exactly the bytes a socket would
        have carried."
    >
      <template #controls>
        <UFormField label="Feed" size="sm" class="w-56">
          <USelect v-model="feedMode" :items="FEEDS" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Pacing" size="sm" class="w-44">
          <USelect v-model="pacing" :items="PACING" size="sm" class="w-full" />
        </UFormField>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
            color="primary"
            variant="soft"
            :disabled="!running"
            @click="togglePause"
          >
            {{ paused ? 'Resume' : 'Pause' }}
          </UButton>
          <UButton
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="soft"
            :loading="starting"
            @click="start"
          >
            Restart
          </UButton>
        </div>
      </template>

      <ErrorAlert
        :err="startError"
        title="The dashboard's producer failed"
        @dismiss="startError = undefined"
      />

      <div class="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-default px-2 py-0.5"
          :class="running && !paused ? 'text-primary' : 'text-muted'"
        >
          <span
            class="size-1.5 rounded-full"
            :class="running && !paused ? 'bg-primary animate-pulse' : 'bg-muted'"
          />
          {{ starting ? 'starting…' : running ? (paused ? 'paused' : 'streaming') : 'stopped' }}
        </span>
        <span class="text-muted font-mono">
          {{ feed?.providerName ?? '—' }} · {{ chunkBytes }} B/chunk · protocol v{{ PROTOCOL_VERSION }}
        </span>
        <AccountingBadge
          :bytes-consumed="snap?.bytes"
          :bits-used="snap ? snap.trials * BITS_PER_TRIAL : undefined"
          :source="feed?.providerName"
        />
        <span v-if="throughput" class="text-muted font-mono">
          {{ fmtBytes(throughput) }}/s · {{ fmtNum(snap?.chunks, { digits: 0 }) }} chunks in
          {{ fmtDuration(snap?.elapsedMs ?? 0) }}
        </span>
        <span v-if="snap && snap.droppedChunks > 0" class="text-warning font-mono">
          {{ snap.droppedChunks }} chunks dropped (a consumer fell behind — drop-oldest, like the
          server's ring)
        </span>
      </div>

      <div ref="gridEl" class="viz-dash" />

      <UAlert
        v-if="feed?.seeded"
        class="mt-3"
        color="warning"
        variant="subtle"
        icon="i-lucide-radio"
        title="Beacon round expanded, not streamed"
        :description="`A public beacon publishes one round every few seconds and re-reading it in
          between returns the same bytes, which would paint duplicate rows and feed the trial
          channel dependent bits. The panels above run on an HMAC_DRBG seeded with one round drawn
          through ${feed.providerName}: a deterministic expansion of 256 beacon bits, not fresh
          beacon entropy. Pick “browser CSPRNG” for an unexpanded high-rate feed.`"
      />

      <div class="mt-4 grid gap-3 lg:grid-cols-2">
        <CodeSnippet :code="snippet" title="what this page runs" />
        <CodeSnippet :code="serverSnippet" title="the supported programmatic path (Bun)" />
      </div>

      <template #footer>
        Panel chrome and canvases are the package's own, so they stay dark in both themes — the GL
        panels clear to a fixed dark background. The noise bitmap is a 256×256 R8 texture ring, the
        charts keep their last 4096 points, and the histogram is a 1×32 matrix drawn in bar mode from
        a zero baseline.
      </template>
    </DemoSection>

    <VisualizerTrialStats :snapshot="snap" />
    <VisualizerRateCard :geometry="geometry" @update:geometry="applyGeometry" />
    <VisualizerWire :snapshot="snap" />
  </div>
</template>

<style>
/*
 * Chrome for the panels `mountDashboard` creates in `.viz-dash` (plain DOM, so
 * the rules cannot be scoped). Deliberately dark in both themes: every panel
 * stacks a WebGL2 canvas that clears to #0d0f14 under a transparent 2D overlay,
 * and the package draws its axis text for that background.
 */
.viz-dash {
  display: grid;
  gap: 0.75rem;
}
.viz-dash .panel {
  background: #0e141d;
  border: 1px solid #1e2733;
  border-radius: 0.5rem;
  overflow: hidden;
  min-width: 0;
}
.viz-dash .panel header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  padding: 8px 12px;
  border-bottom: 1px solid #1e2733;
}
.viz-dash .panel h2 {
  font-size: 12px;
  font-weight: 600;
  color: #d7dde5;
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.viz-dash .status {
  font-size: 11px;
  color: #8b97a7;
  font-family: ui-monospace, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 55%;
  flex: none;
}
.viz-dash .status.live {
  color: #6bd968;
}
.viz-dash .status.ended {
  color: #ffb454;
}
.viz-dash .status.error {
  color: #ff6b6b;
}
.viz-dash .canvas-wrap {
  position: relative;
  height: 220px;
}
@media (min-width: 640px) {
  .viz-dash .canvas-wrap {
    height: 240px;
  }
}
.viz-dash .canvas-wrap.failed {
  display: grid;
  place-items: center;
  color: #ff6b6b;
  padding: 12px;
  text-align: center;
  font-size: 13px;
}
.viz-dash .canvas-wrap canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.viz-dash .canvas-wrap .overlay {
  pointer-events: none;
}
</style>
