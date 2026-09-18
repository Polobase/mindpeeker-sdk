<script setup lang="ts">
/**
 * The same hit count as a Bayes factor: beta-binomial BF₁₀ against the design's
 * chance rate, computed in log space. A fixed prior makes it a test martingale,
 * which is why it survives the monitoring that a repeated p-value does not.
 */
import type { Alternative, ForcedChoiceBayesFactor } from '@mindpeeker/judging'
import { forcedChoiceBayesFactor, forcedChoiceTest } from '@mindpeeker/judging'
import { fmtNum, fmtP } from '~/lib/format'
import { CHOICE_PRESETS } from '~/lib/judging/presets'

const hits = ref(122)
const trials = ref(354)
const choices = ref(4)
const priorA = ref(1)
const priorB = ref(1)
const alternative = ref<Alternative>('greater')

const choiceItems = CHOICE_PRESETS.map((preset) => ({
  label: `${preset.label}`,
  value: preset.choices,
}))

const alternativeItems = [
  { label: "greater — above chance ('psi-hitting')", value: 'greater' },
  { label: "less — below chance ('psi-missing')", value: 'less' },
  { label: 'two-sided — either direction (the default)', value: 'two-sided' },
]

const safeTrials = computed(() => Math.max(1, Math.trunc(Number(trials.value) || 1)))
const safeHits = computed(() => Math.max(0, Math.trunc(Number(hits.value) || 0)))
const safeChoices = computed(() => Math.max(2, Math.trunc(Number(choices.value) || 2)))
const prior = computed(() => ({
  a: Math.max(1e-6, Number(priorA.value) || 1),
  b: Math.max(1e-6, Number(priorB.value) || 1),
}))

const outcome = computed<{ bf?: ForcedChoiceBayesFactor; error?: unknown }>(() => {
  try {
    return {
      bf: forcedChoiceBayesFactor(safeHits.value, safeTrials.value, {
        choices: safeChoices.value,
        prior: prior.value,
        alternative: alternative.value,
      }),
    }
  } catch (error) {
    return { error }
  }
})

const bf = computed(() => outcome.value.bf)

const exactP = computed(() => {
  try {
    return forcedChoiceTest(safeHits.value, safeTrials.value, 1 / safeChoices.value).pOneSided
  } catch {
    return undefined
  }
})

/** BF₁₀ across every hit count of this design — where does the evidence turn? */
const sweep = computed(() => {
  const n = safeTrials.value
  const step = Math.max(1, Math.ceil(n / 240))
  const x: number[] = []
  const y: number[] = []
  for (let k = 0; k <= n; k += step) {
    try {
      const value = forcedChoiceBayesFactor(k, n, {
        choices: safeChoices.value,
        prior: prior.value,
        alternative: alternative.value,
      }).bf10
      if (value > 0 && Number.isFinite(value)) {
        x.push(k)
        y.push(value)
      }
    } catch {
      // a one-sided prior can put no representable mass on the tested side
    }
  }
  return { x, y }
})

const interpretation = computed(() => {
  const value = bf.value?.bf10
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value >= 100) return 'the data are ≥ 100× more likely under H₁ than under the point null'
  if (value >= 10) return 'the data are ≥ 10× more likely under H₁ than under the point null'
  if (value >= 3) return 'the data are ≥ 3× more likely under H₁ than under the point null'
  if (value > 1) return 'a nudge towards H₁, well inside what chance produces'
  if (value === 1) return 'the two hypotheses predicted these data equally well'
  if (value >= 1 / 3) return 'a nudge towards the chance null'
  if (value >= 1 / 10) return 'the data are ≥ 3× more likely under the chance null'
  return `the data are ${fmtNum(1 / value, { digits: 1 })}× more likely under the chance null`
})

const code = computed(() => {
  const b = bf.value
  if (!b) return ''
  return `import { forcedChoiceBayesFactor } from '@mindpeeker/judging'

const bf = forcedChoiceBayesFactor(${b.hits}, ${b.trials}, {
  choices: ${safeChoices.value},                  // p₀ = ${fmtNum(b.p0, { digits: 6 })}; or pass p0 directly
  prior: { a: ${prior.a}, b: ${prior.b} },        // Beta prior on the hit rate under H₁
  alternative: '${b.alternative}',
})
bf.lnBf10  // ${fmtNum(b.lnBf10, { digits: 6 })}  — formed in log space, so n = 10⁶ is safe
bf.bf10    // ${Number.isFinite(b.bf10) ? fmtNum(b.bf10, { digits: 4 }) : String(b.bf10)}
bf.bf01    // ${Number.isFinite(b.bf01) ? fmtNum(b.bf01, { digits: 4 }) : String(b.bf01)}`
})
</script>

<template>
  <DemoSection
    id="bayes"
    title="The same count as a Bayes factor"
    :api="['forcedChoiceBayesFactor']"
    description="Beta-binomial BF₁₀ against the design's chance rate, in log space. Unlike a p-value it can favour the null, and with a prior fixed in advance it is a test martingale — it keeps its level under continuous monitoring."
  >
    <template #controls>
      <UFormField label="Design" size="sm" class="w-full sm:w-80">
        <USelect v-model="choices" :items="choiceItems" class="w-full" />
      </UFormField>
      <UFormField label="Hits" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="hits" :min="0" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Trials" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="trials" :min="1" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Alternative" size="sm" class="w-full sm:w-72">
        <USelect v-model="alternative" :items="alternativeItems" class="w-full" />
      </UFormField>
      <UFormField label="Prior a" size="sm" class="w-full sm:w-28">
        <UInputNumber v-model="priorA" :min="0.01" :step="0.5" class="w-full" />
      </UFormField>
      <UFormField label="Prior b" size="sm" class="w-full sm:w-28">
        <UInputNumber v-model="priorB" :min="0.01" :step="0.5" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="The Bayes factor was rejected" />

      <div v-if="bf" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="BF₁₀ — H₁ over chance"
          :value="Number.isFinite(bf.bf10) ? bf.bf10 : String(bf.bf10)"
          :digits="bf.bf10 > 100 ? 1 : 4"
          :tone="bf.bf10 >= 3 ? 'warning' : bf.bf10 <= 1 / 3 ? 'success' : 'neutral'"
        />
        <StatTile
          label="BF₀₁ — chance over H₁"
          :value="Number.isFinite(bf.bf01) ? bf.bf01 : String(bf.bf01)"
          :digits="bf.bf01 > 100 ? 1 : 4"
        />
        <StatTile label="ln BF₁₀" :value="bf.lnBf10" :digits="4" note="what the package actually computes" />
        <StatTile label="p₀ under H₀" :value="bf.p0" :digits="6" :note="`prior Beta(${bf.a}, ${bf.b}), ${bf.alternative}`" />
      </div>

      <p v-if="bf" class="text-sm text-muted">
        Read as a likelihood ratio: {{ interpretation }}. The one-sided exact p for the same count is
        <span class="font-mono text-highlighted">{{ fmtP(exactP) }}</span> — a different question
        (how often chance alone reaches this count) with a different answer.
      </p>

      <LineChart
        v-if="sweep.x.length > 1"
        :series="[{ name: `BF₁₀ across every hit count of ${safeTrials} trials`, y: sweep.y, x: sweep.x }]"
        :hlines="[
          { value: 1, label: 'BF = 1 — no evidence either way', dashed: false },
          { value: 3, label: '3' },
          { value: 10, label: '10' },
          { value: 1 / 3, label: '1/3 — towards the null' },
        ]"
        :vlines="[{ value: safeHits, label: `observed ${safeHits}`, color: 'primary', dashed: false }]"
        log-y
        x-label="hits"
        y-label="BF₁₀ (log scale)"
        :height="280"
        :format="(v) => fmtNum(v, { digits: 4 })"
        aria-label="Bayes factor against the chance null as a function of the hit count, log scale"
      />

      <CodeSnippet :code="code" title="what these controls ran" />

      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact">
          The factor is
          <span class="font-mono">B(k+a, n−k+b) / (B(a,b)·p₀ᵏ(1−p₀)ⁿ⁻ᵏ)</span>, expanded around the
          posterior mean so no O(n) terms cancel at n = 10⁶. A one-sided alternative truncates the
          prior to that side of p₀. The package's value agrees with psi's
          <span class="font-mono">binomialLogBayesFactor</span> to 2e-13 and with an independent
          50-digit mpmath computation.
        </HonestNote>
        <HonestNote variant="caveat">
          The prior is part of the pre-registration: a different Beta is a different test, and
          shopping for one after the data is the same error as shopping for a p-value. A Bayes
          factor tolerates optional stopping (Shafer et al. 2011) only when the prior was fixed
          first and the stopping rule is "BF₁₀ ≥ 1/α", not "when it looks good".
        </HonestNote>
      </div>
    </div>

    <template #footer>
      Try 122/354 with a uniform prior and <span class="font-mono">'greater'</span>: BF₁₀ ≈ 221.
      Then set hits to 88 (chance is 88.5): the same machinery returns a factor below 1, which no
      p-value can express.
    </template>
  </DemoSection>
</template>
