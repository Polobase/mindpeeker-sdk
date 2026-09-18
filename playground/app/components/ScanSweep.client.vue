<script setup lang="ts">
/**
 * Tab 5 — the classical dial sweep, the procedure AetherOne's RNG race
 * replaced, modelled with a stated law so the reading has an exact null.
 */
import type { SweepModel, SweepReport } from '@mindpeeker/scan'
import { sweepNullPmf, sweepScan } from '@mindpeeker/scan'
import { formatRate } from '@mindpeeker/rate'
import { createYielder } from '~/lib/async'
import { drbgSource, provider, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtNum, fmtP } from '~/lib/format'
import { buildCatalog, catalogLines, DEFAULT_CATALOG_TEXT } from '~/lib/scan/catalog'
import { frequencies } from '~/lib/scan/stats'

const MODELS: { label: string; value: SweepModel }[] = [
  { label: 'first-passage — the literal sweep (default)', value: 'first-passage' },
  { label: 'uniform — every position equally likely', value: 'uniform' },
]
const TARGETS = [
  { label: 'dial bank — the stops form a Rate', value: 'dials' },
  { label: 'catalog — read top to bottom', value: 'catalog' },
] as const

const target = ref<'dials' | 'catalog'>('dials')
const dials = ref(3)
const positions = ref(44)
const model = ref<SweepModel>('first-passage')

const catalog = computed(() => buildCatalog('sweep', 'Sweep catalog', catalogLines(DEFAULT_CATALOG_TEXT)))
const effectivePositions = computed(() =>
  target.value === 'catalog' ? catalog.value.items.length : positions.value,
)

const nullPmf = computed(() => {
  try {
    return sweepNullPmf(effectivePositions.value, model.value)
  } catch {
    return []
  }
})
const pmfMode = computed(() => {
  let best = 0
  nullPmf.value.forEach((p, i) => {
    if (p > (nullPmf.value[best] as number)) best = i
  })
  return best
})

const source = computed(() => sourceSummary())
const sweepTask = useTask<SweepReport>()
const report = computed(() => sweepTask.result.value)

function runSweep(): void {
  void sweepTask.run(async (signal, setProgress) => {
    setProgress(null)
    restartSource()
    const what =
      target.value === 'catalog'
        ? catalog.value
        : { dials: dials.value, positions: positions.value }
    return await sweepScan(what, provider, { model: model.value, signal })
  })
}

// ── the empirical distribution, on a reproducible control source ──────────
const sweeps = ref(200)
const simTask = useTask<{ stops: number[]; source: string }>()
const simulation = computed(() => simTask.result.value)

function runSimulation(): void {
  void simTask.run(async (signal, setProgress) => {
    const tick = createYielder(8, signal)
    const control = drbgSource(`${currentSeedLabel()} / sweep simulation`)
    const stops: number[] = []
    const n = sweeps.value
    const what =
      target.value === 'catalog' ? catalog.value : { dials: 1, positions: positions.value }
    for (let i = 0; i < n; i++) {
      const one = await sweepScan(what, control, { model: model.value, signal })
      stops.push(one.stops[0] as number)
      if ((i & 7) === 0) {
        setProgress(i / n)
        await tick()
      }
    }
    return { stops, source: control.name }
  })
}

const categories = computed(() =>
  Array.from({ length: effectivePositions.value }, (_, i) => String(i)),
)
const empirical = computed(() =>
  simulation.value ? frequencies(simulation.value.stops, effectivePositions.value) : [],
)
const chartValues = computed(() => (empirical.value.length ? empirical.value : nullPmf.value))
const chartExpected = computed(() => (empirical.value.length ? nullPmf.value : undefined))
const highlightIndex = computed<number | undefined>(() => report.value?.stops[0])
const highlight = computed(() => (highlightIndex.value === undefined ? [] : [highlightIndex.value]))
const highlightPmf = computed(() =>
  highlightIndex.value === undefined ? undefined : nullPmf.value[highlightIndex.value],
)

const snippet = computed(
  () => `import { sweepNullPmf, sweepScan } from '@mindpeeker/scan'

// the classical procedure: every dial to its lowest setting, turn dial 1 while
// stroking the pad, stop at a "stick", move to the next dial.
const report = await sweepScan(${
    target.value === 'catalog'
      ? 'catalog'
      : `{ dials: ${dials.value}, positions: ${positions.value} }`
  }, source, { model: '${model.value}' })

report.stops                 // 0-based stop per dial, in sweep order
report.rate                  // { digits: stops, base: positions } — dial targets only
report.stopProbabilities     // nullPmf[stop] per dial: how often chance stops there
sweepNullPmf(${effectivePositions.value}, '${model.value}') // the exact law, before any data`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="scan-sweep"
      title="1 · Sweep the dials"
      description="At position k of P a stick occurs with probability (k+1)/P, a hazard that rises until the last position always sticks — no overshoot. The stop is a chance event with a stated law, not a measurement."
      :api="['sweepScan', 'sweepNullPmf', 'SweepReport', 'SweepModel']"
    >
      <template #controls>
        <RunControls
          :busy="sweepTask.busy.value"
          :progress="sweepTask.progress.value"
          label="Sweep once"
          busy-label="Sweeping…"
          :hint="`a handful of bytes from ${source.providerName}`"
          @run="runSweep"
          @cancel="sweepTask.cancel()"
        />
      </template>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UFormField label="Target" class="sm:col-span-2">
          <USelect v-model="target" :items="TARGETS" class="w-full" />
        </UFormField>
        <UFormField label="Model" class="sm:col-span-2">
          <USelect v-model="model" :items="MODELS" class="w-full" />
        </UFormField>
        <UFormField v-if="target === 'dials'" label="dials" help="swept nearest the well first">
          <UInputNumber v-model="dials" :min="1" :max="8" class="w-full" />
        </UFormField>
        <UFormField v-if="target === 'dials'" label="positions" help="the dial's base">
          <UInputNumber v-model="positions" :min="2" :max="200" class="w-full" />
        </UFormField>
        <StatTile
          label="positions swept"
          :value="effectivePositions"
          :digits="0"
          size="sm"
          :note="target === 'catalog' ? 'the catalog read top to bottom' : 'per dial'"
        />
        <StatTile
          label="most likely stop"
          :value="model === 'uniform' ? 'all equal' : `position ${pmfMode}`"
          size="sm"
          :note="model === 'uniform' ? `1/${effectivePositions} everywhere` : 'the mode sits near √P'"
        />
      </div>

      <ErrorAlert :err="sweepTask.error.value" @dismiss="sweepTask.reset()" />

      <div v-if="report" class="mt-2 flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs uppercase tracking-wide text-muted">stops</span>
          <span
            v-for="(stop, i) in report.stops"
            :key="i"
            class="inline-flex items-center gap-1 rounded border border-default bg-elevated px-2 py-0.5 font-mono text-xs"
            :title="`dial ${i + 1}: position ${stop}, chance ${fmtP(report.stopProbabilities[i])}`"
          >
            <span class="text-dimmed">d{{ i + 1 }}</span>
            <span class="text-highlighted">{{ stop }}</span>
            <span class="text-dimmed">({{ fmtP(report.stopProbabilities[i]) }})</span>
          </span>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            v-if="report.rate"
            label="rate from the stops"
            :value="formatRate(report.rate, { pad: true })"
            size="sm"
            note="{ digits: stops, base: positions }"
          />
          <StatTile
            v-if="report.item"
            label="the sweep stopped at"
            :value="report.item.name"
            size="sm"
            :mono="false"
            note="one 'dial' whose positions are the items"
          />
          <StatTile
            label="chance of this reading"
            :value="report.stopProbabilities.reduce((a, b) => a * b, 1)"
            :digits="5"
            size="sm"
            note="product of the per-dial stop probabilities"
          />
          <StatTile label="model" :value="report.model" size="sm" note="the law the stop came from" />
        </div>
        <AccountingBadge
          :bytes-consumed="report.accounting.bytesConsumed"
          :bits-used="report.accounting.bitsUsed"
          :source="report.source"
        />
      </div>

      <HonestNote variant="exact">
        Under first-passage the exact law is P(k) = (k+1)/P · Π<sub>j&lt;k</sub>(1 − (j+1)/P), which
        sums to 1 and is far from flat: P(0) = 1/P while the mode sits near √P. A sweep that "keeps
        landing" in the middle is showing the model, not the target.
      </HonestNote>

      <template #footer>
        The practitioner literature describes exactly this procedure — every dial to its lowest
        setting, turn while stroking the rubber pad, stop at a stick, never watch the dials — and
        never states how often a stick at a given position happens by chance.
      </template>
    </DemoSection>

    <DemoSection
      id="scan-sweep-null"
      title="2 · Many sweeps against the exact null"
      description="Repeat the sweep on a seeded control DRBG and lay the observed stop frequencies over the exact pmf. No beacon rounds are spent, and the same seed replays byte for byte."
      :api="['sweepScan', 'sweepNullPmf', 'drbgProvider']"
    >
      <template #controls>
        <RunControls
          :busy="simTask.busy.value"
          :progress="simTask.progress.value"
          :label="`Run ${sweeps} sweeps`"
          busy-label="Sweeping…"
          hint="drawn from a seeded control DRBG, not the selected source"
          @run="runSimulation"
          @cancel="simTask.cancel()"
        >
          <UFormField label="sweeps" size="xs" class="w-32">
            <UInputNumber v-model="sweeps" :min="20" :max="2000" :step="50" class="w-full" />
          </UFormField>
        </RunControls>
      </template>

      <ErrorAlert :err="simTask.error.value" @dismiss="simTask.reset()" />

      <BarChart
        :categories="categories"
        :values="chartValues"
        :expected="chartExpected"
        expected-label="exact nullPmf"
        :highlight="highlight"
        x-label="stop position"
        y-label="probability"
        :height="260"
        :aria-label="
          empirical.length
            ? 'Observed stop frequencies over many sweeps against the exact null pmf'
            : 'The exact null distribution of one sweep'
        "
        :format="(v) => v.toFixed(4)"
      />
      <p class="text-xs text-muted">
        {{
          empirical.length
            ? `Bars: ${simulation?.stops.length} simulated sweeps. Ticks: the exact pmf.`
            : 'Bars: the exact pmf, before any data. Run the sweeps to overlay what a fair source actually does.'
        }}
        <template v-if="highlightIndex !== undefined">
          The highlighted bar is the single sweep above (position {{ highlightIndex }}, chance
          {{ fmtNum(highlightPmf, { digits: 4 }) }}).
        </template>
      </p>

      <CodeSnippet :code="snippet" title="what these buttons run" />
    </DemoSection>

    <ScanRace />
  </div>
</template>
