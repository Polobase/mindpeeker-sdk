<script setup lang="ts">
/**
 * Section 3b — time-offset (circular) surrogates: rotating one source against
 * the rest keeps most pair alignments intact and has little power against a
 * network-wide effect; `rotate: 'all-but-one'` misaligns every pair.
 */
import {
  analyzeEvent,
  permutationP,
  type Surrogate,
  timeOffsetSurrogates,
  type TrialSeries,
} from '@mindpeeker/psi'
import { createYielder } from '~/lib/async'
import { fmtBytes } from '~/lib/format'
import {
  bytesFor,
  injectShift,
  makeSeries,
  type SimSource,
  simBytes,
  sumsFromBytes,
} from '~/lib/psi/synthetic'

const BITS = 200
const T0 = Date.UTC(2026, 8, 17, 12, 0, 0)

const sources = ref(4)
const steps = ref(240)
const surrogates = ref(99)
const seed = ref(20260917)
const epsilon = ref(0)
const simSource = ref<SimSource>('drbg')

const SIM_SOURCES: { label: string; value: SimSource }[] = [
  { label: 'seeded DRBG — reproducible', value: 'drbg' },
  { label: 'browser CSPRNG — a fresh archive every run', value: 'crypto' },
]

const budget = computed(() => bytesFor(sources.value * steps.value, BITS))

interface OffsetResult {
  observed: number
  one: number[]
  allButOne: number[]
  pOne: number
  pAll: number
  sampleOffsets: readonly number[]
  steps: number
}

const task = useTask<OffsetResult>()
const result = computed(() => task.result.value)

function go(): void {
  void task.run(async (signal, setProgress) => {
    const tick = createYielder(8, signal)
    const bytes = await simBytes(
      budget.value,
      simSource.value,
      `psi time-offset archive / ${seed.value}`,
      signal,
    )
    const all = sumsFromBytes(bytes, BITS)
    const window = { startStep: 0, endStep: steps.value }
    const archive: TrialSeries[] = []
    for (let s = 0; s < sources.value; s++) {
      const raw = all.slice(s * steps.value, (s + 1) * steps.value)
      // A synthetic, network-wide excursion over the middle third — injected, not found.
      const sums = injectShift(
        raw,
        BITS,
        epsilon.value,
        Math.floor(steps.value / 3),
        Math.floor((2 * steps.value) / 3),
      )
      archive.push(makeSeries(`egg-${s + 1}`, sums, { bitsPerTrial: BITS, t0: T0 }))
    }
    const observed = analyzeEvent(archive, window).netvar.statistic

    const one: number[] = []
    let done = 0
    const total = 2 * surrogates.value
    for (const surrogate of timeOffsetSurrogates(archive, {
      rotate: 'one',
      sourceIndex: 0,
      surrogates: surrogates.value,
    })) {
      one.push(analyzeEvent(surrogate.series, window).netvar.statistic)
      setProgress(++done / total)
      await tick()
    }

    const allButOne: number[] = []
    let sample: Surrogate | undefined
    for (const surrogate of timeOffsetSurrogates(archive, {
      rotate: 'all-but-one',
      sourceIndex: 0,
      design: 'random',
      surrogates: surrogates.value,
      seed: seed.value,
    })) {
      sample ??= surrogate
      allButOne.push(analyzeEvent(surrogate.series, window).netvar.statistic)
      setProgress(++done / total)
      await tick()
    }

    return {
      observed,
      one,
      allButOne,
      pOne: permutationP(observed, one),
      pAll: permutationP(observed, allButOne),
      sampleOffsets: sample?.offsets ?? [],
      steps: steps.value,
    }
  })
}

const snippet = computed(
  () => `import { analyzeEvent, permutationP, timeOffsetSurrogates } from '@mindpeeker/psi'

const observed = analyzeEvent(archive, { startStep: 0, endStep: ${steps.value} }).netvar.statistic

// misalign every pair, not just one source against the rest
const nulls = [...timeOffsetSurrogates(archive, {
  rotate: 'all-but-one', design: 'random', surrogates: ${surrogates.value}, seed: ${seed.value},
})].map((s) => analyzeEvent(s.series, { startStep: 0, endStep: ${steps.value} }).netvar.statistic)

const p = permutationP(observed, nulls)   // resolution 1/${surrogates.value + 1}`,
)
</script>

<template>
  <DemoSection
    id="surrogates-offsets"
    title="2 · Time-offset surrogates: which pairs does the null misalign?"
    description="Circular rotations preserve each source's marginal distribution and autocorrelation (Theiler et al. 1992). What changes between the two modes is which source pairs stay aligned in the null."
    :api="['timeOffsetSurrogates', 'analyzeEvent', 'permutationP', 'Surrogate.offsets']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Build ${2 * surrogates} surrogate archives`"
        busy-label="Rotating…"
        :hint="`${fmtBytes(budget)} of simulation bytes · ${sources} sources × ${steps} steps`"
        @run="go"
        @cancel="task.cancel()"
      />
      <UFormField label="Sources">
        <UInputNumber v-model="sources" :min="2" :max="8" class="w-28" />
      </UFormField>
      <UFormField label="Steps">
        <UInputNumber v-model="steps" :min="40" :max="1200" :step="20" class="w-32" />
      </UFormField>
      <UFormField label="Surrogates">
        <UInputNumber v-model="surrogates" :min="19" :max="299" :step="20" class="w-32" />
      </UFormField>
      <UFormField label="Seed">
        <UInputNumber v-model="seed" :min="0" class="w-36" />
      </UFormField>
      <UFormField
        label="Injected per-bit shift ε"
        help="synthetic, applied to every source over the middle third"
      >
        <UInputNumber v-model="epsilon" :min="0" :max="0.2" :step="0.01" class="w-32" />
      </UFormField>
      <UFormField label="Simulation bytes" class="min-w-56">
        <USelect v-model="simSource" :items="SIM_SOURCES" class="w-full" />
      </UFormField>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div v-if="result" class="flex flex-col gap-5">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="observed netvar"
          :value="result.observed"
          :digits="2"
          :note="`χ²(${result.steps}) under H0 — expectation ${result.steps}`"
        />
        <StatTile label="p · rotate 'one'" size="md">
          <template #value><PValue :p="result.pOne" kind="exact" label="p" /></template>
          <template #note>only source 1 is rotated; most pairs stay aligned</template>
        </StatTile>
        <StatTile label="p · rotate 'all-but-one'" size="md">
          <template #value><PValue :p="result.pAll" kind="exact" label="p" /></template>
          <template #note>every pair misaligned — the null with power</template>
        </StatTile>
        <StatTile
          label="sample offsets"
          :value="result.sampleOffsets.join(', ') || '—'"
          size="sm"
          note="per-source τ of the first 'all-but-one' surrogate"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 class="text-sm font-medium text-highlighted mb-2">Null ensemble — rotate 'one'</h3>
          <Histogram
            :values="result.one"
            :bins="30"
            :markers="[{ value: result.observed, label: 'observed', color: 'error' }]"
            x-label="netvar statistic"
            y-label="surrogates"
            :height="220"
            aria-label="null distribution of netvar with only one source rotated"
          />
        </div>
        <div>
          <h3 class="text-sm font-medium text-highlighted mb-2">
            Null ensemble — rotate 'all-but-one'
          </h3>
          <Histogram
            :values="result.allButOne"
            :bins="30"
            :color="2"
            :markers="[{ value: result.observed, label: 'observed', color: 'error' }]"
            x-label="netvar statistic"
            y-label="surrogates"
            :height="220"
            aria-label="null distribution of netvar with every source given its own offset"
          />
        </div>
      </div>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>
    <p v-else-if="!task.busy.value" class="text-sm text-muted">
      With ε = 0 the archive is pure noise and both p-values should look like draws from a uniform.
      Raise ε to inject a synthetic network-wide excursion and watch the two nulls disagree: the
      single-source rotation keeps most of the effect inside its own null.
    </p>

    <HonestNote variant="caveat">
      <code class="font-mono">rotate: 'one'</code> (the default) tests <em>that one source</em>
      against the rest. With three or more sources most pair alignments survive into the null, so a
      network-wide effect is partly reproduced by the surrogates and the test loses power — a low p
      here is weaker evidence than the same p from
      <code class="font-mono">'all-but-one'</code>. The injected ε above is synthetic: it shows what
      an effect of that size would look like, and discovers nothing.
    </HonestNote>
  </DemoSection>
</template>
