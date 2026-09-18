<script setup lang="ts">
/** Section 7 — rolling transfer entropy over two live streams. */
import { pairStreams, windowedTransferEntropy } from '@mindpeeker/flow'
import { createYielder } from '~/lib/async'
import { drbgSource, localStream, sourceSummary, stream } from '~/lib/entropy'
import { fmtBytes, fmtDuration, fmtNum } from '~/lib/format'
import { bitStream, coupledBitStreams } from '~/lib/flow/streams'
import { biasFloor, degreesOfFreedom, tupleCount } from '~/lib/flow/theory'
import { num } from '~/lib/flow/types'

const summary = sourceSummary()

const MODES = [
  { label: 'coupling switches on mid-stream', value: 'coupled' },
  { label: 'two independent live sources', value: 'independent' },
]
const SOURCES = [
  { label: `selected source (${summary.label})`, value: 'selected' },
  { label: 'local CSPRNG (fast)', value: 'local' },
]
const WINDOWS = [256, 512, 1024].map((value) => ({ label: `${value} pairs`, value }))
const HOPS = [64, 128, 256].map((value) => ({ label: `${value} pairs`, value }))
const BUDGETS = [4000, 8000, 16000].map((value) => ({
  label: `${fmtNum(value, { digits: 0 })} pairs`,
  value,
}))

const mode = ref<'coupled' | 'independent'>('coupled')
// A beacon serves 32-byte rounds: streaming thousands of bits through one would
// crawl, so a network source defaults to the local CSPRNG here and says so.
const streamSource = ref<'selected' | 'local'>(summary.network ? 'local' : 'selected')
const windowSize = ref(512)
const hopSize = ref(128)
const budget = ref(8000)
const coupling = ref(80)
const lag = ref(1)
const switchPercent = ref(50)

interface Point {
  index: number
  startSample: number
  te: number
  localMean: number
  localNegatives: number
}

interface Summary {
  emissions: number
  pairs: number
  bits: number
  elapsedMs: number
  aborted: boolean
}

const points = shallowRef<Point[]>([])
const task = useTask<Summary>()
const live = computed(() => task.result.value)

const windowPairs = computed(() => num(windowSize.value, 512))
const hop = computed(() => num(hopSize.value, 128))
const pairBudget = computed(() => num(budget.value, 8000))
const switchAt = computed(() => Math.round((pairBudget.value * num(switchPercent.value)) / 100))
const expectedEmissions = computed(() =>
  Math.max(1, Math.floor((pairBudget.value - windowPairs.value) / hop.value) + 1),
)
const floor = computed(() =>
  biasFloor(degreesOfFreedom(2, 2, 1, 1), tupleCount(windowPairs.value, 1, 1, num(lag.value, 1))),
)

function start(): void {
  points.value = []
  void task.run(async (signal, setProgress) => {
    setProgress(0)
    const started = performance.now()
    const counter = { bits: 0 }
    const pairs = pairBudget.value
    const bytes =
      streamSource.value === 'selected'
        ? stream({ chunkBytes: 256, signal })
        : localStream({ chunkBytes: 256, signal })
    const a = bitStream(bytes, pairs + 64, counter)

    let left: AsyncIterable<number> = a
    let right: AsyncIterable<number>
    if (mode.value === 'coupled') {
      const tee = coupledBitStreams(a, {
        pairs,
        lag: num(lag.value, 1),
        coupling: num(coupling.value) / 100,
        switchAt: switchAt.value,
        seed: 0x5eed,
      })
      left = tee.a
      right = tee.b
    } else {
      // An independent control arm: a seeded DRBG, reproducible and unrelated.
      right = bitStream(
        drbgSource(`${currentSeedLabel()} / flow stream B`).stream({ chunkBytes: 256, signal }),
        pairs + 64,
      )
    }

    const collected: Point[] = []
    const tick = createYielder(8, signal)
    let emissions = 0
    let lastStart = 0
    for await (const point of windowedTransferEntropy(pairStreams(left, right, { signal }), {
      windowSize: windowPairs.value,
      hopSize: hop.value,
      k: 1,
      l: 1,
      lag: num(lag.value, 1),
      alphabet: 2,
      locals: true,
      signal,
    })) {
      const locals = point.locals
      const values = locals ? Array.from(locals.values.slice(locals.start)) : []
      collected.push({
        index: point.index,
        startSample: point.startSample,
        te: point.te,
        localMean: locals?.mean ?? Number.NaN,
        localNegatives: values.filter((v) => v < 0).length,
      })
      emissions++
      lastStart = point.startSample
      points.value = [...collected]
      setProgress(Math.min(1, emissions / expectedEmissions.value))
      // Pull-based generators only yield microtasks; hand the main thread a
      // macrotask now and then so the chart actually paints while it runs.
      await tick()
    }
    return {
      emissions,
      pairs: lastStart + windowPairs.value,
      bits: counter.bits,
      elapsedMs: performance.now() - started,
      aborted: false,
    }
  })
}

const chart = computed(() => {
  const list = points.value
  if (list.length === 0) return undefined
  return {
    x: list.map((p) => p.startSample),
    te: list.map((p) => p.te),
    max: list.reduce((best, p) => Math.max(best, p.te), 0),
    last: list[list.length - 1] as Point,
  }
})

const snippet = computed(
  () => `import { pairStreams, windowedTransferEntropy } from '@mindpeeker/flow'

// Any async iterable of symbols works; a live ByteSource works too (bytes
// arrive as 0–255 symbols, which is why these two sides yield bits instead).
const pairs = pairStreams(streamA, streamB, { signal })

for await (const { index, startSample, te, locals } of windowedTransferEntropy(pairs, {
  windowSize: ${windowSize.value}, hopSize: ${hopSize.value},
  k: 1, l: 1, lag: ${lag.value}, alphabet: 2,
  locals: true,
  signal,
})) {
  render(startSample, te) // exactly the batch TE of that slice
}
// Aborting rejects the pending pull with FlowError('aborted') — even when the
// source stalls — and closes both upstream iterators (cleanup capped at 100 ms).`,
)
</script>

<template>
  <DemoSection
    id="streaming"
    title="7 · Streaming"
    :api="['pairStreams', 'windowedTransferEntropy', 'symbolsFromBytes']"
  >
    <template #description>
      Pooling counts over a whole recording assumes the coupling never changes. When it does, the
      global number is a blend of two regimes and describes neither.
      <code>pairStreams</code> zips two live sources into lock-step pairs with backpressure, and
      <code>windowedTransferEntropy</code> re-estimates over a rolling window — each emission is
      exactly the batch value on that slice.
    </template>

    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Stream"
        busy-label="Streaming…"
        icon="i-lucide-activity"
        :hint="`${fmtNum(pairBudget, { digits: 0 })} pairs ≈ ${fmtBytes(pairBudget / 8)} per stream · ${expectedEmissions} windows`"
        @run="start"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="What is streaming" size="sm">
        <USelect v-model="mode" :items="MODES" class="w-full" />
      </UFormField>
      <UFormField
        label="Stream source"
        size="sm"
        :description="summary.network ? 'a beacon cannot feed thousands of bits' : undefined"
      >
        <USelect v-model="streamSource" :items="SOURCES" class="w-full" />
      </UFormField>
      <UFormField label="Window" size="sm">
        <USelect v-model="windowSize" :items="WINDOWS" class="w-full" />
      </UFormField>
      <UFormField label="Hop" size="sm">
        <USelect v-model="hopSize" :items="HOPS" class="w-full" />
      </UFormField>
      <UFormField label="Pairs" size="sm">
        <USelect v-model="budget" :items="BUDGETS" class="w-full" />
      </UFormField>
      <UFormField
        v-if="mode === 'coupled'"
        label="Coupling once on"
        :hint="`${coupling}%`"
        size="sm"
      >
        <USlider v-model="coupling" :min="0" :max="100" :step="5" class="mt-2" />
      </UFormField>
      <UFormField v-if="mode === 'coupled'" label="Switches on at" :hint="`${switchPercent}%`" size="sm">
        <USlider v-model="switchPercent" :min="0" :max="90" :step="5" class="mt-2" />
      </UFormField>
      <UFormField label="Lag" :hint="String(lag)" size="sm">
        <USlider v-model="lag" :min="1" :max="4" :step="1" class="mt-2" />
      </UFormField>
    </div>

    <div v-if="chart" class="mt-4 flex flex-col gap-4">
      <LineChart
        :series="[{ name: 'windowed TE X→Y', y: chart.te, x: chart.x }]"
        :hlines="[
          { value: floor, label: 'bias floor df/(2N ln2) for one window', color: 'warning' },
        ]"
        :vlines="
          mode === 'coupled'
            ? [{ value: switchAt, label: `coupling switches on at pair ${switchAt}`, color: 'success' }]
            : []
        "
        x-label="first pair of the window"
        y-label="transfer entropy (bits)"
        :height="260"
        aria-label="Transfer entropy of each rolling window against the position of the window in the stream"
        :format="(v: number) => fmtNum(v, { digits: 5 })"
      />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="windows emitted" :value="points.length" :digits="0" :note="`of ${expectedEmissions} expected`" />
        <StatTile label="latest window TE" :value="chart.last.te" :digits="5" note="bits, on its own slice" />
        <StatTile label="largest window TE" :value="chart.max" :digits="5" note="bits" />
        <StatTile
          label="local TE below zero"
          :value="`${chart.last.localNegatives}`"
          :note="'samples in the last window where X misinformed the prediction'"
        />
        <StatTile
          label="bias floor per window"
          :value="floor"
          :digits="5"
          tone="warning"
          :note="`a ${windowPairs}-pair window is small: even independent streams score this`"
        />
        <StatTile
          label="pairs consumed"
          :value="live ? live.pairs : chart.last.startSample + windowPairs"
          :digits="0"
          note="one symbol pulled from each side per pair"
        />
        <StatTile
          label="bits from the source"
          :value="live ? live.bits : '—'"
          :digits="0"
          :note="streamSource === 'selected' ? summary.providerName : 'browser CSPRNG'"
        />
        <StatTile
          label="run time"
          :value="live ? fmtDuration(live.elapsedMs) : task.busy.value ? 'running…' : '—'"
          :note="'pull-based: nothing is fetched before a window needs it'"
        />
      </div>

      <UAlert
        v-if="mode === 'independent'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="Both streams are independent here"
        description="Side B is a seeded DRBG control arm. Every window should hover around the bias floor, and some will sit well above it — that is what a sequence of small-sample estimates looks like, not a leak. Scanning windows for the largest one is a multiple comparison with no correction applied."
      />

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <p v-else-if="!task.busy.value" class="mt-4 text-sm text-muted">
      Start the stream to watch the estimate move.
    </p>
    <p v-else class="mt-4 text-sm text-muted">Waiting for the first full window…</p>

    <template #footer>
      Windowing trades stationarity for resolution: a {{ windowPairs }}-pair window holds far less
      data than section 1, so each estimate is noisier and its bias floor higher. Cancel is real —
      the abort propagates into the pending upstream pull, both iterators are closed, and the
      partial curve above stays on screen.
    </template>
  </DemoSection>
</template>
