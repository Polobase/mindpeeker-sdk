<script setup lang="ts">
/**
 * Free-response judging scored by rank: the rank the true target received among
 * k candidates, one per trial. Under H₀ each rank is uniform on 1…k because the
 * target was drawn at random from the judged set — not because the judge is
 * unbiased.
 */
import type { RankOrderScore } from '@mindpeeker/judging'
import { rankOrderStatistic, sumOfRanksDistribution } from '@mindpeeker/judging'
import { drbgSource } from '~/lib/entropy'
import { fmtNum, fmtP } from '~/lib/format'
import { uniformRanks } from '~/lib/judging/draw'
import { parseIntList } from '~/lib/judging/presets'
import { currentSeedLabel } from '~/utils/sources'

const PRESETS = [
  {
    id: 'readme',
    label: 'README example — 10 trials among 4',
    choices: 4,
    ranks: '1 2 1 3 1 4 2 1 2 1',
  },
  {
    id: 'utts',
    label: "Utts' 5-candidate illustration — 5 trials among 5",
    choices: 5,
    ranks: '1 2 3 1 1',
  },
  {
    id: 'chance',
    label: 'Exactly chance — every rank once, among 4',
    choices: 4,
    ranks: '1 2 3 4',
  },
  {
    id: 'missing',
    label: 'Below chance — the target ranked last, among 4',
    choices: 4,
    ranks: '4 3 4 4 3 4 2 4 3 4',
  },
] as const

const choices = ref(4)
const ranksText = ref('1 2 1 3 1 4 2 1 2 1')
const drawTrials = ref(40)
const task = useTask<number[]>()

const parsed = computed(() => parseIntList(ranksText.value))
const safeChoices = computed(() => Math.max(2, Math.trunc(Number(choices.value) || 2)))

function applyPreset(id: string): void {
  const preset = PRESETS.find((p) => p.id === id)
  if (!preset) return
  choices.value = preset.choices
  ranksText.value = preset.ranks
}

/** A null judge: ranks drawn uniformly from an independent seeded source. */
function drawNull(): void {
  void task
    .run(async (signal) => {
      const control = drbgSource(`${currentSeedLabel()} / rank judge`)
      const n = Math.max(1, Math.min(2000, Math.trunc(Number(drawTrials.value) || 1)))
      return await uniformRanks(n, safeChoices.value, { signal, source: control })
    })
    .then((ranks) => {
      if (ranks) ranksText.value = ranks.join(' ')
    })
}

const outcome = computed<{ score?: RankOrderScore; error?: unknown }>(() => {
  try {
    return { score: rankOrderStatistic(parsed.value.values, safeChoices.value) }
  } catch (error) {
    return { error }
  }
})

const score = computed(() => outcome.value.score)

/** The exact null of the sum of ranks: the n-fold convolution of Uniform{1…k}. */
const nullCurve = computed(() => {
  const s = score.value
  if (!s) return undefined
  const dist = sumOfRanksDistribution(s.trials, s.choices)
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < dist.pmf.length; i++) {
    x.push(dist.min + i)
    y.push(dist.pmf[i] as number)
  }
  return { x, y, min: dist.min, max: dist.max }
})

const rankHistogram = computed(() => {
  const s = score.value
  if (!s) return undefined
  const counts = new Array<number>(s.choices).fill(0)
  for (const rank of parsed.value.values) {
    if (rank >= 1 && rank <= s.choices) counts[rank - 1] = (counts[rank - 1] as number) + 1
  }
  return {
    categories: counts.map((_, i) => String(i + 1)),
    values: counts,
    expected: s.trials / s.choices,
  }
})

const code = computed(() => {
  const s = score.value
  if (!s) return ''
  return `import { rankOrderStatistic, sumOfRanksDistribution } from '@mindpeeker/judging'

const ranks = [${parsed.value.values.join(', ')}]   // 1 = the judge's best match
const score = rankOrderStatistic(ranks, ${s.choices})
score.sumOfRanks        // ${s.sumOfRanks}   (chance ${fmtNum((s.trials * (s.choices + 1)) / 2, { digits: 1 })})
score.meanRank          // ${fmtNum(s.meanRank, { digits: 4 })}   expected ${fmtNum(s.expectedMeanRank, { digits: 1 })}
score.effectSize        // ${fmtNum(s.effectSize, { digits: 4 })}   Utts' ES = ((k+1)/2 − r̄)/√((k²−1)/12)
score.hits              // ${s.hits}   trials ranked 1 (direct hits)
score.pExact            // ${fmtP(s.pExact)}   exact P(S ≤ sum), by convolution
score.pNormal           // ${fmtP(s.pNormal)}   continuity-corrected normal

sumOfRanksDistribution(${s.trials}, ${s.choices}).pmf   // the whole null, ${nullCurve.value?.x.length ?? 0} points`
})
</script>

<template>
  <DemoSection
    id="ranks"
    title="Rank-order judging"
    :api="['rankOrderStatistic', 'sumOfRanksDistribution']"
    description="One rank per trial: where the true target landed among k candidates, 1 = best. The exact null of the sum is the n-fold convolution of the discrete uniform (Solfvin, Kelly & Burdick 1978) — no normal approximation needed, though it is printed for comparison."
  >
    <template #controls>
      <UFormField label="k — candidates per trial" size="sm" class="w-full sm:w-48">
        <UInputNumber v-model="choices" :min="2" :max="20" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Trials to draw" size="sm" class="w-full sm:w-36">
        <UInputNumber v-model="drawTrials" :min="1" :max="500" :step="10" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        label="Draw null ranks"
        busy-label="Drawing…"
        icon="i-lucide-dices"
        hint="a seeded judge with no information — this is what chance looks like"
        @run="drawNull"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-2">
        <span class="text-xs uppercase tracking-wide text-muted self-center">Examples</span>
        <UButton
          v-for="preset in PRESETS"
          :key="preset.id"
          size="xs"
          variant="soft"
          color="neutral"
          @click="applyPreset(preset.id)"
        >
          {{ preset.label }}
        </UButton>
      </div>

      <UFormField
        label="Ranks — one integer per trial, 1 = the judge's best match"
        size="sm"
        :help="`Every value must be an integer in [1, ${safeChoices}]. Whitespace or commas.`"
      >
        <UTextarea v-model="ranksText" :rows="3" class="w-full font-mono" spellcheck="false" autocomplete="off" />
      </UFormField>

      <ErrorAlert :err="task.error.value" title="The draw failed" @dismiss="task.reset()" />
      <ErrorAlert :err="outcome.error" title="The ranks were rejected" />

      <p v-if="parsed.bad.length" class="text-sm text-warning">
        Ignored, not integers: <span class="font-mono">{{ parsed.bad.join(' ') }}</span>
      </p>

      <div v-if="score" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Trials" :value="score.trials" :digits="0" :note="`${score.choices} candidates each`" />
        <StatTile
          label="Mean rank"
          :value="score.meanRank"
          :digits="4"
          tone="primary"
          :note="`chance ${fmtNum(score.expectedMeanRank, { digits: 2 })}`"
        />
        <StatTile
          label="Utts' effect size"
          :value="score.effectSize"
          :digits="4"
          tone="info"
          note="positive = better than chance"
        />
        <StatTile
          label="Direct hits"
          :value="score.hits"
          :digits="0"
          :note="`rank 1; chance ${fmtNum(score.trials / score.choices, { digits: 2 })}`"
        />
      </div>

      <div v-if="score" class="flex flex-wrap items-center gap-4">
        <PValue :p="score.pExact" kind="exact" label="P(S ≤ sum)" />
        <PValue :p="score.pExactUpper" kind="exact" label="P(S ≥ sum)" />
        <PValue :p="score.pNormal" kind="pointwise" label="normal, cc" />
        <span class="text-sm text-muted">
          sum of ranks <span class="font-mono text-highlighted">{{ score.sumOfRanks }}</span>,
          rank SD <span class="font-mono">{{ fmtNum(score.rankSd, { digits: 4 }) }}</span>,
          z <span class="font-mono">{{ fmtNum(score.z, { digits: 4 }) }}</span>
        </span>
      </div>

      <LineChart
        v-if="nullCurve && score"
        :series="[{ name: `exact null of the sum of ${score.trials} ranks`, y: nullCurve.y, x: nullCurve.x }]"
        :vlines="[
          { value: (score.trials * (score.choices + 1)) / 2, label: 'chance mean' },
          { value: score.sumOfRanks, label: `observed ${score.sumOfRanks}`, color: 'primary', dashed: false },
        ]"
        x-label="sum of ranks"
        y-label="probability"
        :height="260"
        :format="(v) => fmtNum(v, { digits: 6 })"
        aria-label="Exact null distribution of the sum of ranks with the chance mean and the observed sum marked"
      />

      <BarChart
        v-if="rankHistogram"
        :categories="rankHistogram.categories"
        :values="rankHistogram.values"
        :expected="rankHistogram.expected"
        expected-label="uniform expectation"
        x-label="rank given to the true target"
        y-label="trials"
        :height="200"
        :format="(v) => fmtNum(v, { digits: 0 })"
        aria-label="How often the true target received each rank, against the uniform expectation"
      />

      <CodeSnippet :code="code" title="what these controls ran" />

      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact">
          The null holds whatever the judge does, because the randomness being used is the pairing of
          the target with its decoys, not the judge's behaviour. That is also its limit: it says
          nothing about whether the decoys were really interchangeable, or whether the transcripts
          carried cues (Marks &amp; Kammann 1978).
        </HonestNote>
        <HonestNote variant="contested">
          Direct hits (rank 1) and the sum of ranks are both valid scores of the same data, and they
          do not always agree — reporting whichever looks better is a multiplicity error that the
          ganzfeld literature argued over for a decade (Bem &amp; Honorton 1994; Milton 1997). The
          registration has to pick one before the data.
        </HonestNote>
      </div>
    </div>

    <template #footer>
      The README example (10 trials among 4, sum 18) gives an exact p of 0.0322 while the
      continuity-corrected normal gives 0.0330 — close here, and not always.
    </template>
  </DemoSection>
</template>
