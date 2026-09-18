<script setup lang="ts">
/**
 * Seriality: Kammerer's "law of the series" priced against the null that
 * chance alone clusters.
 *
 * `seriesClustering` is exact on a grid fixed in advance — the conditional
 * null runs the k-fold engine, which is why the test goes through the worker.
 * Generating a log draws uniform times from the header-selected source, so a
 * generated log is a calibration reading, not a finding.
 */
import type { SeriesClusteringResult } from '@mindpeeker/coincidence'
import { MAX_WINDOWS } from '@mindpeeker/coincidence'
import { clusterSeries } from '~/lib/coincidence/exact-client'
import {
  formatTimes,
  generateSeries,
  MAX_EVENTS,
  MAX_WINDOWS_UI,
  parseTimes,
  README_LOG,
  windowCount,
} from '~/lib/coincidence/series'
import { sourceSummary, withReader } from '~/lib/entropy'
import { fmtNum } from '~/lib/format'

const text = ref(formatTimes(README_LOG))
const windowWidth = ref(1)
const span = ref(30)
const usePoissonRate = ref(false)
const rate = ref(0.25)

const genCount = ref(20)
const planted = ref(false)
const clusterCount = ref(5)
const clusterStart = ref(10)

const summary = sourceSummary()

const parsed = computed(() => parseTimes(text.value))
const safeWindow = computed(() => Math.max(1e-9, Number(windowWidth.value) || 1))
const safeSpan = computed(() => Math.max(safeWindow.value, Number(span.value) || 1))
const windows = computed(() => windowCount(safeSpan.value, safeWindow.value))

const outOfSpan = computed(() =>
  parsed.value.times.filter((t) => t < 0 || t > safeSpan.value).length,
)

const gridTooFine = computed(() => windows.value > MAX_WINDOWS_UI)

const blocked = computed(() => {
  if (parsed.value.error) return parsed.value.error
  if (gridTooFine.value) {
    return `That grid is ${fmtNum(windows.value, { digits: 0 })} windows; this page stops at ${MAX_WINDOWS_UI} (the SDK's own limit is ${fmtNum(MAX_WINDOWS, { digits: 0 })}).`
  }
  if (outOfSpan.value > 0) {
    return `${outOfSpan.value} timestamp(s) lie outside [0, ${fmtNum(safeSpan.value, { digits: 3 })}]; widen the span or drop them.`
  }
  return undefined
})

const testTask = useTask<SeriesClusteringResult>()
const genTask = useTask<number[]>()
const report = computed(() => testTask.result.value)

function test(): void {
  if (blocked.value) return
  const times = [...parsed.value.times]
  const w = safeWindow.value
  const s = safeSpan.value
  const r = usePoissonRate.value ? Math.max(1e-12, Number(rate.value) || 0.25) : undefined
  void testTask.run(async (signal, setProgress) => {
    setProgress(null)
    return await clusterSeries(times, w, s, r, { signal })
  })
}

function generate(): void {
  const n = Math.max(0, Math.min(MAX_EVENTS, Math.trunc(Number(genCount.value) || 0)))
  const s = safeSpan.value
  const cluster = planted.value
    ? {
        count: Math.max(0, Math.trunc(Number(clusterCount.value) || 0)),
        start: Math.max(0, Math.min(s, Number(clusterStart.value) || 0)),
        width: safeWindow.value,
      }
    : undefined
  void genTask.run(async (signal, setProgress) => {
    setProgress(0)
    const times = await withReader(
      (reader) =>
        generateSeries(reader, {
          n,
          span: s,
          ...(cluster ? { cluster } : {}),
          signal,
          onProgress: setProgress,
        }),
      { signal },
    )
    text.value = formatTimes(times)
    return times
  })
}

function loadReadme(): void {
  text.value = formatTimes(README_LOG)
  windowWidth.value = 1
  span.value = 30
  usePoissonRate.value = false
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [text.value, safeWindow.value, safeSpan.value, usePoissonRate.value, rate.value] as const,
  () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(test, 400)
  },
)
onMounted(test)
onUnmounted(() => {
  if (timer !== undefined) clearTimeout(timer)
})

const barCategories = computed(() => {
  const r = report.value
  if (!r) return []
  return r.counts.map((_, index) => fmtNum(r.start + index * r.window, { digits: 2 }))
})

const highlight = computed(() => (report.value ? [report.value.maxWindow] : []))

const code = computed(
  () => `import { seriesClustering } from '@mindpeeker/coincidence'

const times = [${parsed.value.times.slice(0, 7).map((t) => fmtNum(t, { digits: 3 })).join(', ')}${parsed.value.times.length > 7 ? ', …' : ''}]

const result = seriesClustering(times, {
  window: ${fmtNum(safeWindow.value, { digits: 4 })},
  span: ${fmtNum(safeSpan.value, { digits: 4 })},${usePoissonRate.value ? `\n  rate: ${fmtNum(Number(rate.value) || 0.25, { digits: 4 })},   // pre-specified, NOT estimated from these data` : ''}
})

result.maxCount    // ${report.value?.maxCount ?? '…'}  — the scan statistic on this grid
result.pValue      // ${report.value ? fmtNum(report.value.pValue, { digits: 8 }) : '…'}
result.null        // '${report.value?.null ?? '…'}'
result.method      // '${report.value?.method ?? '…'}'
result.dispersion  // { statistic: ${report.value?.dispersion ? fmtNum(report.value.dispersion.statistic, { digits: 3 }) : '…'}, mean: ${report.value?.dispersion ? fmtNum(report.value.dispersion.mean, { digits: 3 }) : '…'}, variance: ${report.value?.dispersion ? fmtNum(report.value.dispersion.variance, { digits: 3 }) : '…'} }`,
)
</script>

<template>
  <DemoSection
    id="seriality"
    title="Seriality — did those events really cluster?"
    :api="['seriesClustering', 'SeriesClusteringResult', 'DispersionSummary', 'MAX_WINDOWS']"
    description="Paste a log of event times, or draw one from the selected source. The statistic is the largest window count; the p-value is exact under a null fixed in advance — uniform times given n, or independent Poisson counts if you pre-specify a rate."
  >
    <template #controls>
      <UFormField label="Window width" size="sm" class="w-full sm:w-36">
        <UInputNumber v-model="windowWidth" :min="0.001" :step="0.5" class="w-full" />
      </UFormField>
      <UFormField label="Span (0 … end)" size="sm" class="w-full sm:w-36">
        <UInputNumber v-model="span" :min="0.001" :step="5" class="w-full" />
      </UFormField>
      <UFormField label="Pre-specified rate" size="sm">
        <USwitch v-model="usePoissonRate" :label="usePoissonRate ? 'Poisson null' : 'conditional null'" />
      </UFormField>
      <UFormField v-if="usePoissonRate" label="Rate (events / unit)" size="sm" class="w-full sm:w-44">
        <UInputNumber v-model="rate" :min="0.0001" :step="0.05" class="w-full" />
      </UFormField>
      <RunControls
        :busy="testTask.busy.value"
        label="Run the test"
        busy-label="Computing the exact p…"
        icon="i-lucide-activity"
        :hint="`${parsed.times.length} events over ${windows} windows`"
        @run="test"
        @cancel="testTask.cancel()"
      >
        <UButton size="sm" variant="soft" color="neutral" @click="loadReadme">README log</UButton>
      </RunControls>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="testTask.error.value ?? genTask.error.value" title="seriesClustering refused" @dismiss="testTask.reset()" />

      <UAlert
        v-if="blocked"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Nothing was computed"
        :description="blocked"
      />

      <UFormField
        label="Event timestamps — any unit, whitespace separated"
        size="sm"
        :help="`Sorted on parse; every time must lie inside [0, span]. At most ${MAX_EVENTS} events.`"
      >
        <UTextarea v-model="text" :rows="3" class="w-full font-mono" spellcheck="false" autocomplete="off" />
      </UFormField>

      <div class="rounded-md border border-default bg-elevated/30 p-3">
        <h3 class="text-sm font-semibold text-highlighted">Or draw a log from the selected source</h3>
        <p class="mt-1 text-sm text-muted">
          n independent uniform times on the span — the null itself. A planted burst is a positive
          control: the test <em>should</em> find it, which checks the test, not the world.
        </p>
        <div class="mt-3 flex flex-wrap items-end gap-3">
          <UFormField label="Uniform events" size="sm" class="w-full sm:w-36">
            <UInputNumber v-model="genCount" :min="0" :max="MAX_EVENTS" :step="5" class="w-full" />
          </UFormField>
          <UFormField label="Plant a burst" size="sm">
            <USwitch v-model="planted" :label="planted ? 'on' : 'off'" />
          </UFormField>
          <UFormField v-if="planted" label="Burst size" size="sm" class="w-full sm:w-32">
            <UInputNumber v-model="clusterCount" :min="1" :max="200" :step="1" class="w-full" />
          </UFormField>
          <UFormField v-if="planted" label="Burst starts at" size="sm" class="w-full sm:w-36">
            <UInputNumber v-model="clusterStart" :min="0" :step="1" class="w-full" />
          </UFormField>
          <RunControls
            :busy="genTask.busy.value"
            :progress="genTask.progress.value"
            label="Draw a log"
            busy-label="Drawing…"
            icon="i-lucide-dices"
            :hint="summary.providerName"
            @run="generate"
            @cancel="genTask.cancel()"
          />
        </div>
      </div>

      <template v-if="report">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Events" :value="report.n" :digits="0" :note="`over ${report.windows} windows`" />
          <StatTile
            label="Largest window count"
            :value="report.maxCount"
            :digits="0"
            tone="primary"
            :note="`window starting at ${fmtNum(report.maxWindowStart, { digits: 3 })}`"
          />
          <StatTile
            label="Expected per window"
            :value="report.expected[0] ?? null"
            :digits="4"
            :note="report.null === 'poisson' ? 'rate × window length' : 'n × window share'"
          />
          <StatTile label="Engine" size="sm" mono>
            <template #value>
              <span class="font-mono text-base">{{ report.method }}</span>
            </template>
            <template #note>
              {{ report.null === 'poisson' ? 'independent Poisson counts' : 'multinomial, conditioned on n' }}
            </template>
          </StatTile>
        </div>

        <div class="flex flex-wrap items-center gap-3 rounded-md border border-default bg-elevated/40 p-3">
          <PValue :p="report.pValue" kind="exact" />
          <span class="text-sm text-muted">
            P(some window on <em>this fixed grid</em> holds ≥ {{ report.maxCount }} of
            {{ report.n }} events) under the
            {{ report.null === 'poisson' ? 'pre-specified Poisson' : 'conditional uniform' }} null.
          </span>
        </div>

        <BarChart
          :categories="barCategories"
          :values="report.counts"
          :expected="report.expected"
          expected-label="null expectation"
          :highlight="highlight"
          x-label="window start"
          y-label="events in the window"
          :height="240"
          :format="(v) => fmtNum(v, { digits: 2 })"
          aria-label="Events per window with the null expectation, the largest window highlighted"
        />

        <div v-if="report.dispersion" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Pearson X²"
            :value="report.dispersion.statistic"
            :digits="3"
            tone="warning"
            note="Σ (xᵢ − eᵢ)²/eᵢ — the index of dispersion"
          />
          <StatTile label="Exact null mean" :value="report.dispersion.mean" :digits="3" note="windows − 1, or windows under Poisson" />
          <StatTile
            label="Exact null variance"
            :value="report.dispersion.variance"
            :digits="3"
            note="Haldane (1937) for the multinomial"
          />
          <StatTile
            label="z of the dispersion"
            :value="report.dispersion.z"
            :digits="3"
            note="standardized only — no p-value is claimed"
          />
        </div>
      </template>

      <CodeSnippet :code="code" title="what this section ran" />

      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="caveat" title="Fix the grid before you look">
          The origin and width of the windows are part of the hypothesis. Trying several widths or
          offsets and reporting the best is a multiple comparison this function cannot see, and the
          p-value it returns would then be meaningless. A sliding-window scan statistic has a
          different null, which the package deliberately does not implement. The dispersion comes
          with its exact mean and variance but no p-value, because the χ² approximation fails at the
          small expected counts typical of coincidence logs.
        </HonestNote>
        <HonestNote variant="contested" title="Kammerer's Gesetz der Serie">
          Paul Kammerer (1919) defined a series as the recurrence or clustering, in time or space,
          of similar things that no common cause connects, and classified series by order, power and
          parameters. That is a taxonomy, not a test: a Poisson process has runs, and chance alone
          clusters — five events on one day out of thirty is what the histogram above shows.
          Whether a series <em>means</em> anything is not a question this p-value can answer; all it
          says is how often a grid like this one produces a burst like that one by chance.
        </HonestNote>
      </div>

      <div v-if="usePoissonRate" class="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
        The Poisson null tests the total as well as the shape, and it is only valid if the rate was
        fixed <strong>before</strong> these data — estimating it from this same log and then testing
        against it is circular. Without a rate the SDK conditions on the observed count instead,
        which needs no such promise.
      </div>
    </div>

    <template #footer>
      The conditional p-value is exact via the k-fold engine; over 3000 seeded null logs (20
      uniform events, 30 windows) it rejects 1.0 % at α = 0.05 — conservative, never liberal.
      Sources: P. Kammerer, <em>Das Gesetz der Serie</em> (1919), summarised in Koestler,
      <em>The Roots of Coincidence</em> (1972); J. B. S. Haldane, Biometrika 29 (1937).
    </template>
  </DemoSection>
</template>
