<script setup lang="ts">
/**
 * Section 2 — Bayes factors: the binomial factor for any chance rate, the
 * closed form for a standard-normal statistic, and (in `PsiEProcess`) the
 * anytime-valid coin e-process and the sequential design that registers it.
 */
import {
  type BinomialAlternative,
  binomialBayesFactor,
  binomialLogBayesFactor,
  zBayesFactor,
} from '@mindpeeker/psi'
import type { LineSeries } from '~/lib/chart'
import { fmtNum } from '~/lib/format'

const P0S = [
  { label: '½ — bits, placement tests', value: 0.5 },
  { label: '¼ — ganzfeld (one target, three decoys)', value: 0.25 },
  { label: '⅕ — Zener cards', value: 0.2 },
  { label: '⅙ — a die face', value: 1 / 6 },
]
const ALTERNATIVES: { label: string; value: BinomialAlternative }[] = [
  { label: 'two-sided (default)', value: 'two-sided' },
  { label: "greater — psi-hitting (p > p₀)", value: 'greater' },
  { label: 'less — psi-missing (p < p₀)', value: 'less' },
]

const n = ref(100)
const k = ref(32)
const p0 = ref(0.25)
const a = ref(1)
const b = ref(1)
const alternative = ref<BinomialAlternative>('greater')

const model = computed(() => ({
  a: a.value,
  b: b.value,
  p0: p0.value,
  alternative: alternative.value,
}))

function guard<T>(fn: () => T): { ok?: T; error?: unknown } {
  try {
    return { ok: fn() }
  } catch (error) {
    return { error }
  }
}

const binomial = computed(() =>
  guard(() => {
    const hits = Math.min(k.value, n.value)
    return {
      bf10: binomialBayesFactor(hits, n.value, model.value),
      lnBf10: binomialLogBayesFactor(hits, n.value, model.value),
      hits,
      expected: n.value * p0.value,
    }
  }),
)

const CLAMP_LO = 1e-9
const CLAMP_HI = 1e9
const clamp = (x: number) => Math.min(CLAMP_HI, Math.max(CLAMP_LO, x))

/** BF₁₀ across every attainable hit count (sampled when n is large). */
const binomialCurve = computed<{ series: LineSeries[]; x: number[] }>(() => {
  const total = n.value
  const stepCount = Math.min(total, 320)
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= stepCount; i++) {
    const hits = Math.round((i / stepCount) * total)
    if (xs[xs.length - 1] === hits) continue
    xs.push(hits)
    try {
      ys.push(clamp(Math.exp(binomialLogBayesFactor(hits, total, model.value))))
    } catch {
      ys.push(CLAMP_LO)
    }
  }
  return { series: [{ name: 'BF₁₀(k)', y: ys }], x: xs }
})

// ── zBayesFactor ──────────────────────────────────────────────────────────
const z = ref(1.8)
const g = ref(1)
const oneSided = ref(true)

const zResult = computed(() =>
  guard(() => zBayesFactor(z.value, { g: g.value, oneSided: oneSided.value })),
)

const zCurve = computed<{ series: LineSeries[]; x: number[] }>(() => {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= 240; i++) {
    const value = -5 + (i / 240) * 10
    xs.push(value)
    try {
      ys.push(clamp(zBayesFactor(value, { g: g.value, oneSided: oneSided.value }).bf10))
    } catch {
      ys.push(CLAMP_LO)
    }
  }
  return { series: [{ name: 'BF₁₀(z)', y: ys, color: 2 }], x: xs }
})

const JEFFREYS = [
  { value: 1, label: '1 — no evidence either way', dashed: false },
  { value: 3, label: '3 — moderate for H₁' },
  { value: 10, label: '10 — strong for H₁' },
  { value: 1 / 3, label: '⅓ — moderate for H₀' },
  { value: 0.1, label: '1/10 — strong for H₀' },
]

const binomialSnippet = computed(
  () => `import { binomialBayesFactor, binomialLogBayesFactor } from '@mindpeeker/psi'

const bf10 = binomialBayesFactor(${Math.min(k.value, n.value)}, ${n.value}, {
  p0: ${p0.value === 1 / 6 ? '1 / 6' : p0.value},          // the design's chance rate
  a: ${a.value}, b: ${b.value},           // Beta prior on p under H1
  alternative: '${alternative.value}',
})
const lnBf10 = binomialLogBayesFactor(${Math.min(k.value, n.value)}, ${n.value}, { p0: ${
    p0.value === 1 / 6 ? '1 / 6' : p0.value
  } }) // never overflows`,
)

const zSnippet = computed(
  () => `import { zBayesFactor } from '@mindpeeker/psi'

// closed form for a standard-normal statistic with effect prior μ ~ N(0, g)
const { bf10, bf01, lnBf10 } = zBayesFactor(${z.value}, { g: ${g.value}, oneSided: ${oneSided.value} })`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="bayes-binomial"
      title="1 · Binomial Bayes factor, any chance rate"
      description="BF₁₀ = B(k+a, n−k+b) / (B(a,b) · p₀^k (1−p₀)^(n−k)) — H1: p ~ Beta(a,b) against the chance null p = p₀. Unlike a p-value it can come out in favour of chance."
      :api="['binomialBayesFactor', 'binomialLogBayesFactor', 'lnBayesFactor']"
    >
      <template #controls>
        <UFormField label="Trials n">
          <UInputNumber v-model="n" :min="1" :max="100000" class="w-36" />
        </UFormField>
        <UFormField label="Hits k">
          <UInputNumber v-model="k" :min="0" :max="n" class="w-32" />
        </UFormField>
        <UFormField label="Chance rate p₀" class="min-w-56">
          <USelect v-model="p0" :items="P0S" class="w-full" />
        </UFormField>
        <UFormField label="Prior a">
          <UInputNumber v-model="a" :min="0.01" :step="0.5" class="w-28" />
        </UFormField>
        <UFormField label="Prior b">
          <UInputNumber v-model="b" :min="0.01" :step="0.5" class="w-28" />
        </UFormField>
        <UFormField label="Direction of H₁" class="min-w-56">
          <USelect v-model="alternative" :items="ALTERNATIVES" class="w-full" />
        </UFormField>
      </template>

      <ErrorAlert :err="binomial.error" :dismissible="false" />

      <div v-if="binomial.ok" class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="BF₁₀"
            :value="binomial.ok.bf10"
            :digits="4"
            :tone="binomial.ok.bf10 > 3 ? 'warning' : binomial.ok.bf10 < 1 / 3 ? 'success' : 'neutral'"
            note="evidence for H₁ over chance"
          />
          <StatTile
            label="BF₀₁"
            :value="1 / binomial.ok.bf10"
            :digits="4"
            note="evidence for chance — a p-value cannot say this"
          />
          <StatTile label="ln BF₁₀" :value="binomial.ok.lnBf10" :digits="4" note="never overflows: rank and sum log factors" />
          <StatTile
            label="hits vs chance"
            :value="`${binomial.ok.hits} / ${n}`"
            :note="`expected ${fmtNum(binomial.ok.expected, { digits: 1 })} at p₀ = ${fmtNum(p0, { digits: 4 })}`"
          />
        </div>

        <LineChart
          :series="binomialCurve.series"
          :x="binomialCurve.x"
          :hlines="JEFFREYS"
          :vlines="[{ value: binomial.ok.hits, label: 'observed k' }, { value: binomial.ok.expected, label: 'chance', color: 'muted' }]"
          log-y
          x-label="hits k"
          y-label="BF₁₀ (log scale)"
          :height="260"
          :format="(v) => fmtNum(v, { digits: 3 })"
          aria-label="Bayes factor against the number of hits, with the Jeffreys reference lines"
        />

        <CodeSnippet :code="binomialSnippet" title="what this calculator ran" />
      </div>

      <HonestNote variant="exact">
        The factor is an exact ratio of marginal likelihoods for the stated prior — no
        approximation, and the log form keeps ~14 significant digits at n = 10⁶ where the linear
        form is <code class="font-mono">Infinity</code>. What it is *not* is prior-free: a diffuse
        prior always favours H₀ at small z (Lindley), and symmetric priors with a = b &gt; 1 encode
        the honest expectation that any real effect is tiny.
      </HonestNote>

      <template #footer>
        Designs and their chance rates: ½ for bits and placement tests, ¼ for ganzfeld with one
        target and three decoys, ⅕ for Zener cards, ⅙ for a die face.
      </template>
    </DemoSection>

    <DemoSection
      id="bayes-z"
      title="2 · Normal statistics: Δz and friends"
      description="BF₁₀ = (1+g)^(−1/2) · exp(z²g / 2(1+g)); the one-sided form uses the half-normal prior on μ > 0. This is what tripolarBayesFactor evaluates once it has turned a per-bit prior into g."
      :api="['zBayesFactor', 'tripolarBayesFactor']"
    >
      <template #controls>
        <UFormField label="Statistic z" class="min-w-64">
          <div class="flex items-center gap-3">
            <USlider v-model="z" :min="-5" :max="5" :step="0.05" class="w-48" />
            <span class="font-mono tabular-nums text-sm w-12">{{ fmtNum(z, { digits: 2 }) }}</span>
          </div>
        </UFormField>
        <UFormField label="Prior variance g" help="g = σ²/(1/N_H + 1/N_L) on the per-bit scale">
          <UInputNumber v-model="g" :min="0.0001" :step="0.25" class="w-32" />
        </UFormField>
        <USwitch v-model="oneSided" label="one-sided (BF₊₀)" />
      </template>

      <ErrorAlert :err="zResult.error" :dismissible="false" />

      <div v-if="zResult.ok" class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-3">
          <StatTile label="BF₁₀" :value="zResult.ok.bf10" :digits="4" />
          <StatTile label="BF₀₁" :value="zResult.ok.bf01" :digits="4" note="support for chance" />
          <StatTile label="ln BF₁₀" :value="zResult.ok.lnBf10" :digits="4" />
        </div>

        <LineChart
          :series="zCurve.series"
          :x="zCurve.x"
          :hlines="JEFFREYS"
          :vlines="[{ value: z, label: 'your z' }]"
          log-y
          x-label="z"
          y-label="BF₁₀ (log scale)"
          :height="260"
          :format="(v) => fmtNum(v, { digits: 3 })"
          aria-label="Bayes factor against the observed z statistic"
        />

        <CodeSnippet :code="zSnippet" title="what this calculator ran" />
      </div>

      <template #footer>
        For a tripolar analysis, <code class="font-mono">tripolarBayesFactor(analysis, {
          perBitEffectSd
        })</code>
        states the prior on the per-bit scale and converts it to this g using the analysis' own bit
        counts — PEAR-scale expectations are σ ≈ 10⁻⁴.
      </template>
    </DemoSection>

    <PsiEProcess />
  </div>
</template>
