<script setup lang="ts">
/** Section 2 — is the number bigger than the null says it should be? */
import { fmtDuration, fmtNum } from '~/lib/format'
import type { SignificanceResult, SurrogateConfig } from '~/lib/flow/jobs'
import { biasFloor, degreesOfFreedom, smallestP, surrogatesForAlpha, teNullDensity } from '~/lib/flow/theory'
import {
  num,
  SURROGATE_METHODS,
  SURROGATE_NOTES,
  type LabSeries,
  type SurrogateMethodName,
} from '~/lib/flow/types'
import { runFlowJob } from '~/lib/flow/worker-client'

const props = defineProps<{ series?: LabSeries }>()

const METHODS = SURROGATE_METHODS.map((value) => ({ label: value, value }))
const ENSEMBLE_SIZES = [19, 99, 199, 499, 999].map((value) => ({
  label: `${value} surrogates · smallest p ${smallestP(value).toFixed(4)}`,
  value,
}))

const method = ref<SurrogateMethodName>('circularShift')
const surrogates = ref(199)
const seed = ref(42)
const blockSize = ref(0)
const meanBlockSize = ref(0)
const markovOrder = ref(1)
const eteSurrogates = ref(20)
const showObserved = ref(false)

const task = useTask<SignificanceResult>()
const result = computed(() => task.result.value)

const config = computed<SurrogateConfig>(() => ({
  method: method.value,
  surrogates: num(surrogates.value, 199),
  seed: num(seed.value, 42),
  ...(method.value === 'blockShuffle' && num(blockSize.value) > 0
    ? { blockSize: num(blockSize.value) }
    : {}),
  ...(method.value === 'stationaryBootstrap' && num(meanBlockSize.value) > 0
    ? { meanBlockSize: num(meanBlockSize.value) }
    : {}),
  ...(method.value === 'markov' ? { markovOrder: num(markovOrder.value, 1) } : {}),
}))

function run(): void {
  const s = props.series
  if (!s) return
  void task.run(async (signal, setProgress) => {
    setProgress(null)
    const value = await runFlowJob(
      'significance',
      {
        x: s.x,
        y: s.y,
        embedding: { k: s.params.k, l: s.params.l, lag: s.params.lag, millerMadow: s.params.millerMadow },
        surrogate: config.value,
        eteSurrogates: num(eteSurrogates.value, 20),
      },
      signal,
    )
    const max = value.ensemble.length > 0 ? Math.max(...value.ensemble) : 0
    showObserved.value = value.te <= max * 5
    return value
  })
}

const ensembleMax = computed(() => {
  const value = result.value
  return value && value.ensemble.length > 0 ? Math.max(...value.ensemble) : 0
})

const domain = computed<[number, number] | undefined>(() => {
  const value = result.value
  if (!value) return undefined
  const high = showObserved.value ? Math.max(ensembleMax.value, value.te) : ensembleMax.value
  // A degenerate ensemble (every surrogate exactly 0) would give a zero-width axis.
  return [0, Math.max(high * 1.08, 1e-6)]
})

const nullDensity = computed(() => {
  const value = result.value
  if (!value || !value.chi.adequate) return undefined
  return teNullDensity(value.chi.df, value.chi.count)
})

const floor = computed(() => {
  const value = result.value
  return value ? biasFloor(value.chi.df, value.chi.count) : Number.NaN
})

/** How far the observed value sits beyond the largest surrogate. */
const beyond = computed(() => {
  const value = result.value
  return value && ensembleMax.value > 0 ? value.te / ensembleMax.value : Number.NaN
})

const adequacy = computed(() => {
  const chi = result.value?.chi
  if (!chi) return undefined
  return {
    needed: chi.minSamplesPerCell * chi.cells,
    have: chi.count,
    ok: chi.adequate,
  }
})

const snippet = computed(() => {
  const s = props.series
  const embedding = `{ k: ${s?.params.k ?? 1}, l: ${s?.params.l ?? 1}, lag: ${s?.params.lag ?? 1}, alphabet: 2 }`
  const extra =
    method.value === 'blockShuffle' && blockSize.value > 0
      ? `, blockSize: ${blockSize.value}`
      : method.value === 'stationaryBootstrap' && meanBlockSize.value > 0
        ? `, meanBlockSize: ${meanBlockSize.value}`
        : method.value === 'markov'
          ? `, markovOrder: ${markovOrder.value}`
          : ''
  return `import {
  chiSquareTest, effectiveTransferEntropy, permutationTest, transferEntropyReport,
} from '@mindpeeker/flow'

const embedding = ${embedding}
const nullModel = { surrogate: '${method.value}', surrogates: ${surrogates.value}, seed: ${seed.value}${extra} }

// analytic: G = 2N ln2 · TE ~ χ²(df) — trust it only when 'adequate'
const { statistic, df, p: pChiSquare, adequate } = chiSquareTest(x, y, embedding)

// empirical: p = (1 + #{TE_surr ≥ TE_obs}) / (1 + n_surr)
const { te, surrogates: ensemble, p, mean, sd, z, distinct } =
  permutationTest(x, y, { ...embedding, ...nullModel })

// Marschinski–Kantz: TE minus the shuffled-source bias floor
const { ete, shuffleMean } = effectiveTransferEntropy(x, y, {
  ...embedding, surrogates: ${eteSurrogates.value}, seed: ${seed.value},
})

const report = transferEntropyReport(x, y, { ...embedding, ...nullModel })`
})
</script>

<template>
  <DemoSection
    id="significance"
    title="2 · Significance"
    :api="['chiSquareTest', 'permutationTest', 'effectiveTransferEntropy', 'transferEntropyReport']"
  >
    <template #description>
      Finite samples always give a positive transfer entropy, so a raw value decides nothing. Two
      independent tests say whether this one is larger than chance: the analytic χ² law, valid only
      when the table is well sampled, and a surrogate ensemble that rebuilds the null from the data
      itself. The surrogate you pick <em>is</em> the null hypothesis.
    </template>

    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!series"
        label="Test the flow"
        busy-label="Resampling…"
        icon="i-lucide-shuffle"
        :hint="
          series
            ? `${surrogates} ${method} surrogates on ${fmtNum(series.params.n, { digits: 0 })} symbols, in a Web Worker`
            : 'Draw the pair in section 1 first'
        "
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="Surrogate method" size="sm" :description="SURROGATE_NOTES[method].keeps">
        <USelect v-model="method" :items="METHODS" class="w-full" />
      </UFormField>
      <UFormField label="Ensemble size" size="sm" :description="`a level-α test needs ≥ 1/α − 1 surrogates`">
        <USelect v-model="surrogates" :items="ENSEMBLE_SIZES" class="w-full" />
      </UFormField>
      <UFormField label="Seed" size="sm" description="every method is deterministic for a seed">
        <UInputNumber v-model="seed" :min="0" :max="1000000" class="w-full" />
      </UFormField>
      <UFormField label="Shuffles for ETE" size="sm" description="averaged into the bias estimate">
        <UInputNumber v-model="eteSurrogates" :min="2" :max="200" class="w-full" />
      </UFormField>
      <UFormField
        v-if="method === 'blockShuffle'"
        label="Block size"
        size="sm"
        description="0 = the package default ⌈n^(1/3)⌉"
      >
        <UInputNumber v-model="blockSize" :min="0" :max="512" class="w-full" />
      </UFormField>
      <UFormField
        v-if="method === 'stationaryBootstrap'"
        label="Mean block size"
        size="sm"
        description="0 = the package default"
      >
        <UInputNumber v-model="meanBlockSize" :min="0" :max="512" class="w-full" />
      </UFormField>
      <UFormField v-if="method === 'markov'" label="Markov order" size="sm" description="transition structure kept">
        <UInputNumber v-model="markovOrder" :min="1" :max="4" class="w-full" />
      </UFormField>
    </div>

    <p class="mt-3 text-xs text-muted">
      <strong class="text-highlighted">{{ method }}</strong> keeps {{ SURROGATE_NOTES[method].keeps }} and
      destroys {{ SURROGATE_NOTES[method].destroys }}. At α = 0.05 you need at least
      {{ surrogatesForAlpha(0.05) }} surrogates, at α = 0.01 at least {{ surrogatesForAlpha(0.01) }}.
    </p>

    <div v-if="result" class="mt-4 flex flex-col gap-5">
      <div>
        <h3 class="text-sm font-medium text-highlighted">Analytic χ² test</h3>
        <div class="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="G = 2N ln2 · TE" :value="result.chi.statistic" :digits="2" />
          <StatTile
            label="df"
            :value="result.chi.df"
            :digits="0"
            :note="`(A_Y − 1)·A_Yᵏ·(A_Xˡ − 1) = ${degreesOfFreedom(2, 2, result.report.embedding.k, result.report.embedding.l)}`"
          />
          <StatTile label="χ² p" :tone="result.chi.adequate ? 'neutral' : 'warning'">
            <template #value><PValue :p="result.chi.p" kind="pointwise" /></template>
            <template #note>
              {{ result.chi.adequate ? 'asymptotic, and adequately sampled' : 'asymptotic — NOT adequately sampled' }}
            </template>
          </StatTile>
          <StatTile
            label="table occupancy"
            :value="`${result.chi.occupiedCells} / ${result.chi.cells}`"
            :note="`${fmtNum(result.chi.count, { digits: 0 })} embedded tuples`"
          />
        </div>
        <UAlert
          v-if="adequacy"
          class="mt-3"
          :color="adequacy.ok ? 'success' : 'warning'"
          variant="subtle"
          :icon="adequacy.ok ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
          :title="adequacy.ok ? 'Adequate: N ≥ 10 · A_Y^(k+1) · A_Xˡ' : 'Inadequate: the χ² p is not trustworthy here'"
          :description="`The rule wants ${fmtNum(adequacy.needed, { digits: 0 })} tuples for this table; the data has ${fmtNum(adequacy.have, { digits: 0 })}. Measured on seeded independent pairs, binary k = l = 1 rejects 6.3% at N = 100 and 5.9% at N = 500 — but alphabet 4 with k = 2 rejects 59% at N = 500.`"
        />
      </div>

      <div>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-medium text-highlighted">Surrogate ensemble</h3>
          <USwitch v-model="showObserved" size="sm" label="show the observed value on the axis" />
        </div>
        <Histogram
          class="mt-2"
          :values="result.ensemble"
          :bins="40"
          density
          :domain="domain"
          :reference="nullDensity"
          reference-label="χ²(df) / (2N ln2) — the asymptotic null"
          :markers="
            showObserved
              ? [
                  { value: result.te, label: 'observed TE', color: 2 },
                  { value: result.mean, label: 'surrogate mean', color: 4, dashed: true },
                ]
              : [{ value: result.mean, label: 'surrogate mean', color: 4, dashed: true }]
          "
          x-label="transfer entropy of a surrogate (bits)"
          :height="240"
          :aria-label="`Distribution of ${result.ensemble.length} surrogate transfer entropies with the observed value marked`"
        />
        <p v-if="!showObserved" class="mt-1 text-xs text-muted">
          The observed TE is {{ fmtNum(result.te, { digits: 5 }) }} bits —
          {{ fmtNum(beyond, { digits: 1 }) }}× the largest surrogate
          ({{ fmtNum(ensembleMax, { digits: 5 }) }}), off this axis to the right.
        </p>

        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="permutation p" tone="primary">
            <template #value>
              <PValue :p="result.p" :kind="result.info.exact ? 'exact' : 'pointwise'" />
            </template>
            <template #note>
              (1 + #{TE_surr ≥ TE_obs}) / (1 + {{ result.info.n }}); floor
              {{ smallestP(result.info.n).toFixed(4) }}
            </template>
          </StatTile>
          <StatTile
            label="ensemble mean"
            :value="result.mean"
            :digits="5"
            :note="`bias floor df/(2N ln2) = ${fmtNum(floor, { digits: 5 })}`"
          />
          <StatTile label="ensemble sd" :value="result.sd" :digits="5" note="descriptive only" />
          <StatTile
            label="z = (TE − mean) / sd"
            :value="result.z"
            :digits="2"
            note="the null is not normal — decide with p, not z"
          />
          <StatTile
            label="distinct surrogates"
            :value="`${result.distinct} / ${result.info.n}`"
            :note="
              result.info.exact
                ? 'all n−1 rotations enumerated — this p is exact'
                : 'the real resolution of the null'
            "
          />
          <StatTile
            label="method"
            :value="result.info.method"
            :mono="false"
            :note="`seed ${result.info.seed}${result.info.blockSize ? ` · block ${result.info.blockSize}` : ''}${result.info.meanBlockSize ? ` · mean block ${result.info.meanBlockSize}` : ''}${result.info.markovOrder ? ` · order ${result.info.markovOrder}` : ''}`"
          />
          <StatTile
            label="effective TE"
            :value="result.ete.ete"
            :digits="5"
            note="TE − mean TE of shuffled sources (Marschinski–Kantz)"
          />
          <StatTile
            label="shuffle mean"
            :value="result.ete.shuffleMean"
            :digits="5"
            :note="`over ${eteSurrogates} shuffles — compare with the bias floor`"
          />
        </div>
      </div>

      <FlowReport :report="result.report" :elapsed="result.elapsedMs" />

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <p v-else-if="!task.busy.value" class="mt-4 text-sm text-muted">
      {{ series ? 'Run the test to build the null.' : 'Draw the pair in section 1 first.' }}
    </p>

    <template #footer>
      A small p says the observed value is unlikely under
      <em>this</em> null — not that X causes Y, and not that the effect is large. A large p is not
      independence either: a leak too weak for
      {{ series ? fmtNum(series.params.n, { digits: 0 }) : 'these' }} symbols passes unnoticed.
      {{ result ? `The ensemble took ${fmtDuration(result.elapsedMs)} in a worker.` : '' }}
    </template>
  </DemoSection>
</template>
