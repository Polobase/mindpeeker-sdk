<script setup lang="ts">
/**
 * Section 9 — the confirmatory test. One window, fixed before the data it is
 * tested on, inside mean against outside mean, one-sided permutation p. No
 * search, so no multiplicity — provided the window really was registered first.
 */
import { STRATUM_LABELS, type StratumMode, type WindowSummary } from '~/lib/ephemeris/jobs'
import { useEphemerisLab, useLstSettings } from '~/lib/ephemeris/lab'
import { runEphemerisJob } from '~/lib/ephemeris/worker-client'
import { fmtDuration, fmtNum } from '~/lib/format'

interface Outcome {
  readonly serial: number
  readonly which: 'exploration' | 'confirmation'
  readonly stratum: StratumMode
  readonly result: WindowSummary
}

const { data } = useEphemerisLab()
const { settings, registered } = useLstSettings()
const task = useTask<Outcome>()

const which = ref<'exploration' | 'confirmation'>('confirmation')
const stratum = ref<StratumMode>('lab')

const STRATA = (Object.keys(STRATUM_LABELS) as StratumMode[]).map((mode) => ({
  label: STRATUM_LABELS[mode],
  value: mode,
}))
const PERMUTATIONS = [199, 999, 9999, 49999].map((m) => ({
  label: `${m.toLocaleString('en-US')} relabellings`,
  value: m,
}))

const stamp = computed(() => {
  const pair = data.value
  if (!pair) return ''
  return `${pair.serial}:${which.value}:${stratum.value}:${registered.centerHours}:${registered.halfWidthHours}:${settings.permutations}:${settings.seed}`
})
const measured = ref('')
const fresh = computed(() => task.result.value !== undefined && measured.value === stamp.value)
const outcome = computed(() => (fresh.value ? task.result.value : undefined))

/** The registered window is only pre-registered for data it was not read from. */
const reusedData = computed(
  () => which.value === 'exploration' && registered.origin.includes('exploration'),
)

async function run(): Promise<void> {
  const pair = data.value
  if (!pair) return
  const at = stamp.value
  await task.run(async (signal, setProgress) => {
    setProgress(null)
    const result = await runEphemerisJob(
      'window',
      {
        trials: which.value === 'exploration' ? pair.exploration.columns : pair.confirmation.columns,
        stratum: stratum.value,
        centerHours: registered.centerHours,
        halfWidthHours: registered.halfWidthHours,
        permutations: settings.permutations,
        seed: settings.seed,
      },
      signal,
    )
    measured.value = at
    return { serial: pair.serial, which: which.value, stratum: stratum.value, result }
  })
}

const bars = computed(() => {
  const r = outcome.value?.result
  if (!r) return undefined
  return {
    categories: [
      `inside ${fmtNum(r.centerHours, { digits: 2 })} h ± ${fmtNum(r.halfWidthHours, { digits: 2 })} h (n = ${r.inside.n})`,
      `outside (n = ${r.outside.n})`,
    ],
    values: [r.inside.mean, r.outside.mean],
    overall: r.overallMean,
  }
})

const snippet = computed(
  () => `import { lstWindowTest } from '@mindpeeker/ephemeris'

// Fixed BEFORE this data existed — a window read off a scan of the same data is not
// pre-registered, whatever it is called afterwards.
const test = lstWindowTest(trials, {
  centerHours: ${registered.centerHours},
  halfWidthHours: ${registered.halfWidthHours},
  permutations: ${settings.permutations},
  seed: ${settings.seed},
})

test.inside      // { n, mean } inside [c − h, c + h) on the circle
test.outside     // { n, mean } — the complement
test.difference  // inside.mean − outside.mean, the statistic
test.pValue      // one-sided: (1 + #{relabelled difference ≥ observed}) / (1 + m)`,
)
</script>

<template>
  <DemoSection
    id="confirm"
    title="9 · The confirmatory test — one window, registered in advance"
    description="lstWindowTest compares the mean inside a single window with the mean outside it and ranks that difference against relabellings. There is no search, so there is no multiplicity to pay for — the whole validity of the number rests on the window having been chosen before the data."
    :api="['lstWindowTest', 'LstWindowTestResult', 'LstGroup']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!data"
        label="Test the registered window"
        busy-label="Testing…"
        icon="i-lucide-target"
        :hint="`${settings.permutations.toLocaleString('en-US')} relabellings on the ${which} set, in a Web Worker`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UFormField label="Registered centre (h)" size="sm">
          <UInput v-model.number="registered.centerHours" type="number" step="0.25" min="0" max="23.99" class="w-full" />
        </UFormField>
        <UFormField label="Registered half width (h)" size="sm" description="the window is [c − h, c + h)">
          <UInput v-model.number="registered.halfWidthHours" type="number" step="0.25" min="0.25" max="11.75" class="w-full" />
        </UFormField>
        <UFormField label="Tested on" size="sm">
          <USelect
            v-model="which"
            :items="[{ label: 'the confirmation set (fresh data)', value: 'confirmation' }, { label: 'the exploration set (the same data)', value: 'exploration' }]"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Stratification" size="sm">
          <USelect v-model="stratum" :items="STRATA" class="w-full" />
        </UFormField>
        <UFormField label="Relabellings m" size="sm">
          <USelect v-model="settings.permutations" :items="PERMUTATIONS" class="w-full" />
        </UFormField>
        <UFormField label="Seed" size="sm">
          <UInput v-model.number="settings.seed" type="number" step="1" min="0" class="w-full" />
        </UFormField>
      </div>

      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-bookmark"
        title="Where this window came from"
        :description="registered.origin"
      />

      <UAlert
        v-if="reusedData"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="This window was read off the very data set you are about to test"
        description="Then it is not pre-registered and the p below does not price the search that found it. It is here so you can watch it happen — switch back to the confirmation set for the honest version."
      />

      <p v-if="!data" class="text-sm text-muted">Draw a pair of data sets in section 6 first.</p>

      <template v-else-if="outcome && bars">
        <BarChart
          :categories="bars.categories"
          :values="bars.values"
          :expected="bars.overall"
          expected-label="overall mean"
          :color="2"
          y-label="mean effect size"
          :height="200"
          :format="(v) => v.toFixed(3)"
          aria-label="Mean effect inside and outside the registered window"
        />

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="One-sided p" size="sm" :tone="outcome.result.pValue <= 0.05 ? 'primary' : 'neutral'">
            <template #value><PValue :p="outcome.result.pValue" kind="exact" /></template>
            <template #note>
              {{ outcome.result.exceedances.toLocaleString('en-US') }} of
              {{ outcome.result.permutations.toLocaleString('en-US') }} relabellings reached the difference
            </template>
          </StatTile>
          <StatTile label="Inside mean" :value="outcome.result.inside.mean" :digits="3" size="sm" :note="`n = ${outcome.result.inside.n}`" tone="primary" />
          <StatTile label="Outside mean" :value="outcome.result.outside.mean" :digits="3" size="sm" :note="`n = ${outcome.result.outside.n}`" />
          <StatTile label="Difference" :value="outcome.result.difference" :digits="3" size="sm" note="inside − outside — the test statistic" />
          <StatTile label="Gain" :value="outcome.result.gain" :digits="2" size="sm" note="inside ÷ overall mean; null unless the overall mean is positive" />
          <StatTile label="Strata" :value="outcome.result.strata" :digits="0" size="sm" :note="outcome.result.stratified ? 'exchange within strata only' : 'unstratified'" />
          <StatTile label="Data set" :value="outcome.which" size="sm" :mono="false" :note="outcome.which === 'confirmation' ? 'never seen by the scan above' : 'the same data the window came from'" />
          <StatTile label="Run" :value="fmtDuration(outcome.result.elapsedMs)" size="sm" note="one call, no batching needed" />
        </div>

        <HonestNote variant="exact">
          The arithmetic is exact and the p is a valid one-sided permutation p under exchangeability
          within strata. What it cannot do is decide for you whether the window was really fixed in
          advance — that is a fact about your notes, not about the data. The package's advice is to
          write down the centre, the half width, the seed and the relabelling count before the data
          exist, which is what a registration is for.
        </HonestNote>

        <CodeSnippet :code="snippet" title="what this section ran" />
      </template>

      <UAlert
        v-else-if="task.result.value"
        color="neutral"
        variant="subtle"
        icon="i-lucide-refresh-cw"
        title="That result belongs to an earlier window or data set"
        description="Run it again for what is on the page now."
      />
    </div>

    <template #footer>
      Spottiswoode's own validation set worked exactly this way: 1 015 fresh trials, the same
      13.47 h peak, a gain of 4.51 within ±1 h (n = 43, one-tailed p = 0.05). The default window
      above is that centre — typed in from the paper, not read off anything on this page.
    </template>
  </DemoSection>
</template>
