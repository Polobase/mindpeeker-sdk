<script setup lang="ts">
/**
 * Section 7 — the presentiment (time-reversed) protocol as an RNG analogue:
 * disjoint epochs, label provenance, a post-stimulus sanity control and a
 * seeded label-shuffle null.
 */
import {
  analyzePresentiment,
  type PresentimentAnalysis,
  type PresentimentEpochs,
  type PresentimentEvent,
  presentimentEpochs,
  type Stimulus,
  type TrialSeries,
} from '@mindpeeker/psi'
import { fmtNum } from '~/lib/format'
import {
  bytesFor,
  injectShift,
  makeSeries,
  type SimSource,
  simBytes,
  sumsFromBytes,
  zScores,
} from '~/lib/psi/synthetic'

const BITS = 200
const T0 = Date.UTC(2026, 8, 17, 12, 0, 0)

const trials = ref(400)
const spacing = ref(20)
const preWindow = ref(5)
const postWindow = ref(5)
const allowOverlap = ref(false)
const provenance = ref<'valid' | 'early' | 'none'>('valid')
const surrogates = ref(99)
const seed = ref(20260917)
const epsilon = ref(0)
const simSource = ref<SimSource>('drbg')

const PROVENANCE = [
  { label: 'labelDrawnAt after the pre-window closed — kept', value: 'valid' },
  { label: 'labelDrawnAt before it closed — dropped', value: 'early' },
  { label: 'no labelDrawnAt — unverifiable, kept', value: 'none' },
]
const SIM_SOURCES: { label: string; value: SimSource }[] = [
  { label: 'seeded DRBG — reproducible', value: 'drbg' },
  { label: 'browser CSPRNG — a fresh recording', value: 'crypto' },
]

interface Recording {
  series: TrialSeries
  events: PresentimentEvent[]
}

const task = useTask<Recording>()
const recording = computed(() => task.result.value)

function go(): void {
  void task.run(async (signal) => {
    const bytes = await simBytes(
      bytesFor(trials.value, BITS),
      simSource.value,
      `psi presentiment / ${seed.value}`,
      signal,
    )
    let sums = sumsFromBytes(bytes, BITS)
    const events: PresentimentEvent[] = []
    let i = 0
    for (let at = spacing.value; at + postWindow.value <= sums.length; at += spacing.value) {
      const stimulus: Stimulus = i % 2 === 0 ? 'target' : 'control'
      // A synthetic pre-stimulus effect, injected only before target stimuli.
      if (stimulus === 'target' && epsilon.value > 0) {
        sums = injectShift(sums, BITS, epsilon.value, at - preWindow.value, at)
      }
      const stamp = T0 + (at - 1) * 1000
      events.push({
        at,
        stimulus,
        ...(provenance.value === 'valid'
          ? { labelDrawnAt: stamp + 500 }
          : provenance.value === 'early'
            ? { labelDrawnAt: stamp - 500 }
            : {}),
      })
      i++
    }
    return {
      series: makeSeries('presentiment-rng', sums, { bitsPerTrial: BITS, t0: T0 }),
      events,
    }
  })
}

const epochs = computed<{ ok?: PresentimentEpochs; error?: unknown }>(() => {
  const r = recording.value
  if (!r) return {}
  try {
    return {
      ok: presentimentEpochs(r.series, r.events, {
        preWindow: preWindow.value,
        postWindow: postWindow.value,
        allowOverlap: allowOverlap.value,
      }),
    }
  } catch (error) {
    return { error }
  }
})

const analysis = computed<{ ok?: PresentimentAnalysis; error?: unknown }>(() => {
  const list = epochs.value.ok?.epochs
  if (!list || list.length === 0) return {}
  try {
    return {
      ok: analyzePresentiment(list, { surrogates: surrogates.value, seed: seed.value }),
    }
  } catch (error) {
    return { error }
  }
})

/** Pre-window Stouffer z per epoch, target epochs highlighted. */
const bars = computed(() => {
  const list = epochs.value.ok?.epochs ?? []
  if (!list.length) return undefined
  const values = list.map((epoch) => {
    const zs = zScores(epoch.pre.sums, epoch.pre.bitsPerTrial)
    let sum = 0
    for (const z of zs) sum += z
    return sum / Math.sqrt(zs.length)
  })
  return {
    categories: list.map((_, i) => String(i + 1)),
    values,
    highlight: list.flatMap((epoch, i) => (epoch.stimulus === 'target' ? [i] : [])),
  }
})

const snippet = computed(
  () => `import { analyzePresentiment, presentimentEpochs } from '@mindpeeker/psi'

const { epochs, droppedProvenance, overlapping, warnings } = presentimentEpochs(
  recording,
  events,                       // { at: trialIndex, stimulus, labelDrawnAt }
  { preWindow: ${preWindow.value}, postWindow: ${postWindow.value}${allowOverlap.value ? ', allowOverlap: true' : ''} },
)
const result = analyzePresentiment(epochs, { surrogates: ${surrogates.value}, seed: ${seed.value} })
console.log(result.pre.deltaZ, result.post.deltaZ, result.permutationP, result.shuffle.resolution)`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="presentiment"
      title="1 · Presentiment, RNG analogue"
      description="The literature measures physiology before randomly chosen calm or emotional pictures. This is not that: it is an SDK-defined analogue on a random source — whether pre-stimulus trial sums deviate more before target than before control stimuli."
      :api="['presentimentEpochs', 'analyzePresentiment', 'PresentimentEpochs.droppedProvenance']"
    >
      <template #controls>
        <RunControls
          :busy="task.busy.value"
          :label="`Record ${trials} trials`"
          busy-label="Recording…"
          :hint="`${trials} trials at 1 Hz, a stimulus every ${spacing} trials. Trials, spacing, provenance and ε apply when the session is recorded; the windows, the surrogates and the seed are recomputed live.`"
          :cancellable="false"
          @run="go"
        />
        <UFormField label="Trials">
          <UInputNumber v-model="trials" :min="60" :max="4000" :step="20" class="w-32" />
        </UFormField>
        <UFormField label="Stimulus spacing" help="must be ≥ preWindow + postWindow">
          <UInputNumber v-model="spacing" :min="2" :max="120" class="w-28" />
        </UFormField>
        <UFormField label="Pre-window">
          <UInputNumber v-model="preWindow" :min="1" :max="60" class="w-24" />
        </UFormField>
        <UFormField label="Post-window">
          <UInputNumber v-model="postWindow" :min="1" :max="60" class="w-24" />
        </UFormField>
        <UFormField label="Label provenance" class="min-w-72">
          <USelect v-model="provenance" :items="PROVENANCE" class="w-full" />
        </UFormField>
        <UFormField label="Surrogates">
          <UInputNumber v-model="surrogates" :min="9" :max="999" :step="10" class="w-28" />
        </UFormField>
        <UFormField label="Seed">
          <UInputNumber v-model="seed" :min="0" class="w-36" />
        </UFormField>
        <UFormField label="Injected pre-target shift ε" help="synthetic — what an effect would look like">
          <UInputNumber v-model="epsilon" :min="0" :max="0.2" :step="0.01" class="w-32" />
        </UFormField>
        <UFormField label="Simulation bytes" class="min-w-56">
          <USelect v-model="simSource" :items="SIM_SOURCES" class="w-full" />
        </UFormField>
        <USwitch
          v-model="allowOverlap"
          label="allow overlapping epochs"
          description="keeps them, reports a warning — and the p-values stop being valid"
        />
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
      <ErrorAlert
        v-if="epochs.error"
        :err="epochs.error"
        :dismissible="false"
        title="presentimentEpochs refused this design"
      />
      <ErrorAlert
        v-if="analysis.error"
        :err="analysis.error"
        :dismissible="false"
        title="analyzePresentiment refused these epochs"
      />

      <div v-if="epochs.ok" class="flex flex-col gap-5">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="epochs kept"
            :value="epochs.ok.epochs.length"
            :digits="0"
            size="sm"
            :note="`${analysis.ok?.targetEpochs ?? 0} target · ${analysis.ok?.controlEpochs ?? 0} control`"
          />
          <StatTile
            label="dropped: provenance"
            :value="epochs.ok.droppedProvenance"
            :digits="0"
            size="sm"
            :tone="epochs.ok.droppedProvenance ? 'warning' : 'neutral'"
            note="label drawn before the pre-window closed, or at an unknown time"
          />
          <StatTile
            label="dropped: out of range"
            :value="epochs.ok.droppedOutOfRange"
            :digits="0"
            size="sm"
            note="windows that fall outside the recording — never truncated"
          />
          <StatTile
            label="overlapping"
            :value="epochs.ok.overlapping"
            :digits="0"
            size="sm"
            :tone="epochs.ok.overlapping ? 'error' : 'neutral'"
            note="shared trials collapse the null spread of Δz"
          />
        </div>

        <UAlert
          v-if="epochs.ok.warnings.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="The design carries caveats"
        >
          <template #description>
            <ul class="list-disc pl-4 space-y-0.5 text-sm">
              <li v-for="warning in epochs.ok.warnings" :key="warning">{{ warning }}</li>
            </ul>
          </template>
        </UAlert>

        <div v-if="analysis.ok" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="pre-window Δz"
            :value="analysis.ok.pre.deltaZ"
            :digits="3"
            :tone="Math.abs(analysis.ok.pre.deltaZ) > 2 ? 'warning' : 'neutral'"
            :note="`target ${analysis.ok.pre.targetTrials} vs control ${analysis.ok.pre.controlTrials} trials`"
          />
          <StatTile label="pre-window p" size="md">
            <template #value><PValue :p="analysis.ok.pre.pValue" kind="pointwise" /></template>
            <template #note>normal-theory p, valid only for disjoint epochs</template>
          </StatTile>
          <StatTile label="label-shuffle p" size="md">
            <template #value><PValue :p="analysis.ok.permutationP" kind="exact" /></template>
            <template #note>
              {{ analysis.ok.shuffle.method }} · m {{ analysis.ok.shuffle.surrogates }} · resolution
              {{ fmtNum(analysis.ok.shuffle.resolution, { digits: 4 }) }}
            </template>
          </StatTile>
          <StatTile
            label="post-window Δz (control)"
            :value="analysis.ok.post.deltaZ"
            :digits="3"
            note="a genuine stimulus response shows here, in ordinary time"
          />
        </div>

        <BarChart
          v-if="bars"
          :categories="bars.categories"
          :values="bars.values"
          :highlight="bars.highlight"
          :expected="0"
          expected-label="chance (z = 0)"
          x-label="epoch (highlighted = target)"
          y-label="pre-window Stouffer z"
          :height="240"
          aria-label="pre-window Stouffer z per epoch, target epochs highlighted"
        />

        <CodeSnippet :code="snippet" title="what this section ran" />
      </div>
      <p v-else-if="!task.busy.value && !epochs.error" class="text-sm text-muted">
        Record a session first. With ε = 0 there is nothing to find before the stimulus, because the
        stimulus label is drawn after the pre-window has already been written.
      </p>

      <HonestNote variant="contested">
        Presentiment studies (Radin 1996; Bierman &amp; Radin 1997; Mossbridge, Tressoldi &amp; Utts
        2012) measure skin conductance, heart rate, pupil and BOLD before a randomly chosen picture
        — not RNG output. This page implements an analogue, not a replication, and the conventional
        explanation the authors themselves raise — anticipation strategy when stimuli are drawn
        without replacement — applies to any design where the next label is partly predictable.
      </HonestNote>

      <template #footer>
        Consecutive stimuli must be at least preWindow + postWindow trials apart, or
        <code class="font-mono">presentimentEpochs</code> throws
        <code class="font-mono">invalid_plan</code>: overlapping epochs pool the same trials into
        both arms and collapse the null spread of Δz (sd ≈ 0.18 instead of 1 in the package's
        20-epoch test). Set the spacing below {{ preWindow + postWindow }} to see it refuse.
      </template>
    </DemoSection>

    <PsiMonitor />
  </div>
</template>
