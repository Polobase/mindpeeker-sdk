<script setup lang="ts">
/**
 * Forced choice: hits, trials and the number of alternatives in, the whole
 * Rhine–Pratt row plus the exact tails out. Nothing is simulated and nothing
 * is approximated — `directHits` is `forcedChoiceTest` at p₀ = 1/k.
 */
import type { DirectHitsScore, ForcedChoiceScore } from '@mindpeeker/judging'
import { directHits, forcedChoiceTest, rosenthalRubinPi } from '@mindpeeker/judging'
import type { RefLine } from '~/lib/chart'
import { fmtNum, fmtP } from '~/lib/format'
import { binomialPmf, upperTailOf, visibleRange } from '~/lib/judging/math'
import { CHOICE_PRESETS, choicePreset, STUDY_PRESETS } from '~/lib/judging/presets'

const CUSTOM = 'custom'

const designId = ref('ganzfeld')
const choices = ref(4)
const useCustomP0 = ref(false)
const p0 = ref(0.25)
const hits = ref(122)
const trials = ref(354)
const confidence = ref(0.95)

const designItems = computed(() => [
  ...CHOICE_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
  { label: 'Custom — type the number of alternatives', value: CUSTOM },
])

const confidenceItems = [
  { label: '80 %', value: 0.8 },
  { label: '90 %', value: 0.9 },
  { label: '95 % (default)', value: 0.95 },
  { label: '99 %', value: 0.99 },
]

watch(designId, (id) => {
  const preset = choicePreset(id)
  if (preset) {
    choices.value = preset.choices
    p0.value = 1 / preset.choices
  }
})
watch(choices, (k) => {
  if (choicePreset(designId.value)?.choices !== k) designId.value = CUSTOM
  if (!useCustomP0.value) p0.value = 1 / Math.max(2, Math.trunc(Number(k) || 2))
})

const design = computed(() => choicePreset(designId.value))
const safeChoices = computed(() => Math.max(2, Math.trunc(Number(choices.value) || 2)))
const safeTrials = computed(() => Math.max(1, Math.trunc(Number(trials.value) || 1)))
const safeHits = computed(() => Math.max(0, Math.trunc(Number(hits.value) || 0)))
const chance = computed(() => (useCustomP0.value ? Number(p0.value) : 1 / safeChoices.value))

function applyStudy(id: string): void {
  const study = STUDY_PRESETS.find((s) => s.id === id)
  if (!study) return
  useCustomP0.value = false
  choices.value = study.choices
  designId.value = CHOICE_PRESETS.find((p) => p.choices === study.choices)?.id ?? CUSTOM
  p0.value = 1 / study.choices
  trials.value = study.trials
  hits.value = study.hits
}

const outcome = computed<{ score?: ForcedChoiceScore | DirectHitsScore; error?: unknown }>(() => {
  try {
    const options = { confidence: Number(confidence.value) }
    const score = useCustomP0.value
      ? forcedChoiceTest(safeHits.value, safeTrials.value, chance.value, options)
      : directHits(safeHits.value, safeTrials.value, safeChoices.value, options)
    return { score }
  } catch (error) {
    return { error }
  }
})

const score = computed(() => outcome.value.score)
const pi = computed(() => {
  const s = score.value
  if (!s) return undefined
  return 'rosenthalRubinPi' in s ? s.rosenthalRubinPi : rosenthalRubinPi(s.hitRate, safeChoices.value)
})

/** The null the test integrates: Binomial(trials, p₀), drawn over its visible range. */
const nullCurve = computed(() => {
  const s = score.value
  if (!s) return undefined
  const pmf = binomialPmf(s.trials, s.p0)
  const window = visibleRange(pmf, 1e-7)
  const from = Math.min(window.from, s.hits)
  const to = Math.max(window.to, s.hits)
  const x: number[] = []
  const y: number[] = []
  for (let k = from; k <= to; k++) {
    x.push(k)
    y.push(pmf[k] as number)
  }
  return { x, y, from, to, peak: Math.max(...y) }
})

const vlines = computed<RefLine[]>(() => {
  const s = score.value
  if (!s) return []
  return [
    { value: s.mce, label: `MCE ${fmtNum(s.mce, { digits: 1 })}` },
    { value: s.hits, label: `observed ${s.hits}`, color: 'primary', dashed: false },
  ]
})

/** Values the package's own tests pin, recomputed in your browser. */
const PINNED: readonly {
  label: string
  published: string
  compute: () => number
  digits: number
  source: string
}[] = [
  {
    label: 'directHits(122, 354, 4).criticalRatio',
    published: '4.112',
    compute: () => directHits(122, 354, 4).criticalRatio,
    digits: 3,
    source: 'autoganzfeld CR (README, forced-choice.test.ts)',
  },
  {
    label: 'directHits(122, 354, 4).pOneSided',
    published: '4.44e-5',
    compute: () => directHits(122, 354, 4).pOneSided,
    digits: 3,
    source: 'exact P(X ≥ 122), Binomial(354, ¼)',
  },
  {
    label: 'directHits(122, 354, 4).effectSize',
    published: '0.219',
    compute: () => directHits(122, 354, 4).effectSize,
    digits: 3,
    source: 'z/√n (Bem & Honorton 1994)',
  },
  {
    label: 'directHits(122, 354, 4).rosenthalRubinPi',
    published: '0.612',
    compute: () => directHits(122, 354, 4).rosenthalRubinPi,
    digits: 3,
    source: 'Rosenthal & Rubin (1989) π',
  },
  {
    label: 'forcedChoiceTest(268, 600, 0.5).criticalRatio',
    published: '−2.61',
    compute: () => forcedChoiceTest(268, 600, 0.5).criticalRatio,
    digits: 2,
    source: 'Rhine & Pratt placement series (SD 12.25)',
  },
  {
    label: 'forcedChoiceTest(644, 2704, 0.2).criticalRatio',
    published: '4.96',
    compute: () => forcedChoiceTest(644, 2704, 0.2).criticalRatio,
    digits: 2,
    source: "Tyrrell's Table III (deviation +103.2)",
  },
  {
    label: 'rosenthalRubinPi(0.32, 4)',
    published: '0.5854',
    compute: () => rosenthalRubinPi(0.32, 4),
    digits: 4,
    source: 'the ganzfeld meta-analytic hit rate on the two-choice scale',
  },
]

const pinned = computed(() =>
  PINNED.map((entry) => ({ ...entry, live: entry.compute() })),
)

const code = computed(() => {
  const s = score.value
  if (!s) return ''
  const call = useCustomP0.value
    ? `forcedChoiceTest(${s.hits}, ${s.trials}, ${fmtNum(s.p0, { digits: 6 })})`
    : `directHits(${s.hits}, ${s.trials}, ${safeChoices.value})`
  return `import { ${useCustomP0.value ? 'forcedChoiceTest' : 'directHits'} } from '@mindpeeker/judging'

const score = ${call}
score.mce              // ${fmtNum(s.mce, { digits: 4 })}  = n·p₀
score.deviation        // ${fmtNum(s.deviation, { digits: 4 })}
score.sd               // ${fmtNum(s.sd, { digits: 4 })}  = √(n·p₀·q₀)
score.criticalRatio    // ${fmtNum(s.criticalRatio, { digits: 4 })}
score.pOneSided        // ${fmtP(s.pOneSided)}  exact P(X ≥ hits)
score.pTwoSided        // ${fmtP(s.pTwoSided)}  minimum-likelihood rule
score.effectSize       // ${fmtNum(s.effectSize, { digits: 4 })}  = z/√n
score.cohensH          // ${fmtNum(s.cohensH, { digits: 4 })}
score.confidenceInterval // { lower: ${fmtNum(s.confidenceInterval.lower, { digits: 4 })}, upper: ${fmtNum(s.confidenceInterval.upper, { digits: 4 })} }`
})
</script>

<template>
  <DemoSection
    id="forced-choice"
    title="Forced choice — hits, trials, alternatives"
    :api="['directHits', 'forcedChoiceTest', 'rosenthalRubinPi']"
    description="The whole Rhine–Pratt row (MCE, deviation, SD, critical ratio) next to the exact binomial tails, the effect-size scales the ganzfeld literature uses, and a Clopper–Pearson interval. Pick a design, type a hit count."
  >
    <template #controls>
      <UFormField label="Design" size="sm" class="w-full sm:w-96">
        <USelect v-model="designId" :items="designItems" class="w-full" />
      </UFormField>
      <UFormField label="k — alternatives" size="sm" class="w-full sm:w-36">
        <UInputNumber v-model="choices" :min="2" :max="1000" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Hits" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="hits" :min="0" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Trials" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="trials" :min="1" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Interval coverage" size="sm" class="w-full sm:w-44">
        <USelect v-model="confidence" :items="confidenceItems" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <USwitch
          v-model="useCustomP0"
          label="Custom chance rate"
          description="forcedChoiceTest takes any p₀ in (0, 1); directHits is the 1/k case"
        />
        <UFormField v-if="useCustomP0" label="p₀" size="sm" class="w-36">
          <UInputNumber v-model="p0" :min="0.000001" :max="0.999999" :step="0.05" class="w-full" />
        </UFormField>
      </div>

      <div class="flex flex-wrap gap-2">
        <span class="text-xs uppercase tracking-wide text-muted self-center">Published counts</span>
        <UButton
          v-for="study in STUDY_PRESETS"
          :key="study.id"
          size="xs"
          variant="soft"
          color="neutral"
          @click="applyStudy(study.id)"
        >
          {{ study.label }}
        </UButton>
      </div>

      <ErrorAlert :err="outcome.error" title="The counts were rejected" />

      <p v-if="design && !useCustomP0" class="text-sm text-muted">
        One trial is one <strong>{{ design.trial }}</strong> — {{ design.note }}.
      </p>

      <div v-if="score" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="MCE — mean chance expectation" :value="score.mce" :digits="2" note="n · p₀" />
        <StatTile
          label="Deviation"
          :value="score.deviation"
          :digits="2"
          :tone="score.deviation > 0 ? 'primary' : score.deviation < 0 ? 'warning' : 'neutral'"
          note="hits − MCE"
        />
        <StatTile label="SD" :value="score.sd" :digits="4" note="√(n · p₀ · q₀)" />
        <StatTile
          label="Critical ratio"
          :value="score.criticalRatio"
          :digits="4"
          tone="info"
          note="deviation / SD — a z without continuity correction"
        />
        <StatTile label="Hit rate" :value="score.hitRate" :digits="4" :note="`chance ${fmtNum(score.p0, { digits: 4 })}`" />
        <StatTile
          label="Effect size z/√n"
          :value="score.effectSize"
          :digits="4"
          note="the ganzfeld meta-analytic scale"
        />
        <StatTile label="Cohen's h" :value="score.cohensH" :digits="4" note="2·asin√p̂ − 2·asin√p₀" />
        <StatTile
          label="Rosenthal–Rubin π"
          :value="pi"
          :digits="4"
          note="hit rate on the two-choice scale; chance is ½"
        />
      </div>

      <div v-if="score" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <div class="text-[11px] uppercase tracking-wide text-muted">Exact one-sided, hitting</div>
          <div class="mt-1"><PValue :p="score.pOneSided" kind="exact" label="P(X ≥ hits)" /></div>
        </div>
        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <div class="text-[11px] uppercase tracking-wide text-muted">Exact one-sided, missing</div>
          <div class="mt-1"><PValue :p="score.pLower" kind="exact" label="P(X ≤ hits)" /></div>
        </div>
        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <div class="text-[11px] uppercase tracking-wide text-muted">Exact two-sided</div>
          <div class="mt-1"><PValue :p="score.pTwoSided" kind="exact" label="minimum-likelihood" /></div>
        </div>
        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <div class="text-[11px] uppercase tracking-wide text-muted">Rhine–Pratt normal reading</div>
          <div class="mt-1"><PValue :p="score.pCriticalRatio" kind="pointwise" label="2(1 − Φ(|CR|))" /></div>
        </div>
      </div>

      <div v-if="score" class="rounded-md border border-default bg-elevated/40 p-3 text-sm">
        <span class="text-muted">Clopper–Pearson interval for the hit probability
          ({{ fmtNum(score.confidenceInterval.confidence * 100, { digits: 0 }) }} %):</span>
        <span class="font-mono text-highlighted ml-1">
          {{ fmtNum(score.confidenceInterval.lower, { digits: 4 }) }} …
          {{ fmtNum(score.confidenceInterval.upper, { digits: 4 }) }}
        </span>
        <span class="text-muted">
          — chance {{ fmtNum(score.p0, { digits: 4 }) }} is
          {{
            score.p0 >= score.confidenceInterval.lower && score.p0 <= score.confidenceInterval.upper
              ? 'inside it'
              : 'outside it'
          }}.
        </span>
      </div>

      <LineChart
        v-if="nullCurve"
        :series="[{ name: `Binomial(${safeTrials}, ${fmtNum(chance, { digits: 4 })}) — the null`, y: nullCurve.y, x: nullCurve.x }]"
        :vlines="vlines"
        x-label="hits"
        y-label="probability"
        :height="260"
        :format="(v) => fmtNum(v, { digits: 6 })"
        aria-label="Exact binomial null distribution of the hit count, with mean chance expectation and the observed count marked"
      />

      <p v-if="score && nullCurve" class="text-sm text-muted">
        The exact one-sided p is the mass of that curve from
        <span class="font-mono">{{ score.hits }}</span> upward:
        <span class="font-mono text-highlighted">{{ fmtP(upperTailOf(nullCurve.y, score.hits, nullCurve.from)) }}</span>
        summed here from the drawn pmf, against
        <span class="font-mono text-highlighted">{{ fmtP(score.pOneSided) }}</span>
        from the package's incomplete beta — the same number by two routes.
      </p>

      <div>
        <h3 class="text-sm font-semibold text-highlighted">Published values, recomputed here</h3>
        <p class="mt-1 text-sm text-muted">
          Each row runs the SDK in your browser and prints the value the README or the package's
          tests pin beside it.
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Call</th>
                <th class="text-right py-1.5 px-3 font-medium">Computed now</th>
                <th class="text-right py-1.5 px-3 font-medium">Published</th>
                <th class="text-left py-1.5 pl-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in pinned" :key="row.label" class="border-t border-default">
                <td class="py-1.5 pr-3 font-mono text-xs">{{ row.label }}</td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">
                  {{ Math.abs(row.live) < 0.001 ? row.live.toExponential(2) : fmtNum(row.live, { digits: row.digits }) }}
                </td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums text-muted">{{ row.published }}</td>
                <td class="py-1.5 pl-3 text-muted text-xs">{{ row.source }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <CodeSnippet :code="code" title="what these controls ran" />

      <HonestNote variant="caveat">
        Every number above is exact under one assumption the arithmetic cannot check: each trial's
        target was drawn uniformly and independently from k alternatives, and the response was
        fixed before the target was known. A shuffled pack breaks it (closed decks, next tab), and
        so does showing the card after each call (Read's baseline). The critical ratio is the
        historic Rhine–Pratt statistic and its normal p is printed only for comparison — read the
        exact tails.
      </HonestNote>
    </div>

    <template #footer>
      Rhine &amp; Pratt (1957); Bem &amp; Honorton (1994); Storm, Tressoldi &amp; Di Risio (2010);
      Rosenthal &amp; Rubin (1989); Clopper &amp; Pearson (1934). The two-sided p follows SciPy's
      <span class="font-mono">binomtest</span> minimum-likelihood rule, so it is not simply twice
      the one-sided tail.
    </template>
  </DemoSection>
</template>
