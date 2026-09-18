<script setup lang="ts">
/**
 * Section 8 — the scan-aware permutation test, next to the test that ignores
 * the search. `lstPermutationTest` repeats the whole scan for every relabeling,
 * so the multiplicity of 240 looks is already paid for; testing the peak's own
 * window on the same data does not pay for anything, and the README measures
 * that difference as 90 % versus 4.5 % rejection on null data.
 */
import {
  type PermutationSummary,
  STRATUM_LABELS,
  STRATUM_NOTES,
  type StratumMode,
  type WindowSummary,
} from '~/lib/ephemeris/jobs'
import { useEphemerisLab, useLstSettings } from '~/lib/ephemeris/lab'
import { runEphemerisJob } from '~/lib/ephemeris/worker-client'
import { fmtDuration, fmtNum } from '~/lib/format'

interface Outcome {
  readonly serial: number
  readonly stratum: StratumMode
  readonly permutations: number
  readonly seed: number
  readonly honest: PermutationSummary
  readonly naive: WindowSummary
  readonly naiveCenter: number
}

const { data } = useEphemerisLab()
const { settings } = useLstSettings()
const task = useTask<Outcome>()

const stratum = ref<StratumMode>('lab')

const PERMUTATIONS = [199, 999, 9999, 49999].map((m) => ({
  label: `${m.toLocaleString('en-US')} relabelings — floor p = ${(1 / (m + 1)).toExponential(1)}`,
  value: m,
}))
const STRATA = (Object.keys(STRATUM_LABELS) as StratumMode[]).map((mode) => ({
  label: STRATUM_LABELS[mode],
  value: mode,
}))

const stamp = computed(() => {
  const pair = data.value
  if (!pair) return ''
  return `${pair.serial}:${stratum.value}:${settings.permutations}:${settings.seed}:${settings.windowHours}:${settings.stepHours}:${settings.minTrials}`
})
const measured = ref('')
const fresh = computed(() => task.result.value !== undefined && measured.value === stamp.value)
const outcome = computed(() => (fresh.value ? task.result.value : undefined))

/** ≈2.4 µs per relabeling per 1 000 trials, measured on this build. */
const estimateSeconds = computed(() => {
  const n = data.value?.params.trials ?? 0
  return (settings.permutations * n * 2.4e-6) / 1000
})

async function run(): Promise<void> {
  const pair = data.value
  if (!pair) return
  const at = stamp.value
  await task.run(async (signal, setProgress) => {
    setProgress(0)
    const trials = pair.exploration.columns
    const shape = {
      windowHours: settings.windowHours,
      stepHours: settings.stepHours,
      minTrials: settings.minTrials,
    }
    const honest = await runEphemerisJob(
      'permutation',
      {
        trials,
        stratum: stratum.value,
        ...shape,
        permutations: settings.permutations,
        seed: settings.seed,
      },
      signal,
      (f) => setProgress(f * 0.85),
    )
    // The same data, tested the wrong way: the peak's own window, no search cost.
    const naiveCenter = honest.peak.centroidHours
    const naive = await runEphemerisJob(
      'window',
      {
        trials,
        stratum: stratum.value,
        centerHours: naiveCenter,
        halfWidthHours: Math.max(0.25, Math.min(6, settings.windowHours / 2)),
        permutations: settings.permutations,
        seed: settings.seed,
      },
      signal,
      (f) => setProgress(0.85 + f * 0.15),
    )
    setProgress(1)
    measured.value = at
    return {
      serial: pair.serial,
      stratum: stratum.value,
      permutations: settings.permutations,
      seed: settings.seed,
      honest,
      naive,
      naiveCenter,
    }
  })
}

const plantedShift = computed(() => data.value?.params.shift ?? 0)

const snippet = computed(
  () => `import { lstPermutationTest } from '@mindpeeker/ephemeris'

const result = lstPermutationTest(trials, {
  windowHours: ${settings.windowHours}, stepHours: ${settings.stepHours}, minTrials: ${settings.minTrials},
  permutations: ${settings.permutations},
  seed: ${settings.seed},            // state it in the pre-registration
})

result.statistic   // max window mean of the observed data
result.exceedances // relabelings whose own max window mean was ≥ that
result.pValue      // (1 + exceedances) / (1 + permutations)
result.strata      // ${outcome.value?.honest.strata ?? '…'} — effects only move inside a stratum

// This page runs the relabelings in batches so it can show progress: batch b uses
// seed + b, an independent stream, and the exceedance counts add up.`,
)
</script>

<template>
  <DemoSection
    id="permutation"
    title="8 · The permutation test — paying for the search"
    description="Effects are relabelled against LST (seeded Fisher–Yates on xoshiro128**), the whole scan is repeated, and the observed peak is ranked against the peaks of the relabellings. Because every relabelling also searches all windows, P(p ≤ α) ≤ α holds under exchangeability for any number of relabellings."
    :api="['lstPermutationTest', 'LstPermutationResult', 'lstWindowTest']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!data"
        :label="`Run ${settings.permutations.toLocaleString('en-US')} relabelings`"
        busy-label="Relabelling…"
        icon="i-lucide-shuffle"
        :hint="`≈ ${fmtNum(estimateSeconds, { digits: 1 })} s in a Web Worker${estimateSeconds > 2 ? ' — long enough that Cancel matters' : ''}`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UFormField label="Relabellings m" size="sm">
          <USelect v-model="settings.permutations" :items="PERMUTATIONS" class="w-full" />
        </UFormField>
        <UFormField label="Stratification" size="sm">
          <USelect v-model="stratum" :items="STRATA" class="w-full" />
        </UFormField>
        <UFormField label="Seed" size="sm" description="part of the pre-registration">
          <UInput v-model.number="settings.seed" type="number" step="1" min="0" class="w-full" />
        </UFormField>
      </div>

      <UAlert color="neutral" variant="subtle" icon="i-lucide-layers" :title="STRATUM_LABELS[stratum]" :description="STRATUM_NOTES[stratum]" />

      <p v-if="!data" class="text-sm text-muted">Draw a pair of data sets in section 6 first.</p>

      <template v-else-if="outcome">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Scan-aware p" size="sm" :tone="outcome.honest.pValue <= 0.05 ? 'primary' : 'neutral'">
            <template #value><PValue :p="outcome.honest.pValue" kind="exact" /></template>
            <template #note>
              {{ outcome.honest.exceedances.toLocaleString('en-US') }} of
              {{ outcome.honest.permutations.toLocaleString('en-US') }} relabellings reached the peak
            </template>
          </StatTile>
          <StatTile label="Observed statistic" :value="outcome.honest.statistic" :digits="3" size="sm" :note="`peak at ${fmtNum(outcome.honest.peak.centerHours, { digits: 2 })} h, n = ${outcome.honest.peak.n}`" />
          <StatTile label="Gain" :value="outcome.honest.peak.gain" :digits="2" size="sm" :note="`overall mean ${fmtNum(outcome.honest.overallMean, { digits: 3 })} — relabelling cannot change it`" />
          <StatTile label="Strata" :value="outcome.honest.strata" :digits="0" size="sm" :note="outcome.honest.stratified ? 'effects exchanged only within a stratum' : 'unstratified — effects move anywhere'" />
          <StatTile label="Smallest reachable p" :value="1 / (outcome.permutations + 1)" :digits="5" size="sm" note="1/(m + 1) — the add-one estimator never reports 0" />
          <StatTile label="Run" :value="fmtDuration(outcome.honest.elapsedMs)" size="sm" :note="`${outcome.honest.batches} ${outcome.honest.batches === 1 ? 'batch' : 'batches'} in a Web Worker`" />
          <StatTile label="Seed" :value="String(outcome.seed)" size="sm" note="same seed, same data ⇒ same p" />
          <StatTile label="Trials" :value="outcome.honest.n" :digits="0" size="sm" note="exploration set" />
        </div>

        <div class="rounded-md border border-warning/40 bg-elevated/30 p-3">
          <h4 class="mb-1 text-sm font-semibold text-highlighted">
            The same data, tested the way that does not pay for the search
          </h4>
          <p class="mb-3 text-sm text-muted">
            <code class="font-mono text-xs text-primary">lstWindowTest</code> on the window this very
            scan picked out — centre {{ fmtNum(outcome.naiveCenter, { digits: 2 }) }} h ±
            {{ fmtNum(outcome.naive.halfWidthHours, { digits: 2 }) }} h. It is the correct test for a
            window fixed <em>before</em> the data, and the wrong one here, because the window was
            chosen by looking.
          </p>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Naive p (same data)" size="sm" tone="error">
              <template #value><PValue :p="outcome.naive.pValue" kind="pointwise" label="p" /></template>
              <template #note>{{ outcome.naive.exceedances.toLocaleString('en-US') }} of {{ outcome.naive.permutations.toLocaleString('en-US') }} relabellings</template>
            </StatTile>
            <StatTile label="Inside vs outside" :value="`${fmtNum(outcome.naive.inside.mean, { digits: 3 })} vs ${fmtNum(outcome.naive.outside.mean, { digits: 3 })}`" size="sm" :note="`n = ${outcome.naive.inside.n} inside`" />
            <StatTile label="Difference" :value="outcome.naive.difference" :digits="3" size="sm" note="the statistic lstWindowTest ranks" />
            <StatTile
              label="Ratio of the two p's"
              :value="outcome.naive.pValue > 0 ? outcome.honest.pValue / outcome.naive.pValue : null"
              :digits="1"
              size="sm"
              tone="warning"
              note="how much the peak search actually costs on this data set"
            />
          </div>
        </div>

        <HonestNote variant="caveat" title="Which of those two numbers is a p-value">
          <p>
            Only the first. The README measures the difference on 1 000 null data sets of 300
            trials: a permutation test of the ±1 h window around each set's own peak rejected at
            p ≤ 0.05 in <strong class="text-highlighted">90.1 %</strong> of them, while
            <code class="font-mono">lstPermutationTest</code> rejected in
            <strong class="text-highlighted">4.5 %</strong>. Set the planted shift to 0 in section 6
            and run this a few times with different seeds: the red number will look impressive
            again and again on data with no effect in it at all.
          </p>
          <p class="mt-2">
            Spottiswoode's own Monte Carlo did recompute every window per shuffle, which is the
            honest version; he reported 14 of 10 000, and the add-one estimator turns that count
            into 15/10 001 ≈ 0.0015.
          </p>
        </HonestNote>

        <HonestNote v-if="plantedShift > 0" variant="caveat" title="This data set has an effect in it by construction">
          The shift is {{ fmtNum(plantedShift, { digits: 2 }) }} SD inside
          {{ fmtNum(data.params.centerHours, { digits: 2 }) }} h ±
          {{ fmtNum(data.params.halfWidthHours, { digits: 2 }) }} h, put there by this page. A small
          p here demonstrates power, nothing else. The interesting run is the one with the shift at
          0.
        </HonestNote>

        <CodeSnippet :code="snippet" title="what this section ran" />
      </template>

      <UAlert
        v-else-if="task.result.value"
        color="neutral"
        variant="subtle"
        icon="i-lucide-refresh-cw"
        title="That result belongs to an earlier data set or a different setting"
        description="Run it again for what is on the page now."
      />
    </div>

    <template #footer>
      Relabelling never changes the overall mean, so ranking the largest window mean and ranking the
      largest gain are the same test. To look for a trough instead of a peak, negate every effect.
    </template>
  </DemoSection>
</template>
