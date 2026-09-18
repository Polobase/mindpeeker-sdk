<script setup lang="ts">
/**
 * A card-guess series drawn from the header-selected entropy source, scored
 * with `fisherSeries`.
 *
 * BOTH cards are drawn at random here, so this is a calibration of the scheme,
 * not a test of anyone: the mean standardized score should sit inside ±2·10/√n
 * roughly 95 % of the time. A DRBG control arm runs the same n trials from a
 * labelled seed, so the run is reproducible.
 */
import type { FisherObservation, FisherSeriesResult } from '@mindpeeker/coincidence'
import { fisherMatchScore, fisherSeries, PLAYING_CARD_SCHEME } from '@mindpeeker/coincidence'
import { createYielder } from '~/lib/async'
import {
  cardLabel,
  CELL_LABELS,
  CELL_PROBABILITIES,
  cellIndex,
  type CardTrial,
  drawTrial,
} from '~/lib/coincidence/cards'
import { drbgSource, sourceSummary, withReader } from '~/lib/entropy'
import { fmtNum } from '~/lib/format'

const CONTROL_LABEL = 'coincidence / fisher control'

const trials = ref(60)
const withControl = ref(true)

const summary = sourceSummary()

interface Arm {
  readonly name: string
  readonly series: FisherSeriesResult
  readonly counts: number[]
  readonly last: { called: string; drawn: string; grades: string; score: number }[]
  readonly bytesConsumed: number
  readonly bytesFetched?: number
}

interface RunResult {
  readonly main: Arm
  readonly control?: Arm
}

const task = useTask<RunResult>()
const result = computed(() => task.result.value)

async function runArm(
  name: string,
  n: number,
  source: ReturnType<typeof drbgSource> | undefined,
  signal: AbortSignal,
  onTick: () => void,
): Promise<Arm> {
  const observations: FisherObservation[] = []
  const counts = new Array<number>(CELL_LABELS.length).fill(0)
  const recent: CardTrial[] = []
  let bytesConsumed = 0
  let bytesFetched: number | undefined
  await withReader(
    async (reader) => {
      const tick = createYielder(8, signal)
      for (let i = 0; i < n; i++) {
        const trial = await drawTrial(reader)
        observations.push(trial.grades)
        const index = cellIndex(String(trial.grades[0]), String(trial.grades[1]))
        if (index >= 0) counts[index] = (counts[index] as number) + 1
        recent.push(trial)
        if (recent.length > 12) recent.shift()
        onTick()
        await tick()
      }
      bytesConsumed = reader.bytesConsumed
      bytesFetched = reader.bytesFetched
    },
    { signal, ...(source ? { source } : {}) },
  )
  return {
    name,
    series: fisherSeries(PLAYING_CARD_SCHEME, observations),
    counts,
    last: recent.map((trial) => ({
      called: cardLabel(trial.called),
      drawn: cardLabel(trial.drawn),
      grades: `${trial.grades[0]}${trial.grades[1]}`,
      score: fisherMatchScore(PLAYING_CARD_SCHEME, trial.grades).score,
    })),
    bytesConsumed,
    ...(bytesFetched === undefined ? {} : { bytesFetched }),
  }
}

function run(n = Math.max(1, Math.trunc(Number(trials.value) || 1))): void {
  trials.value = n
  const control = withControl.value
  void task.run(async (signal, setProgress) => {
    const total = control ? 2 * n : n
    let done = 0
    const bump = () => setProgress(++done / total)
    setProgress(0)
    const main = await runArm(summary.providerName, n, undefined, signal, bump)
    if (!control) return { main }
    return { main, control: await runArm(`DRBG control — ${CONTROL_LABEL}`, n, drbgSource(CONTROL_LABEL), signal, bump) }
  })
}

const arms = computed<Arm[]>(() => {
  const value = result.value
  if (!value) return []
  return value.control ? [value.main, value.control] : [value.main]
})

const observedShare = computed(() => {
  const main = result.value?.main
  if (!main || main.series.n === 0) return []
  return main.counts.map((count) => count / main.series.n)
})

const code = computed(
  () => `import { byteReader, uniformInt } from '@mindpeeker/oracle'
import {
  PLAYING_CARD_SCHEME, playingCardGrades, fisherSeries,
} from '@mindpeeker/coincidence'

const reader = byteReader(source)                  // the header's entropy source
const observations = []
for (let i = 0; i < ${trials.value}; i++) {
  const called = card(await uniformInt(reader, 52))
  const drawn  = card(await uniformInt(reader, 52))
  observations.push(playingCardGrades(called, drawn))
}
await reader.close()

fisherSeries(PLAYING_CARD_SCHEME, observations)
// { n: ${result.value?.main.series.n ?? '…'}, meanScore: ${result.value ? fmtNum(result.value.main.series.meanScore, { digits: 4 }) : '…'},
//   standardError: ${result.value ? fmtNum(result.value.main.series.standardError, { digits: 4 }) : '…'}, z: ${result.value ? fmtNum(result.value.main.series.z, { digits: 4 }) : '…'},
//   exceedsTwoStandardErrors: ${result.value?.main.series.exceedsTwoStandardErrors ?? '…'} }`,
)
</script>

<template>
  <DemoSection
    id="fisher-series"
    title="A drawn series — calibrating Fisher's criterion"
    :level="3"
    :api="['fisherSeries', 'fisherMatchScore', 'playingCardGrades', 'byteReader', 'uniformInt']"
    description="n trials, each a called card and a drawn card, both uniform over 52 from the selected source. Fisher judged a series unremarkable unless its mean score exceeds twice its standard error of 10/√n — and with both cards random, that is exactly what should almost never happen."
  >
    <template #controls>
      <UFormField label="Trials" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="trials" :min="1" :max="2000" :step="10" class="w-full" />
      </UFormField>
      <UFormField label="DRBG control arm" size="sm">
        <USwitch v-model="withControl" :label="withControl ? 'on' : 'off'" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Draw ${trials} trials`"
        busy-label="Drawing…"
        icon="i-lucide-spade"
        :hint="`≈${fmtNum(trials * 2 * (withControl ? 2 : 1), { digits: 0 })} bytes from ${summary.providerName}`"
        @run="run()"
        @cancel="task.cancel()"
      >
        <UButton size="sm" variant="soft" color="neutral" @click="run(500)">Run 500</UButton>
      </RunControls>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" title="The draw failed" @dismiss="task.reset()" />

      <p v-if="!arms.length && !task.busy.value" class="text-sm text-muted">
        Nothing drawn yet. With 60 trials the mean score should land within about ±2.6 of zero
        (2 × 10/√60 = 2.58) roughly nineteen times in twenty; a run outside that is what one run in
        twenty looks like, not a finding.
      </p>

      <div v-for="arm in arms" :key="arm.name" class="rounded-md border border-default bg-elevated/30 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-sm font-semibold text-highlighted">{{ arm.name }}</h3>
          <AccountingBadge
            :bytes-consumed="arm.bytesConsumed"
            :bytes-fetched="arm.bytesFetched"
            :source="arm.name"
          />
        </div>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Trials" :value="arm.series.n" :digits="0" size="sm" />
          <StatTile
            label="Mean standardized score"
            :value="arm.series.meanScore"
            :digits="3"
            size="sm"
            tone="primary"
            :note="`total ${fmtNum(arm.series.total, { digits: 2 })}`"
          />
          <StatTile
            label="Standard error"
            :value="arm.series.standardError"
            :digits="3"
            size="sm"
            note="10/√n — the null SD of the mean"
          />
          <StatTile
            label="z = mean / SE"
            :value="arm.series.z"
            :digits="3"
            size="sm"
            :tone="arm.series.exceedsTwoStandardErrors ? 'warning' : 'neutral'"
            note="reported, but no p-value is claimed"
          />
        </div>
        <p class="mt-2 text-sm">
          <UBadge :color="arm.series.exceedsTwoStandardErrors ? 'warning' : 'success'" variant="subtle" size="sm">
            {{ arm.series.exceedsTwoStandardErrors ? 'exceeds two standard errors' : 'inside two standard errors' }}
          </UBadge>
          <span class="ml-2 text-muted">
            Fisher's 1924 criterion. Both cards were random here, so “exceeds” means this run is one
            of the roughly 2.5 % that do — not that anything happened.
          </span>
        </p>
      </div>

      <BarChart
        v-if="observedShare.length"
        :categories="CELL_LABELS"
        :values="observedShare"
        :expected="CELL_PROBABILITIES"
        expected-label="exact null probability"
        x-label="grade cell (suit, value)"
        y-label="observed share"
        :height="240"
        :format="(v) => fmtNum(v, { digits: 4 })"
        aria-label="Observed share of each grade cell against its exact null probability"
      />

      <div v-if="arms[0]?.last.length" class="overflow-x-auto">
        <h3 class="text-sm font-semibold text-highlighted">The last {{ arms[0].last.length }} trials</h3>
        <table class="mt-2 w-full text-sm">
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-left py-1.5 pr-3 font-medium">Called</th>
              <th class="text-left py-1.5 px-3 font-medium">Drawn</th>
              <th class="text-left py-1.5 px-3 font-medium">Grades</th>
              <th class="text-right py-1.5 pl-3 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in arms[0].last" :key="index" class="border-t border-default">
              <td class="py-1 pr-3 font-mono">{{ row.called }}</td>
              <td class="py-1 px-3 font-mono">{{ row.drawn }}</td>
              <td class="py-1 px-3 font-mono">{{ row.grades }}</td>
              <td
                class="py-1 pl-3 text-right font-mono tabular-nums"
                :class="row.score > 0 ? 'text-warning' : 'text-muted'"
              >
                {{ row.score > 0 ? '+' : '' }}{{ fmtNum(row.score, { digits: 2 }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <CodeSnippet :code="code" title="what this button ran" />

      <HonestNote variant="contested" title="What a card series can and cannot show">
        Fisher built this scheme for psychical-research card tests, and it is still the right way to
        give partial agreement its exact price. It does not make a guessing experiment evidential:
        that needs a randomisation the analysis actually matches (a closed deck changes the null; a
        guesser's calls are not uniform; optional stopping invalidates the standard error). This run
        draws both cards from an RNG precisely so nothing is claimed — it is the null, checked
        against itself. See <code class="font-mono">@mindpeeker/judging</code> for the designs where
        the scoring and the null are worked out together.
      </HonestNote>
    </div>

    <template #footer>
      Every byte comes from the source picked in the header
      (<span class="font-mono">{{ summary.providerName }}</span>), and the control arm from an
      HMAC-DRBG seeded with “{{ CONTROL_LABEL }}” — the same label always gives the same series.
    </template>
  </DemoSection>
</template>
