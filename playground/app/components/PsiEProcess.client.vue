<script setup lang="ts">
/**
 * Section 2, live part — the coin e-process over the header-selected source
 * (peek as often as you like) and the pre-registered sequential design that
 * decides when to stop.
 */
import { normSf } from '@mindpeeker/negentropy/numerics'
import {
  type CoinEProcessPoint,
  type CoinObservation,
  coinEProcess,
  runSequential,
  type SequentialLooks,
  type SequentialOutcome,
  sequentialPlan,
  sequentialPlanDigest,
} from '@mindpeeker/psi'
import { createYielder } from '~/lib/async'
import { getBytes, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { bytesFor, shortHash, sumsFromBytes } from '~/lib/psi/synthetic'

const BITS = 200
const BATCH = 8

const trials = ref(120)
const alpha = ref(0.05)
const priorA = ref(1)
const priorB = ref(1)
const stopOnReject = ref(false)

const ALPHAS = [
  { label: 'α = 0.05 → reject at BF₁₀ ≥ 20', value: 0.05 },
  { label: 'α = 0.01 → reject at BF₁₀ ≥ 100', value: 0.01 },
  { label: 'α = 0.001 → reject at BF₁₀ ≥ 1000', value: 0.001 },
]

const source = computed(() => sourceSummary())
const budget = computed(() => bytesFor(trials.value, BITS))
const hint = computed(() =>
  source.value.network
    ? `${fmtBytes(budget.value)} from ${source.value.label} — about ${Math.ceil(budget.value / 32)} beacon rounds. Cancel stays live throughout.`
    : `${fmtBytes(budget.value)} from ${source.value.providerName}, one 200-bit trial at a time`,
)

interface EProcessRun {
  points: CoinEProcessPoint[]
  observations: { k: number; n: number }[]
  /** First trial at which a re-checked fixed-n two-sided p fell below α. */
  firstFixedN: number
  /** First trial at which the e-process crossed 1/α. */
  firstAnytime: number
  source: string
}

const task = useTask<EProcessRun>()
const run = computed(() => task.result.value)

/** One 200-bit trial per observation, pulled from the selected source in batches. */
async function* observations(count: number, signal: AbortSignal): AsyncGenerator<CoinObservation> {
  let made = 0
  while (made < count) {
    const batch = Math.min(BATCH, count - made)
    const bytes = await getBytes(bytesFor(batch, BITS), { signal })
    for (const sum of sumsFromBytes(bytes, BITS)) {
      if (made >= count) return
      made++
      yield { k: sum, n: BITS }
    }
  }
}

function go(): void {
  void task.run(async (signal, setProgress) => {
    restartSource()
    const tick = createYielder(8, signal)
    const points: CoinEProcessPoint[] = []
    const collected: { k: number; n: number }[] = []
    let firstFixedN = 0
    let firstAnytime = 0
    let k = 0
    let n = 0
    const stream = coinEProcess(observations(trials.value, signal), {
      alpha: alpha.value,
      a: priorA.value,
      b: priorB.value,
      stopOnReject: stopOnReject.value,
      signal,
    })
    for await (const point of stream) {
      collected.push({ k: point.k - k, n: point.n - n })
      k = point.k
      n = point.n
      points.push(point)
      const z = (point.k - point.n / 2) / Math.sqrt(point.n / 4)
      if (!firstFixedN && 2 * normSf(Math.abs(z)) <= alpha.value) firstFixedN = points.length
      if (!firstAnytime && point.reject) firstAnytime = points.length
      setProgress(points.length / trials.value)
      await tick()
    }
    return {
      points,
      observations: collected,
      firstFixedN,
      firstAnytime,
      source: sourceSummary().providerName,
    }
  })
}

const chart = computed(() => {
  const points = run.value?.points ?? []
  if (!points.length) return undefined
  const clamp = (x: number) => Math.min(1e9, Math.max(1e-9, x))
  return {
    series: [
      { name: 'BF₁₀ (running)', y: points.map((p) => clamp(p.bf10)) },
      { name: 'max BF₁₀ (what the anytime p uses)', y: points.map((p) => clamp(p.maxBf10)), color: 3 },
    ],
    x: points.map((p) => p.n / BITS),
  }
})

const last = computed(() => run.value?.points.at(-1))

// ── sequential design ─────────────────────────────────────────────────────
const bfStop = ref(10)
const bfStopNull = ref(0.1)
const minTrials = ref(400)
const maxTrials = ref(24000)
const everyN = ref(2000)

const plan = computed(() => ({
  bfStop: bfStop.value,
  bfStopNull: bfStopNull.value,
  minTrials: minTrials.value,
  maxTrials: maxTrials.value,
  looks: { every: everyN.value } as SequentialLooks,
  prior: { a: priorA.value, b: priorB.value, p0: 0.5 },
}))

const planDigest = ref<string>()
const planError = ref<unknown>()
watch(
  plan,
  async (spec) => {
    try {
      sequentialPlan(spec)
      planDigest.value = await sequentialPlanDigest(spec)
      planError.value = undefined
    } catch (err) {
      planDigest.value = undefined
      planError.value = err
    }
  },
  { immediate: true },
)

const seqTask = useTask<SequentialOutcome>()
function evaluate(): void {
  void seqTask.run(async () => {
    const data = run.value?.observations ?? []
    return await runSequential(data, plan.value)
  })
}
const outcome = computed(() => seqTask.result.value)

const DECISION_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  stop_h1: 'warning',
  stop_h0: 'success',
  stop_max: 'neutral',
  incomplete: 'neutral',
}

const snippet = computed(
  () => `import { coinEProcess, runSequential, sequentialPlan, sequentialPlanDigest } from '@mindpeeker/psi'

// a 200-bit trial is one increment { k: sum, n: 200 }
for await (const point of coinEProcess(trials, { alpha: ${alpha.value}, stopOnReject: ${stopOnReject.value} })) {
  dashboard.show(point.n, point.lnBf10, point.anytimeP, point.reject)
}

// the same data under a design published before it existed
const plan = sequentialPlan({
  bfStop: ${bfStop.value}, bfStopNull: ${bfStopNull.value},
  minTrials: ${minTrials.value}, maxTrials: ${maxTrials.value}, looks: { every: ${everyN.value} },
})
console.log(await sequentialPlanDigest(plan))       // publish before data
const out = await runSequential(observations, plan) // decision, looks, anytimeP`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="bayes-eprocess"
      title="3 · Anytime-valid monitoring: the coin e-process"
      description="With the prior fixed in advance the running Bayes factor is a test martingale under H0, so by Ville's inequality P(∃n : BF₁₀ ≥ 1/α) ≤ α — you may look after every trial and stop whenever you like."
      :api="['coinEProcess', 'CoinEProcess', 'CoinEProcessPoint.anytimeP']"
    >
      <template #controls>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          :label="`Run ${trials} trials`"
          busy-label="Watching…"
          :hint="hint"
          @run="go"
          @cancel="task.cancel()"
        />
        <UFormField label="Trials (200 bits each)">
          <UInputNumber v-model="trials" :min="10" :max="2000" :step="10" class="w-36" />
        </UFormField>
        <UFormField label="Stop level α" class="min-w-64">
          <USelect v-model="alpha" :items="ALPHAS" class="w-full" />
        </UFormField>
        <UFormField label="Prior a">
          <UInputNumber v-model="priorA" :min="0.01" :step="0.5" class="w-24" />
        </UFormField>
        <UFormField label="Prior b">
          <UInputNumber v-model="priorB" :min="0.01" :step="0.5" class="w-24" />
        </UFormField>
        <USwitch v-model="stopOnReject" label="stop on reject" />
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div v-if="run && last" class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="trials watched"
            :value="run.points.length"
            :digits="0"
            :note="`${fmtNum(last.k, { digits: 0 })} ones of ${fmtNum(last.n, { digits: 0 })} bits`"
          />
          <StatTile label="BF₁₀ now" :value="last.bf10" :digits="4" note="the martingale's current value" />
          <StatTile label="anytime p" size="md">
            <template #value><PValue :p="last.anytimeP" kind="anytime" label="p" /></template>
            <template #note>min(1, 1/max BF₁₀) — valid under continuous peeking</template>
          </StatTile>
          <StatTile
            label="rejected at α"
            :value="last.reject ? 'yes' : 'no'"
            :tone="last.reject ? 'warning' : 'success'"
            :note="`threshold BF₁₀ ≥ ${fmtNum(1 / alpha, { digits: 0 })}`"
          />
        </div>

        <LineChart
          v-if="chart"
          :series="chart.series"
          :x="chart.x"
          :hlines="[
            { value: 1 / alpha, label: `1/α = ${fmtNum(1 / alpha, { digits: 0 })}` },
            { value: 1, label: 'no evidence', dashed: false },
          ]"
          log-y
          x-label="trial"
          y-label="BF₁₀ (log scale)"
          :height="280"
          :format="(v) => fmtNum(v, { digits: 4 })"
          aria-label="running Bayes factor and its maximum against the anytime-valid threshold"
        />

        <div class="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="a re-checked fixed-n p ≤ α"
            :value="run.firstFixedN ? `first at trial ${run.firstFixedN}` : 'never in this run'"
            :tone="run.firstFixedN ? 'error' : 'neutral'"
            note="this is the invalid way to watch — shown only as the comparison"
          />
          <StatTile
            label="e-process crossed 1/α"
            :value="run.firstAnytime ? `first at trial ${run.firstAnytime}` : 'never in this run'"
            :tone="run.firstAnytime ? 'warning' : 'success'"
            note="the valid way — its error rate is bounded by α whenever you look"
          />
        </div>
        <AccountingBadge :bytes-consumed="bytesFor(run.points.length, BITS)" :bits-used="run.points.length * BITS" :source="run.source" />
      </div>
      <p v-else-if="!task.busy.value" class="text-sm text-muted">
        Run it to watch the martingale. On a fair source it wanders below 1 and the anytime p stays
        near 1 — that "nothing" is the point.
      </p>

      <HonestNote variant="exact">
        Checking a fixed-n two-sided p ≤ 0.05 after every flip of a <em>fair</em> coin (flips 10 to
        2000) rejects with probability 0.511; the e-process at 1/α = 20 rejects with probability
        0.037. Both numbers are computed exactly by dynamic programming in the package's test suite.
        One run of a few hundred trials will usually show neither crossing — the comparison is about
        rates, not about this run.
      </HonestNote>
    </DemoSection>

    <DemoSection
      id="bayes-sequential"
      title="4 · Sequential design, registered before the data"
      description="A design that names its stopping rule and its look schedule, hashes them, and then reports every look it took. P(stop_h1 | H0) ≤ 1/bfStop holds for any look schedule."
      :api="['sequentialPlan', 'sequentialPlanDigest', 'runSequential', 'SEQUENTIAL_SCHEMA']"
    >
      <template #controls>
        <UFormField label="Stop for H₁ at BF₁₀ ≥">
          <UInputNumber v-model="bfStop" :min="1.01" :step="1" class="w-28" />
        </UFormField>
        <UFormField label="Stop for H₀ at BF₁₀ ≤">
          <UInputNumber v-model="bfStopNull" :min="0.001" :max="0.999" :step="0.05" class="w-28" />
        </UFormField>
        <UFormField label="Min bits">
          <UInputNumber v-model="minTrials" :min="1" :step="100" class="w-32" />
        </UFormField>
        <UFormField label="Max bits">
          <UInputNumber v-model="maxTrials" :min="1" :step="1000" class="w-36" />
        </UFormField>
        <UFormField label="Look every … bits">
          <UInputNumber v-model="everyN" :min="1" :step="500" class="w-32" />
        </UFormField>
        <UButton
          icon="i-lucide-gauge"
          :loading="seqTask.busy.value"
          :disabled="!run || !planDigest"
          @click="evaluate"
        >
          Evaluate on the run above
        </UButton>
      </template>

      <ErrorAlert :err="planError" :dismissible="false" title="This sequential plan is invalid" />
      <ErrorAlert :err="seqTask.error.value" @dismiss="seqTask.reset()" />

      <div class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="plan digest" :value="shortHash(planDigest)" size="sm" tone="primary" note="publish before collecting" />
          <StatTile
            label="decision"
            :value="outcome?.decision ?? '—'"
            :tone="outcome ? DECISION_TONE[outcome.decision] : 'neutral'"
            size="sm"
            :note="`P(stop_h1 | H0) ≤ 1/${bfStop} = ${fmtNum(1 / bfStop, { digits: 3 })}`"
          />
          <StatTile label="BF₁₀ at the end" :value="outcome?.bf10" :digits="4" size="sm" :note="`k ${outcome?.k ?? '—'} of n ${outcome?.n ?? '—'} bits`" />
          <StatTile label="anytime p" size="sm">
            <template #value><PValue :p="outcome?.anytimeP" kind="anytime" /></template>
            <template #note>from the maximum BF over the looks</template>
          </StatTile>
        </div>

        <div v-if="outcome?.looks.length" class="overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <caption class="text-left text-xs text-muted pb-2">
              Every look the design took, in order — the maximum n is always a look.
            </caption>
            <thead>
              <tr class="text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" class="py-1.5 pr-3">look</th>
                <th scope="col" class="py-1.5 pr-3">n (bits)</th>
                <th scope="col" class="py-1.5 pr-3">k</th>
                <th scope="col" class="py-1.5 pr-3">BF₁₀</th>
                <th scope="col" class="py-1.5 pr-3">BF₀₁</th>
                <th scope="col" class="py-1.5 pr-3">decision</th>
              </tr>
            </thead>
            <tbody class="font-mono tabular-nums">
              <tr v-for="look in outcome.looks" :key="look.look" class="border-t border-default">
                <td class="py-1.5 pr-3">{{ look.look }}</td>
                <td class="py-1.5 pr-3">{{ fmtNum(look.n, { digits: 0 }) }}</td>
                <td class="py-1.5 pr-3">{{ fmtNum(look.k, { digits: 0 }) }}</td>
                <td class="py-1.5 pr-3">{{ fmtNum(look.bf10, { digits: 4 }) }}</td>
                <td class="py-1.5 pr-3">{{ fmtNum(look.bf01, { digits: 4 }) }}</td>
                <td class="py-1.5 pr-3 font-sans">{{ look.decision }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="text-sm text-muted">
          Run the e-process above first; this design then replays its observations at the registered
          looks. The counts are in <em>bits</em> — each 200-bit trial advances n by 200.
        </p>

        <CodeSnippet :code="snippet" title="what these two sections run" />
      </div>

      <HonestNote variant="caveat">
        The bound P(stop_h1 | H0) ≤ 1/bfStop holds for any look schedule. No such bound covers
        <code class="font-mono">bfStopNull</code>: the rate of misleading evidence <em>for</em> H₀
        depends on the true effect and has to be simulated for the design you actually registered
        (Schönbrodt et al. 2017).
      </HonestNote>
    </DemoSection>
  </div>
</template>
