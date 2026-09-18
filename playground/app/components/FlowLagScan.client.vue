<script setup lang="ts">
/** Section 3 — where in time does the information arrive? */
import { fmtDuration, fmtNum, fmtP } from '~/lib/format'
import type { LagScanResult, SurrogateConfig } from '~/lib/flow/jobs'
import { biasFloor, degreesOfFreedom, tupleCount } from '~/lib/flow/theory'
import { num, SURROGATE_METHODS, type LabSeries, type SurrogateMethodName } from '~/lib/flow/types'
import { runFlowJob } from '~/lib/flow/worker-client'

const props = defineProps<{ series?: LabSeries }>()

const METHODS = SURROGATE_METHODS.map((value) => ({ label: value, value }))
const ALPHAS = [
  { label: 'α = 0.05', value: 0.05 },
  { label: 'α = 0.01', value: 0.01 },
]
const SIZES = [99, 199, 499].map((value) => ({ label: `${value} surrogates`, value }))

const maxLag = ref(8)
const alpha = ref(0.05)
const surrogates = ref(199)
const method = ref<SurrogateMethodName>('circularShift')
const seed = ref(42)

const task = useTask<LagScanResult>()
const scan = computed(() => task.result.value?.scan)

function run(): void {
  const s = props.series
  if (!s) return
  const config: SurrogateConfig = {
    method: method.value,
    surrogates: num(surrogates.value, 199),
    seed: num(seed.value, 42),
  }
  void task.run(async (signal, setProgress) => {
    setProgress(null)
    return await runFlowJob(
      'lagScan',
      {
        x: s.x,
        y: s.y,
        embedding: { k: s.params.k, l: s.params.l, millerMadow: s.params.millerMadow },
        minLag: 1,
        maxLag: num(maxLag.value, 8),
        alpha: num(alpha.value, 0.05),
        surrogate: config,
      },
      signal,
    )
  })
}

const planted = computed(() => props.series?.params.lag)

const recovered = computed(() => {
  const value = scan.value
  if (!value || planted.value === undefined) return undefined
  return value.bestLag === planted.value
})

const lagSeries = computed(() => {
  const value = scan.value
  if (!value) return []
  return [
    {
      name: 'TE X→Y at this lag',
      points: value.lags.map((entry) => [entry.lag, entry.te] as [number, number]),
    },
  ]
})

const hlines = computed(() => {
  const value = scan.value
  if (!value) return []
  const lines: { value: number; label: string; color?: number | string; dashed?: boolean }[] = []
  if (Number.isFinite(value.threshold)) {
    lines.push({
      value: value.threshold,
      label: `family-wise threshold (α = ${value.alpha})`,
      color: 'error',
    })
  }
  const s = props.series
  if (s) {
    const df = degreesOfFreedom(2, 2, s.params.k, s.params.l)
    lines.push({
      value: biasFloor(df, value.count),
      label: 'bias floor df/(2N ln2)',
      color: 'warning',
      dashed: true,
    })
  }
  return lines
})

const vlines = computed(() =>
  planted.value === undefined
    ? []
    : [{ value: planted.value, label: `planted lag ${planted.value}`, color: 'success' }],
)

const tuplesPerLag = computed(() => {
  const s = props.series
  return s ? tupleCount(s.params.n, s.params.k, s.params.l, maxLag.value) : 0
})

const snippet = computed(
  () => `import { transferEntropyByLag } from '@mindpeeker/flow'

const scan = transferEntropyByLag(x, y, {
  k: ${props.series?.params.k ?? 1}, l: ${props.series?.params.l ?? 1}, alphabet: 2,
  minLag: 1, maxLag: ${maxLag.value},
  alpha: ${alpha.value},
  surrogate: '${method.value}', surrogates: ${surrogates.value}, seed: ${seed.value},
})

// Every lag is compared with the distribution of the per-surrogate MAXIMUM
// over lags (IDTxl's max statistic), so picking the peak costs nothing extra.
scan.bestLag        // the interaction delay this data supports
scan.threshold      // TE a lag must exceed to be family-wise significant
scan.lags           // [{ lag, te, p, significant }, …]
scan.maxNull        // per-surrogate maximum TE, the family-wise null`,
)
</script>

<template>
  <DemoSection id="lag-scan" title="3 · Lag scan" :api="['transferEntropyByLag']">
    <template #description>
      Transfer entropy is computed at one lag at a time, so the interaction delay has to be found.
      Scanning is a multiple comparison — the peak of a TE-vs-lag curve is the classic
      analysis-flexibility trap — so every lag here is judged against the distribution of the
      per-surrogate <em>maximum</em> over all scanned lags, which controls the family-wise error of
      picking the peak (Wibral et al. 2013; IDTxl's max statistic).
    </template>

    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!series"
        label="Scan lags"
        busy-label="Scanning…"
        icon="i-lucide-search"
        :hint="
          series
            ? `${maxLag} lags × ${surrogates} surrogates on ${fmtNum(series.params.n, { digits: 0 })} symbols`
            : 'Draw the pair in section 1 first'
        "
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="Largest lag scanned" :hint="String(maxLag)" size="sm">
        <USlider v-model="maxLag" :min="2" :max="16" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="Family-wise level" size="sm">
        <USelect v-model="alpha" :items="ALPHAS" class="w-full" />
      </UFormField>
      <UFormField label="Surrogates" size="sm">
        <USelect v-model="surrogates" :items="SIZES" class="w-full" />
      </UFormField>
      <UFormField label="Surrogate method" size="sm">
        <USelect v-model="method" :items="METHODS" class="w-full" />
      </UFormField>
    </div>

    <div v-if="scan" class="mt-4 flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="best lag"
          :value="scan.bestLag"
          :digits="0"
          :tone="recovered ? 'success' : 'warning'"
          :note="
            planted === undefined
              ? 'largest TE in the scan'
              : recovered
                ? `matches the planted lag (${planted})`
                : `the planted lag was ${planted} — at this coupling the peak is noise`
          "
        />
        <StatTile label="TE at the best lag" :value="scan.te" :digits="5" note="bits" />
        <StatTile label="family-wise p">
          <template #value><PValue :p="scan.p" kind="family-wise" /></template>
          <template #note>over all {{ scan.lags.length }} lags, from the max statistic</template>
        </StatTile>
        <StatTile
          label="threshold"
          :value="Number.isFinite(scan.threshold) ? scan.threshold : '∞'"
          :digits="5"
          :note="
            Number.isFinite(scan.threshold)
              ? 'TE a lag must exceed to be significant'
              : 'too few surrogates for this α — ⌊α(n+1)⌋ < 1'
          "
        />
      </div>

      <LineChart
        :series="lagSeries"
        :hlines="hlines"
        :vlines="vlines"
        x-label="source lag u (samples)"
        y-label="transfer entropy (bits)"
        :height="260"
        aria-label="Transfer entropy as a function of the source lag, with the family-wise significance threshold"
        :format="(v: number) => fmtNum(v, { digits: 5 })"
      />

      <div>
        <h3 class="text-sm font-medium text-highlighted">Every lag, with its family-wise p</h3>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Transfer entropy, family-wise p-value and significance per source lag
            </caption>
            <thead class="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" class="py-1.5 pr-3 text-left font-medium">lag</th>
                <th scope="col" class="py-1.5 pr-3 text-right font-medium">TE (bits)</th>
                <th scope="col" class="py-1.5 pr-3 text-right font-medium">p (family-wise)</th>
                <th scope="col" class="py-1.5 text-left font-medium">verdict</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr
                v-for="entry in scan.lags"
                :key="entry.lag"
                :class="entry.lag === planted ? 'bg-elevated/50' : ''"
              >
                <td class="py-1.5 pr-3 font-mono tabular-nums">{{ entry.lag }}</td>
                <td class="py-1.5 pr-3 text-right font-mono tabular-nums">
                  {{ fmtNum(entry.te, { digits: 5 }) }}
                </td>
                <td class="py-1.5 pr-3 text-right font-mono tabular-nums">{{ fmtP(entry.p) }}</td>
                <td class="py-1.5">
                  <UBadge
                    size="sm"
                    variant="subtle"
                    :color="entry.significant ? 'success' : 'neutral'"
                  >
                    {{ entry.significant ? 'above threshold' : 'chance' }}
                  </UBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 class="text-sm font-medium text-highlighted">The family-wise null</h3>
        <p class="mt-1 text-xs text-muted">
          Each surrogate contributes the maximum of its own TE-vs-lag profile. Comparing every
          observed lag with <em>this</em> distribution is what makes scanning honest.
        </p>
        <Histogram
          class="mt-2"
          :values="scan.maxNull"
          :bins="30"
          :markers="
            Number.isFinite(scan.threshold)
              ? [{ value: scan.threshold, label: `α = ${scan.alpha} threshold`, color: 'error' }]
              : []
          "
          x-label="maximum surrogate TE over the scanned lags (bits)"
          y-label="surrogates"
          :height="200"
          aria-label="Distribution of the per-surrogate maximum transfer entropy over the scanned lags"
        />
      </div>

      <p class="text-xs text-muted">
        Every lag is evaluated over the same
        {{ fmtNum(scan.count, { digits: 0 }) }} predicted samples (those valid at lag
        {{ maxLag }}, so {{ fmtNum(tuplesPerLag, { digits: 0 }) }} tuples), which keeps the values
        comparable — they can differ slightly from a single-lag `transferEntropy` on the full range.
        {{ task.result.value ? `Scan time ${fmtDuration(task.result.value.elapsedMs)}.` : '' }}
      </p>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <p v-else-if="!task.busy.value" class="mt-4 text-sm text-muted">
      {{ series ? 'Scan to recover the planted delay.' : 'Draw the pair in section 1 first.' }}
    </p>

    <template #footer>
      A recovered lag is a point estimate, not a mechanism: a common driver entering the two series
      one step apart produces exactly the same peak (section 4). With coupling at 0 the scan should
      find nothing above the threshold — that is the control worth running.
    </template>
  </DemoSection>
</template>
