<script setup lang="ts">
/** Section 2 — the selected source's stream() as a bitmap, a byte histogram
 * and a running monobit z, with the throughput the source actually delivers. */
import { nextMacrotask } from '~/lib/async'
import { drbgSource, localStream, sourceSummary, stream } from '~/lib/entropy'
import { BIN_LABELS, HISTOGRAM_BINS, STREAM_SNIPPET, StreamStats, type StreamSnapshot } from '~/lib/entropy/stats'
import { fmtBytes, fmtDuration } from '~/lib/format'

const SIDE = 128
const PIXELS = SIDE * SIDE

const summary = sourceSummary()

const sourceMode = ref<'selected' | 'local' | 'drbg'>('selected')
const chunkBytes = ref(1024)
const budget = ref(65_536)

const sourceItems = [
  { label: `Header source — ${summary.label}`, value: 'selected' },
  { label: 'Local CSPRNG (reference)', value: 'local' },
  { label: 'Seeded DRBG (reproducible)', value: 'drbg' },
]
const chunkItems = [32, 128, 1024, 4096].map((n) => ({ label: `${n} B per pull`, value: n }))
const budgetItems = [16_384, 65_536, 262_144, 1_048_576].map((n) => ({
  label: fmtBytes(n),
  value: n,
}))

const task = useTask<void>()
const snapshot = shallowRef<StreamSnapshot | undefined>()
const rate = ref(0)
const elapsed = ref(0)
const providerName = ref('—')

const canvasEl = ref<HTMLCanvasElement>()
let ctx: CanvasRenderingContext2D | undefined
let image: ImageData | undefined
let cursor = 0

useElementReady(canvasEl, (canvas) => {
  ctx = canvas.getContext('2d') ?? undefined
  if (!ctx) return
  image = ctx.createImageData(SIDE, SIDE)
  clearCanvas()
})

function clearCanvas(): void {
  if (!ctx || !image) return
  const data = image.data
  for (let i = 0; i < PIXELS; i++) {
    data[i * 4] = 17
    data[i * 4 + 1] = 21
    data[i * 4 + 2] = 28
    data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  cursor = 0
}

function paint(chunk: Uint8Array): void {
  if (!ctx || !image) return
  const data = image.data
  for (const byte of chunk) {
    const p = cursor * 4
    data[p] = byte
    data[p + 1] = byte
    data[p + 2] = byte
    data[p + 3] = 255
    cursor = (cursor + 1) % PIXELS
  }
  ctx.putImageData(image, 0, 0)
}

function openStream(signal: AbortSignal): AsyncIterable<Uint8Array> {
  const opts = { chunkBytes: chunkBytes.value, signal }
  if (sourceMode.value === 'local') return localStream(opts)
  if (sourceMode.value === 'drbg') return drbgSource('entropy page / stream panel').stream(opts)
  return stream(opts)
}

function start(): void {
  const acc = new StreamStats(1 << 20)
  snapshot.value = undefined
  rate.value = 0
  elapsed.value = 0
  clearCanvas()
  providerName.value =
    sourceMode.value === 'local'
      ? 'crypto'
      : sourceMode.value === 'drbg'
        ? drbgSource('entropy page / stream panel').name
        : summary.providerName

  void task.run(async (signal, setProgress) => {
    const started = performance.now()
    let lastUpdate = 0
    for await (const chunk of openStream(signal)) {
      paint(chunk)
      acc.push(chunk)
      const now = performance.now()
      elapsed.value = now - started
      if (now - lastUpdate > 150) {
        snapshot.value = acc.snapshot()
        rate.value = (acc.bytes * 1000) / Math.max(1, now - started)
        lastUpdate = now
      }
      setProgress(Math.min(1, acc.bytes / budget.value))
      if (acc.bytes >= budget.value) break
      await nextMacrotask()
    }
    snapshot.value = acc.snapshot()
    rate.value = (acc.bytes * 1000) / Math.max(1, performance.now() - started)
  })
}

const expectedBin = 1 / HISTOGRAM_BINS
const zTone = computed(() => {
  const z = snapshot.value?.z
  if (z === undefined) return 'neutral'
  return Math.abs(z) > 3 ? 'error' : Math.abs(z) > 2 ? 'warning' : 'success'
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      title="Watch the bytes arrive"
      :api="['provider.stream', 'chunkBytes', 'AbortSignal']"
      description="Every provider has the same lazy, pull-based stream(): no I/O before the first pull, chunkBytes per pull, and an abort that rejects the pending pull at once. The rain slows down exactly as much as the source does."
    >
      <template #controls>
        <UFormField label="Stream from" size="sm">
          <USelect v-model="sourceMode" :items="sourceItems" size="sm" class="w-60" />
        </UFormField>
        <UFormField label="Chunk size" size="sm">
          <USelect v-model="chunkBytes" :items="chunkItems" size="sm" class="w-40" />
        </UFormField>
        <UFormField label="Stop after" size="sm">
          <USelect v-model="budget" :items="budgetItems" size="sm" class="w-32" />
        </UFormField>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          label="Start stream"
          busy-label="Streaming…"
          icon="i-lucide-play"
          :hint="`A beacon publishes one 32-byte round every few seconds, so ${fmtBytes(budget)} from drand would take hours — stop it whenever.`"
          @run="start"
          @cancel="task.cancel()"
        />
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div class="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div class="flex flex-col gap-2">
          <canvas
            ref="canvasEl"
            :width="SIDE"
            :height="SIDE"
            class="w-full aspect-square rounded border border-default [image-rendering:pixelated]"
            role="img"
            aria-label="Byte values of the live stream as grayscale pixels, newest overwriting oldest"
          />
          <p class="text-xs text-muted">
            One pixel per byte, its value as grey — {{ fmtBytes(PIXELS) }} fills the square once,
            then it overwrites itself. Structure your eye can see is structure a test would catch;
            a clean source looks like static.
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Bytes streamed"
            :value="snapshot ? fmtBytes(snapshot.bytes) : '—'"
            :note="`from ${providerName}`"
          />
          <StatTile
            label="Throughput"
            :value="rate > 0 ? `${fmtBytes(rate)}/s` : '—'"
            :note="elapsed > 0 ? `over ${fmtDuration(elapsed)}` : 'not started'"
          />
          <StatTile
            label="Monobit z"
            :value="snapshot?.z ?? null"
            :tone="zTone"
            :digits="2"
            note="(2·ones − n)/√n over every bit seen"
          />
          <StatTile
            label="Shannon"
            :value="snapshot?.shannon ?? null"
            :digits="3"
            note="bits per byte, ideal 8 (needs ≫ 256 bytes)"
          />
          <StatTile
            label="Ones fraction"
            :value="snapshot?.onesFraction ?? null"
            :digits="5"
            note="ideal 0.5"
          />
          <StatTile label="Byte χ² (255 df)" :value="snapshot?.chi2 ?? null" :digits="1">
            <template #note>
              <PValue :p="snapshot?.chi2P ?? null" kind="pointwise" label="χ² p" />
              <span class="block mt-1">wants ≳ 1,280 bytes for the approximation</span>
            </template>
          </StatTile>
        </div>
      </div>

      <div class="mt-4">
        <BarChart
          :categories="BIN_LABELS"
          :values="snapshot?.bins ?? new Array(HISTOGRAM_BINS).fill(0)"
          :expected="expectedBin"
          expected-label="uniform expectation (1/32)"
          x-label="byte value (bins of 8)"
          y-label="relative frequency"
          :height="220"
          aria-label="Byte-value histogram in 32 bins against the uniform expectation"
          :format="(v) => v.toFixed(4)"
        />
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <span class="text-sm text-muted">Monobit p for the z above:</span>
        <PValue :p="snapshot?.p ?? null" kind="pointwise" label="monobit p" />
      </div>

      <HonestNote variant="caveat" class="mt-4">
        This panel is a live statistic you are watching. A pointwise p-value is only valid at a
        sample size fixed <em>before</em> looking; stopping a stream when z happens to look extreme
        turns 0.05 into something much larger. For a threshold that stays valid while you watch,
        the <code class="font-mono">@mindpeeker/rate</code> package provides anytime-valid
        e-processes. And passing these tests certifies nothing: every CSPRNG passes them by
        construction — statistical tests can only ever <em>fail</em> a source.
      </HonestNote>

      <CodeSnippet class="mt-4" :code="STREAM_SNIPPET" title="what this panel runs" />

      <template #footer>
        Stream options are validated on the first pull: <code class="font-mono">chunkBytes</code>
        must be an integer ≥ 1 and <code class="font-mono">timeoutMs</code> finite in
        (0, 2³¹ − 1], otherwise the pull rejects with
        <code class="font-mono">invalid_request</code>. For streams,
        <code class="font-mono">timeoutMs</code> bounds each pull, not the stream's lifetime.
      </template>
    </DemoSection>
  </div>
</template>
