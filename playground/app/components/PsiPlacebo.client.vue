<script setup lang="ts">
/**
 * Section 5c — the GCP's own control: random-start pseudo-events in off-event
 * data, recomputed with the same statistic, ranked against the observation.
 */
import { analyzeEvent, permutationP, placeboWindows, type TrialSeries } from '@mindpeeker/psi'
import { createYielder } from '~/lib/async'

const props = defineProps<{
  archive: readonly TrialSeries[]
  startStep: number
  endStep: number
  /** The observed netvar statistic of the declared window. */
  observed: number
}>()

const count = ref(99)
const seed = ref(20260917)

const windowSteps = computed(() => Math.max(1, props.endStep - props.startStep))

interface PlaceboResult {
  nulls: number[]
  p: number
  starts: number[]
  observed: number
}

const task = useTask<PlaceboResult>()
const result = computed(() => task.result.value)

function go(): void {
  void task.run(async (signal, setProgress) => {
    const tick = createYielder(8, signal)
    const windows = placeboWindows(props.archive, {
      windowSteps: windowSteps.value,
      count: count.value,
      seed: seed.value,
      exclude: [{ startStep: props.startStep, endStep: props.endStep }],
    })
    const nulls: number[] = []
    for (const [i, w] of windows.entries()) {
      nulls.push(analyzeEvent(props.archive, w).netvar.statistic)
      setProgress((i + 1) / windows.length)
      await tick()
    }
    return {
      nulls,
      p: permutationP(props.observed, nulls),
      starts: windows.map((w) => w.startStep),
      observed: props.observed,
    }
  })
}

// A new window means a new observation: drop a stale null ensemble rather than
// pairing it with a statistic it was never ranked against.
watch(
  () => [props.startStep, props.endStep, props.observed],
  () => {
    task.cancel()
    task.reset()
  },
)

const snippet = computed(
  () => `import { analyzeEvent, permutationP, placeboWindows } from '@mindpeeker/psi'

const placebos = placeboWindows(archive, {
  windowSteps: ${windowSteps.value}, count: ${count.value}, seed: ${seed.value},
  exclude: [{ startStep: ${props.startStep}, endStep: ${props.endStep} }],   // never sample the event itself
})
const nulls = placebos.map((w) => analyzeEvent(archive, w).netvar.statistic)
const p = permutationP(observed, nulls)   // resolution 1/${count.value + 1}`,
)
</script>

<template>
  <DemoSection
    id="event-placebo"
    title="3 · Placebo windows: the empirical null"
    description="Draw event-length windows at random starts elsewhere in the same recording, recompute netvar in each, and rank the observation among them. This answers “would a window like this have looked unusual anywhere?”."
    :api="['placeboWindows', 'analyzeEvent', 'permutationP']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Draw ${count} placebo windows`"
        busy-label="Resampling…"
        :hint="`${windowSteps}-step windows, the event window excluded — p resolution 1/${count + 1}`"
        @run="go"
        @cancel="task.cancel()"
      />
      <UFormField label="Placebo windows">
        <UInputNumber v-model="count" :min="19" :max="999" :step="20" class="w-32" />
      </UFormField>
      <UFormField label="Seed" help="part of the registration">
        <UInputNumber v-model="seed" :min="0" class="w-36" />
      </UFormField>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div v-if="result" class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="observed netvar" :value="result.observed" :digits="2" size="sm" />
        <StatTile label="placebo mean" :value="result.nulls.reduce((a, b) => a + b, 0) / result.nulls.length" :digits="2" size="sm" :note="`expectation ${windowSteps} under χ²(${windowSteps})`" />
        <StatTile label="empirical p" size="sm">
          <template #value><PValue :p="result.p" kind="exact" /></template>
          <template #note>rank among the placebos, +1 corrected</template>
        </StatTile>
        <StatTile
          label="first placebo starts"
          :value="result.starts.slice(0, 6).join(', ')"
          size="sm"
          mono
          note="drawn without replacement from the admissible starts"
        />
      </div>

      <Histogram
        :values="result.nulls"
        :bins="30"
        :markers="[{ value: result.observed, label: 'observed window', color: 'error' }]"
        x-label="netvar statistic"
        y-label="placebo windows"
        :height="240"
        aria-label="placebo-window null distribution of netvar with the observed window marked"
      />

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>
    <p v-else-if="!task.busy.value" class="text-sm text-muted">
      The placebos come from the same recording, so anything the devices do all day — drift, warm-up,
      a noisy afternoon — is inside the null instead of inflating the result.
    </p>

    <HonestNote variant="caveat">
      A placebo null answers a narrower question than the χ² p above it: it asks whether this window
      is unusual <em>for this recording</em>, not whether the recording is unusual. It cannot rescue
      a window that was chosen after the fact, and its resolution is 1/(count + 1) — 99 windows
      cannot support a claim below 0.01.
    </HonestNote>
  </DemoSection>
</template>
