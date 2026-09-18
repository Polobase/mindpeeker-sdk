<script setup lang="ts">
/**
 * Section 10 — the confound, run four ways. The observed peak never changes;
 * only the null does. Restricting relabelling to a stratum asks whether LST
 * explains anything beyond study identity, time of day, or time of day and
 * season together.
 */
import {
  type ConfoundRow,
  STRATUM_LABELS,
  STRATUM_NOTES,
  type StratumMode,
} from '~/lib/ephemeris/jobs'
import { useEphemerisLab, useLstSettings } from '~/lib/ephemeris/lab'
import { runEphemerisJob } from '~/lib/ephemeris/worker-client'
import { fmtDuration, fmtNum } from '~/lib/format'

const MODES: readonly StratumMode[] = ['none', 'lab', 'clock', 'clock-season']

const { data } = useEphemerisLab()
const { settings } = useLstSettings()
const task = useTask<{ serial: number; permutations: number; rows: readonly ConfoundRow[] }>()

const stamp = computed(() => {
  const pair = data.value
  if (!pair) return ''
  return `${pair.serial}:${settings.permutations}:${settings.seed}:${settings.windowHours}:${settings.stepHours}`
})
const measured = ref('')
const fresh = computed(() => task.result.value !== undefined && measured.value === stamp.value)
const outcome = computed(() => (fresh.value ? task.result.value : undefined))

const estimateSeconds = computed(() => {
  const n = data.value?.params.trials ?? 0
  return (MODES.length * settings.permutations * n * 2.4e-6) / 1000
})

async function run(): Promise<void> {
  const pair = data.value
  if (!pair) return
  const at = stamp.value
  await task.run(async (signal, setProgress) => {
    setProgress(0)
    const rows = await runEphemerisJob(
      'confound',
      {
        trials: pair.exploration.columns,
        modes: MODES,
        windowHours: settings.windowHours,
        stepHours: settings.stepHours,
        minTrials: settings.minTrials,
        permutations: settings.permutations,
        seed: settings.seed,
      },
      signal,
      setProgress,
    )
    measured.value = at
    return { serial: pair.serial, permutations: settings.permutations, rows }
  })
}

/** Spottiswoode 1997/1998 as published — typed in, not computed here. */
const CLAIM = [
  { quantity: 'First data set', value: '1,468 free-response trials, 21 studies' },
  { quantity: 'Overall effect size', value: '0.148 (Stouffer Z = 5.99)' },
  { quantity: 'Within ±1 h of 13.47 h LST', value: '0.507 (n = 83) — a gain of 3.42' },
  { quantity: 'Validation set', value: '1,015 trials, overall 0.085, same peak, gain 4.51 (n = 43, one-tailed p = 0.05)' },
  { quantity: 'Permutation result, all 2,483 trials', value: '14 of 10,000 shuffles reached the window mean — add-one: 15/10,001 ≈ 0.0015' },
  { quantity: '1998 follow-up, 2,879 trials', value: 'ap correlation ρ = −0.192 inside 11.2–14.8 h (N = 256) against −0.010 outside (N = 2,623)' },
  { quantity: 'Ryan & Spottiswoode 2015', value: 'sidereal structure again in fresh data, but the peak moved from 13:30 to 08:30 LST; no significant overall geomagnetic correlation across ~6,000 trials' },
]

const snippet = computed(
  () => `import { localMeanSolarTime, lstPermutationTest } from '@mindpeeker/ephemeris'

// A stratum restricts relabelling. Give it on every trial or on none.
const byClockAndSeason = trials.map((t) => ({
  ...t,
  stratum: \`h\${Math.floor(localMeanSolarTime(jd, lon))}/s\${Math.floor(dayOfYear / 91.5)}\`,
}))

for (const set of [trials, byStudy, byClock, byClockAndSeason]) {
  lstPermutationTest(set, { permutations: ${settings.permutations}, seed: ${settings.seed} }).pValue
}`,
)
</script>

<template>
  <DemoSection
    id="confound"
    title="10 · The confound — the same peak against four different nulls"
    description="The observed statistic is identical in all four rows; only what the relabelling is allowed to move changes. That is the whole point: a stratum encodes what you are willing to treat as exchangeable, and LST being a linear function of solar time and day of the year means the last row is the one that actually asks whether sidereal time adds anything."
    :api="['lstPermutationTest', 'localMeanSolarTime', 'LstTrial']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!data"
        :label="`Run all four nulls (${settings.permutations.toLocaleString('en-US')} × 4)`"
        busy-label="Relabelling…"
        icon="i-lucide-layers"
        :hint="`≈ ${fmtNum(estimateSeconds, { digits: 1 })} s in a Web Worker`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="flex flex-col gap-4">
      <p v-if="!data" class="text-sm text-muted">Draw a pair of data sets in section 6 first.</p>

      <template v-else-if="outcome">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[46rem] text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wide text-muted">
                <th class="py-1 pr-3 font-medium">null</th>
                <th class="py-1 pr-3 font-medium">strata</th>
                <th class="py-1 pr-3 font-medium">peak</th>
                <th class="py-1 pr-3 font-medium">statistic</th>
                <th class="py-1 pr-3 font-medium">exceedances</th>
                <th class="py-1 pr-3 font-medium">p</th>
                <th class="py-1 font-medium">time</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in outcome.rows" :key="row.mode" class="border-t border-default/70 align-top">
                <td class="py-2 pr-3 text-highlighted">{{ STRATUM_LABELS[row.mode] }}</td>
                <td class="py-2 pr-3 font-mono tabular-nums text-muted">{{ row.summary.strata }}</td>
                <td class="py-2 pr-3 font-mono tabular-nums text-muted">{{ fmtNum(row.summary.peak.centerHours, { digits: 2 }) }} h</td>
                <td class="py-2 pr-3 font-mono tabular-nums text-highlighted">{{ fmtNum(row.summary.statistic, { digits: 3 }) }}</td>
                <td class="py-2 pr-3 font-mono tabular-nums text-muted">
                  {{ row.summary.exceedances.toLocaleString('en-US') }} / {{ row.summary.permutations.toLocaleString('en-US') }}
                </td>
                <td class="py-2 pr-3"><PValue :p="row.summary.pValue" kind="exact" :show-kind="false" /></td>
                <td class="py-2 font-mono tabular-nums text-dimmed">{{ fmtDuration(row.summary.elapsedMs) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <UAlert
            v-for="row in outcome.rows"
            :key="`note-${row.mode}`"
            color="neutral"
            variant="subtle"
            :title="STRATUM_LABELS[row.mode]"
            :description="STRATUM_NOTES[row.mode]"
          />
        </div>

        <HonestNote variant="caveat" title="Why the p usually grows as the strata get finer">
          Finer strata leave less LST variation inside each cell, so there is less for the test to
          use and power falls. That loss is the price of the confound, not a defect of the test: if
          a sidereal effect only survives when the null is allowed to move effects between different
          studies, different times of day and different seasons, then “sidereal” is not what has
          been shown. The package's own test suite reports an unstratified null rejecting in more
          than 90 % of simulated study mixes with no LST effect at all, while the stratified null
          stays near 5 %.
        </HonestNote>
      </template>

      <UAlert
        v-else-if="task.result.value"
        color="neutral"
        variant="subtle"
        icon="i-lucide-refresh-cw"
        title="That comparison belongs to an earlier data set"
        description="Run it again for what is on the page now."
      />

      <!-- The published claim, as published -->
      <div class="rounded-md border border-default bg-elevated/30 p-3">
        <h4 class="mb-2 text-sm font-semibold text-highlighted">
          What Spottiswoode actually reported — the numbers, as published
        </h4>
        <dl class="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[14rem_1fr]">
          <template v-for="item in CLAIM" :key="item.quantity">
            <dt class="text-muted">{{ item.quantity }}</dt>
            <dd class="text-highlighted">{{ item.value }}</dd>
          </template>
        </dl>
        <p class="mt-2 text-xs text-dimmed">
          Sources: S. J. P. Spottiswoode, J. Scientific Exploration 11(2), 1997, reprinted with the
          1998 geomagnetic follow-up in McMoneagle, <em>Remote Viewing Secrets</em> (2000),
          App. B pp. 228–238 and App. C pp. 247–248; Ryan, JSE 22(3), 2008, p. 337; Ryan &amp;
          Spottiswoode (2015), summarised in the SPR Psi Encyclopedia.
        </p>
      </div>

      <HonestNote variant="contested">
        <p>
          That psi performance depends on local sidereal time is a
          <strong class="text-highlighted">contested hypothesis</strong>, and this package exists to
          test it, not to endorse it. Four specific objections stand:
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong class="text-highlighted">The seasonal confound.</strong> Spottiswoode removed
            the means of one-hour clock-time bins and found the LST plot “virtually
            indistinguishable” (App. B, p. 236) — but that check does not cover the season, and he
            named the gap himself (p. 238). Sturrock &amp; Spottiswoode (2007) found a seasonal
            variation in the same database.
          </li>
          <li>
            <strong class="text-highlighted">Data quality.</strong> Trial times were probably session
            starts, off by up to a quarter of an hour; latitudes covered only 32–55° N; the PEAR
            remote-viewing data were included despite methodological criticism; the studies differ
            in effect size and in when they ran.
          </li>
          <li>
            <strong class="text-highlighted">Retrospection.</strong> The 13.47 h peak was found by
            scanning the first data set. Section 8 above shows what that costs when it is not
            priced.
          </li>
          <li>
            <strong class="text-highlighted">Replication.</strong> In fresh data Ryan &amp;
            Spottiswoode (2015) saw sidereal structure again, but the peak had moved to 08:30 LST,
            and the overall geomagnetic correlation across about 6 000 trials was not significant.
          </li>
        </ul>
        <p class="mt-2">
          Nothing on this page is evidence either way: the data above were manufactured by this
          browser. What the page can show is which nulls survive contact with the confound.
        </p>
      </HonestNote>

      <CodeSnippet :code="snippet" title="what the four rows ran" />
    </div>

    <template #footer>
      The package ships no geomagnetic data. A caller joining trials to published ap indices should
      use the same stratified permutation logic — and remember that Spottiswoode himself doubted a
      direct geomagnetic mechanism, since 50–200 nT disturbances are small next to the field changes
      a person meets walking through a building (App. C, p. 252).
    </template>
  </DemoSection>
</template>
