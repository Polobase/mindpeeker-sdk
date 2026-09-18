<script setup lang="ts">
/**
 * Rhine's run conventions: 25 calls at ⅕ (SD 2 per run), 24 die throws at ⅙
 * (SD 1.8257), a series scored as SD_run·√R, and the critical ratio of the
 * difference between two conditions.
 */
import type { RunConvention, RunsDifference, RunsScore } from '@mindpeeker/judging'
import { ESP_RUN, PK_RUN, runsDifference, runsScore } from '@mindpeeker/judging'
import { fmtNum, fmtP } from '~/lib/format'

const CONVENTIONS: readonly { id: string; label: string; convention: RunConvention }[] = [
  { id: 'esp', label: 'ESP_RUN — 25 Zener calls at ⅕ (MCE 5, SD 2)', convention: ESP_RUN },
  { id: 'pk', label: 'PK_RUN — 24 die throws at ⅙ (MCE 4, SD 1.8257)', convention: PK_RUN },
]

const conventionId = ref('esp')
const runs = ref(100)
const hits = ref(560)
const groupAHits = ref(330)
const groupARuns = ref(50)
const groupBHits = ref(250)
const groupBRuns = ref(50)

const conventionItems = CONVENTIONS.map((c) => ({ label: c.label, value: c.id }))
const convention = computed<RunConvention>(
  () => CONVENTIONS.find((c) => c.id === conventionId.value)?.convention ?? ESP_RUN,
)

const safeRuns = computed(() => Math.max(1, Math.trunc(Number(runs.value) || 1)))
const safeHits = computed(() => Math.max(0, Math.trunc(Number(hits.value) || 0)))

const series = computed<{ score?: RunsScore; error?: unknown }>(() => {
  try {
    return { score: runsScore(safeHits.value, safeRuns.value, convention.value) }
  } catch (error) {
    return { error }
  }
})

const difference = computed<{ result?: RunsDifference; error?: unknown }>(() => {
  try {
    return {
      result: runsDifference(
        {
          hits: Math.max(0, Math.trunc(Number(groupAHits.value) || 0)),
          runs: Math.max(1, Math.trunc(Number(groupARuns.value) || 1)),
        },
        {
          hits: Math.max(0, Math.trunc(Number(groupBHits.value) || 0)),
          runs: Math.max(1, Math.trunc(Number(groupBRuns.value) || 1)),
        },
        convention.value,
      ),
    }
  } catch (error) {
    return { error }
  }
})

/** Holding the per-run rate fixed, how does the critical ratio grow with R? */
const growth = computed(() => {
  const score = series.value.score
  if (!score) return undefined
  const perRun = score.meanPerRun
  const x: number[] = []
  const y: number[] = []
  for (let r = 1; r <= Math.max(20, safeRuns.value * 2); r++) {
    const total = Math.round(perRun * r)
    try {
      y.push(runsScore(total, r, convention.value).criticalRatio)
      x.push(r)
    } catch {
      // a rounded total can exceed r × trialsPerRun at the extremes
    }
  }
  return { x, y, perRun }
})

const code = computed(() => {
  const score = series.value.score
  const diff = difference.value.result
  if (!score || !diff) return ''
  return `import { ESP_RUN, PK_RUN, runsScore, runsDifference } from '@mindpeeker/judging'

const series = runsScore(${score.hits}, ${score.runs}, ${conventionId.value === 'esp' ? 'ESP_RUN' : 'PK_RUN'})
series.meanPerRun     // ${fmtNum(score.meanPerRun, { digits: 4 })} hits per run (chance ${fmtNum(score.mcePerRun, { digits: 2 })})
series.sdPerRun       // ${fmtNum(score.sdPerRun, { digits: 4 })}
series.sd             // ${fmtNum(score.sd, { digits: 4 })} = sdPerRun · √${score.runs}
series.criticalRatio  // ${fmtNum(score.criticalRatio, { digits: 4 })}
series.pOneSided      // ${fmtP(score.pOneSided)} (exact, not the normal reading)

const d = runsDifference({ hits: ${groupAHits.value}, runs: ${groupARuns.value} }, { hits: ${groupBHits.value}, runs: ${groupBRuns.value} }, ${conventionId.value === 'esp' ? 'ESP_RUN' : 'PK_RUN'})
d.sdDifference        // ${fmtNum(diff.sdDifference, { digits: 4 })} = SD_run·√(1/R_A + 1/R_B)
d.criticalRatio       // ${fmtNum(diff.criticalRatio, { digits: 4 })}`
})
</script>

<template>
  <DemoSection
    id="runs"
    title="Rhine's runs: a series, and two conditions compared"
    :api="['ESP_RUN', 'PK_RUN', 'runsScore', 'runsDifference']"
    description="The classic bookkeeping: a run is 25 calls or 24 throws, a series is R runs, and the series SD is the run SD times √R. The difference of two conditions gets SD_run·√(1/R_A + 1/R_B)."
  >
    <template #controls>
      <UFormField label="Convention" size="sm" class="w-full sm:w-96">
        <USelect v-model="conventionId" :items="conventionItems" class="w-full" />
      </UFormField>
      <UFormField label="Runs" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="runs" :min="1" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Total hits" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="hits" :min="0" :step="1" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="series.error" title="The series was rejected" />

      <div v-if="series.score" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Hits per run"
          :value="series.score.meanPerRun"
          :digits="3"
          tone="primary"
          :note="`chance ${fmtNum(series.score.mcePerRun, { digits: 2 })} per run`"
        />
        <StatTile label="SD of one run" :value="series.score.sdPerRun" :digits="4" note="√(trialsPerRun · p₀ · q₀)" />
        <StatTile
          label="SD of the series"
          :value="series.score.sd"
          :digits="4"
          :note="`= sdPerRun · √${series.score.runs}`"
        />
        <StatTile label="Critical ratio" :value="series.score.criticalRatio" :digits="4" tone="info" />
      </div>

      <div v-if="series.score" class="flex flex-wrap items-center gap-4 text-sm">
        <PValue :p="series.score.pOneSided" kind="exact" label="P(X ≥ hits)" />
        <PValue :p="series.score.pTwoSided" kind="exact" label="two-sided" />
        <PValue :p="series.score.pCriticalRatio" kind="pointwise" label="CR normal reading" />
        <span class="text-muted">
          {{ series.score.trials }} trials = {{ series.score.runs }} ×
          {{ series.score.convention.trialsPerRun }}
        </span>
      </div>

      <LineChart
        v-if="growth"
        :series="[{ name: `critical ratio at ${fmtNum(growth.perRun, { digits: 2 })} hits per run`, y: growth.y, x: growth.x }]"
        :hlines="[
          { value: 0, label: 'chance', dashed: false },
          { value: 2, label: 'CR 2' },
          { value: 3, label: 'CR 3' },
        ]"
        :vlines="[{ value: safeRuns, label: `your series: ${safeRuns} runs`, color: 'primary', dashed: false }]"
        x-label="runs in the series"
        y-label="critical ratio"
        :height="240"
        :format="(v) => fmtNum(v, { digits: 3 })"
        aria-label="Critical ratio against the number of runs at a fixed hits-per-run rate"
      />

      <p class="text-sm text-muted">
        The curve is the whole point of the run convention: a fixed rate per run drives the critical
        ratio up as <span class="font-mono">√R</span> without the effect changing at all. A CR is a
        statement about the sample size as much as about the sample, which is why the effect size
        <span class="font-mono">z/√n</span> and the interval matter more than the ratio.
      </p>

      <div class="rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-highlighted">Two conditions (Rhine–Pratt difference)</h3>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="A — hits" size="sm" class="w-32">
            <UInputNumber v-model="groupAHits" :min="0" :step="1" class="w-full" />
          </UFormField>
          <UFormField label="A — runs" size="sm" class="w-28">
            <UInputNumber v-model="groupARuns" :min="1" :step="1" class="w-full" />
          </UFormField>
          <UFormField label="B — hits" size="sm" class="w-32">
            <UInputNumber v-model="groupBHits" :min="0" :step="1" class="w-full" />
          </UFormField>
          <UFormField label="B — runs" size="sm" class="w-28">
            <UInputNumber v-model="groupBRuns" :min="1" :step="1" class="w-full" />
          </UFormField>
        </div>
        <ErrorAlert :err="difference.error" title="The comparison was rejected" />
        <div v-if="difference.result" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Mean A" :value="difference.result.meanA" :digits="3" note="hits per run" />
          <StatTile label="Mean B" :value="difference.result.meanB" :digits="3" note="hits per run" />
          <StatTile label="SD of the difference" :value="difference.result.sdDifference" :digits="4" />
          <StatTile label="CR of the difference" :value="difference.result.criticalRatio" :digits="4" tone="info" />
        </div>
        <p v-if="difference.result" class="text-sm text-muted">
          Two-sided normal p of that ratio:
          <span class="font-mono text-highlighted">{{ fmtP(difference.result.pTwoSided) }}</span>.
          With fewer than about 30 runs per group Rhine &amp; Pratt switch to a t-test on the run
          scores — the normal reading assumes independent binomial runs.
        </p>
      </div>

      <CodeSnippet :code="code" title="what these controls ran" />

      <HonestNote variant="caveat">
        A run convention is bookkeeping, not a null. <span class="font-mono">ESP_RUN</span>'s SD of 2
        assumes 25 <em>independent</em> targets; Rhine's own packs were shuffled, which makes the
        real SD 2.0412 (next tab). <span class="font-mono">PK_RUN</span> assumes a counterbalanced
        design in which the target face rotates, or die bias alone produces hits.
      </HonestNote>
    </div>

    <template #footer>
      Defaults: 560 hits in 100 ESP runs gives exactly CR 3.000 with a series SD of 20; the two
      groups 330/50 and 250/50 give SD 0.4 and CR 4.000, the pooled-trials rule.
    </template>
  </DemoSection>
</template>
