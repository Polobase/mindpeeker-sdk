<script setup lang="ts">
/**
 * Section 1, readout — analyzeTripolar against the registration, the control
 * contrast, TOST equivalence, the variance ("bind") test and the Bayes factor.
 */
import {
  analyzeTripolar,
  controlContrast,
  type Intention,
  type IntentionSummary,
  type RegisteredTripolar,
  tostEquivalence,
  type TripolarAnalysis,
  tripolarBayesFactor,
  type TripolarRun,
} from '@mindpeeker/psi'
import { fmtNum } from '~/lib/format'
import { cumulativeStouffer, zScores } from '~/lib/psi/synthetic'

const props = defineProps<{
  runs: readonly TripolarRun[]
  registration: RegisteredTripolar
}>()

type Edit = 'none' | 'drop-last' | 'relabel' | 'truncate'
const edit = defineModel<Edit>('edit', { default: 'none' })
const eps0 = defineModel<number>('eps0', { default: 0.02 })
const priorSd = defineModel<number>('priorSd', { default: 1e-4 })

const EDITS: { label: string; value: Edit }[] = [
  { label: 'none — the runs as collected', value: 'none' },
  { label: 'stop early: drop the last run', value: 'drop-last' },
  { label: 'relabel the first run', value: 'relabel' },
  { label: 'shorten the first run by 5 trials', value: 'truncate' },
]

const INTENTION_LIST: readonly Intention[] = ['high', 'low', 'baseline']

const experimental = computed(() => props.runs.filter((r) => r.arm !== 'control'))
const control = computed(() => props.runs.filter((r) => r.arm === 'control'))

function applyEdit(runs: readonly TripolarRun[], how: Edit): TripolarRun[] {
  const list = runs.map((run) => ({ ...run }))
  if (how === 'none' || list.length === 0) return list
  if (how === 'drop-last') {
    const last = Math.max(...list.map((r) => r.sequence))
    return list.filter((r) => r.sequence !== last)
  }
  const first = list[0] as TripolarRun
  if (how === 'relabel') {
    const flipped: Intention = first.intention === 'high' ? 'low' : 'high'
    list[0] = { ...first, intention: flipped }
    return list
  }
  const sums = first.series.sums
  list[0] = {
    ...first,
    series: { ...first.series, sums: sums.slice(0, Math.max(1, sums.length - 5)) },
  }
  return list
}

interface ArmAnalysis {
  analysis?: TripolarAnalysis
  deviations: readonly string[]
  error?: unknown
}

function analyzeArm(runs: readonly TripolarRun[]): ArmAnalysis {
  if (runs.length === 0) return { deviations: [] }
  let reported: TripolarAnalysis
  try {
    reported = analyzeTripolar(runs, { registration: props.registration, deviations: 'report' })
  } catch (err) {
    return { deviations: [], error: err }
  }
  const deviations = reported.deviations ?? []
  let error: unknown
  if (deviations.length > 0) {
    try {
      analyzeTripolar(runs, { registration: props.registration })
    } catch (err) {
      error = err
    }
  }
  return { analysis: reported, deviations, error }
}

const exp = computed(() => analyzeArm(applyEdit(experimental.value, edit.value)))
const ctl = computed(() => analyzeArm(control.value))

const contrast = computed(() => {
  const e = exp.value.analysis
  const c = ctl.value.analysis
  if (!e || !c) return undefined
  try {
    return controlContrast(e, c)
  } catch {
    return undefined
  }
})

const tost = computed(() => {
  const subject = ctl.value.analysis ?? exp.value.analysis
  if (!subject || !(eps0.value > 0)) return undefined
  try {
    return tostEquivalence(subject, { eps0: eps0.value })
  } catch {
    return undefined
  }
})

const bayes = computed(() => {
  const e = exp.value.analysis
  if (!e || !(priorSd.value > 0)) return undefined
  try {
    return tripolarBayesFactor(e, { perBitEffectSd: priorSd.value })
  } catch {
    return undefined
  }
})

/** Bits per intention a TOST at eps0 could clear at zero true effect. */
const bitsForEps = computed(() => Math.ceil(2 * (1.6448536269514722 / eps0.value) ** 2))

const summaries = computed<IntentionSummary[]>(() => {
  const e = exp.value.analysis
  if (!e) return []
  return [e.high, e.low, ...(e.baseline ? [e.baseline] : [])]
})

const zBars = computed(() => ({
  categories: summaries.value.map((s) => s.intention),
  values: summaries.value.map((s) => s.z),
}))

/** Cumulative Stouffer z per intention, in collection order. */
const paths = computed(() => {
  const runs = applyEdit(experimental.value, edit.value)
  const k = runs[0]?.series.bitsPerTrial ?? 200
  const out: { name: string; y: Float64Array; color: number }[] = []
  INTENTION_LIST.forEach((intention, index) => {
    const zs: number[] = []
    for (const run of [...runs].sort((a, b) => a.sequence - b.sequence)) {
      if (run.intention !== intention) continue
      for (const z of zScores(run.series.sums, k)) zs.push(z)
    }
    if (zs.length) {
      out.push({ name: intention, y: cumulativeStouffer(zs), color: index + 1 })
    }
  })
  return out
})
</script>

<template>
  <DemoSection
    id="tripolar-analysis"
    title="3 · Analysis, bound to the registration"
    description="Δz = (ε_H − ε_L)/√(1/N_H + 1/N_L) is the one pre-stated statistic; everything else on this card is secondary and labelled as such."
    :api="[
      'analyzeTripolar',
      'controlContrast',
      'tostEquivalence',
      'tripolarBayesFactor',
      'IntentionSummary.variance',
    ]"
  >
    <template #controls>
      <UFormField
        label="Post-hoc edit (to break the registration)"
        help="the analysis is re-run against the same registration"
      >
        <USelect v-model="edit" :items="EDITS" class="w-full sm:w-80" />
      </UFormField>
      <UFormField label="Equivalence margin ε₀ (per bit)">
        <UInputNumber v-model="eps0" :min="0.0001" :max="1" :step="0.005" class="w-44" />
      </UFormField>
      <UFormField label="Bayes prior sd (per bit)">
        <UInputNumber v-model="priorSd" :min="1e-6" :max="1" :step="0.0001" class="w-44" />
      </UFormField>
    </template>

    <ErrorAlert
      v-if="exp.error"
      :err="exp.error"
      :dismissible="false"
      title="analyzeTripolar refused these runs"
    />
    <UAlert
      v-if="exp.deviations.length"
      class="mb-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="The runs diverge from the registration"
    >
      <template #description>
        <ul class="list-disc pl-4 space-y-0.5 text-sm">
          <li v-for="line in exp.deviations" :key="line">{{ line }}</li>
        </ul>
        <p class="mt-2 text-xs">
          With the default <code class="font-mono">deviations: 'throw'</code> this is a
          <code class="font-mono">PsiError('plan_mismatch')</code> and no numbers are produced at
          all. The numbers below come from <code class="font-mono">deviations: 'report'</code>, and
          they are not the registered analysis.
        </p>
      </template>
    </UAlert>

    <div v-if="exp.analysis" class="flex flex-col gap-5">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Δz (high − low)"
          :value="exp.analysis.deltaZ"
          :digits="3"
          :tone="Math.abs(exp.analysis.deltaZ) > 2 ? 'warning' : 'neutral'"
          note="N(0,1) under H0 — the registered statistic"
        />
        <StatTile label="one-sided p" size="md">
          <template #value><PValue :p="exp.analysis.deltaP" kind="pointwise" /></template>
          <template #note>H1: high &gt; low, the pre-stated direction</template>
        </StatTile>
        <StatTile
          label="Δε (per bit)"
          :value="exp.analysis.deltaEffect"
          :digits="5"
          :note="`95% CI ${fmtNum(exp.analysis.deltaCi95[0], { digits: 5 })} … ${fmtNum(exp.analysis.deltaCi95[1], { digits: 5 })}`"
        />
        <StatTile
          label="BF₁₀ (prior sd per bit)"
          :value="bayes?.bf10"
          :digits="3"
          :note="`one-sided, σ = ${priorSd} — BF₀₁ ${fmtNum(bayes?.bf01, { digits: 3 })}`"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 class="text-sm font-medium text-highlighted mb-2">Stouffer z per intention</h3>
          <BarChart
            :categories="zBars.categories"
            :values="zBars.values"
            :expected="0"
            expected-label="chance (z = 0)"
            y-label="Stouffer z"
            :height="220"
            aria-label="Stouffer z per intention against the chance value of zero"
          />
        </div>
        <div>
          <h3 class="text-sm font-medium text-highlighted mb-2">
            Cumulative Stouffer z within each intention
          </h3>
          <LineChart
            :series="paths"
            :hlines="[
              { value: 0, label: 'chance', dashed: false },
              { value: 1.96, label: '±1.96 (pointwise 5%)' },
              { value: -1.96 },
            ]"
            x-label="trial within the intention"
            y-label="cumsum(z)/√n"
            :height="220"
            aria-label="cumulative Stouffer z per intention against the pointwise ±1.96 lines"
          />
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse">
          <caption class="text-left text-xs text-muted pb-2">
            Per intention: Stouffer z, per-bit effect ε with its 95% CI, and the variance ("bind")
            test — PEAR reported a surplus of baseline scores at the exact theoretical mean.
          </caption>
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" class="py-1.5 pr-3">intention</th>
              <th scope="col" class="py-1.5 pr-3">trials</th>
              <th scope="col" class="py-1.5 pr-3">bits</th>
              <th scope="col" class="py-1.5 pr-3">z</th>
              <th scope="col" class="py-1.5 pr-3">p</th>
              <th scope="col" class="py-1.5 pr-3">ε (per bit)</th>
              <th scope="col" class="py-1.5 pr-3">variance z</th>
              <th scope="col" class="py-1.5 pr-3">at k/2</th>
            </tr>
          </thead>
          <tbody class="font-mono tabular-nums">
            <tr v-for="s in summaries" :key="s.intention" class="border-t border-default">
              <td class="py-1.5 pr-3 font-sans">{{ s.intention }}</td>
              <td class="py-1.5 pr-3">{{ s.trials }}</td>
              <td class="py-1.5 pr-3">{{ fmtNum(s.bits, { digits: 0 }) }}</td>
              <td class="py-1.5 pr-3">{{ fmtNum(s.z, { digits: 3 }) }}</td>
              <td class="py-1.5 pr-3 font-sans">
                <PValue :p="s.pValue" :show-kind="false" kind="pointwise" />
              </td>
              <td class="py-1.5 pr-3">
                {{ fmtNum(s.effectSize, { digits: 5 }) }}
                <span class="text-dimmed">
                  [{{ fmtNum(s.ci95[0], { digits: 4 }) }},
                  {{ fmtNum(s.ci95[1], { digits: 4 }) }}]
                </span>
              </td>
              <td class="py-1.5 pr-3">{{ fmtNum(s.variance.z, { digits: 3 }) }}</td>
              <td class="py-1.5 pr-3">
                {{ s.variance.atMean }} / {{ fmtNum(s.variance.atMeanExpected, { digits: 2 }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="ctl.analysis" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="control arm Δz"
          :value="ctl.analysis.deltaZ"
          :digits="3"
          note="a deterministic source cannot be influenced"
        />
        <StatTile
          label="control contrast z"
          :value="contrast?.z"
          :digits="3"
          note="(Δε_E − Δε_C)/√(s_E² + s_C²), exactly N(0,1)"
        />
        <StatTile label="contrast p" size="md">
          <template #value><PValue :p="contrast?.pValue" kind="pointwise" /></template>
          <template #note>one-sided: experimental separation &gt; control</template>
        </StatTile>
        <StatTile
          label="TOST at ε₀"
          :value="tost ? (tost.equivalent ? 'equivalent' : 'not shown') : '—'"
          :tone="tost?.equivalent ? 'success' : 'neutral'"
          :note="`p ${fmtNum(tost?.pValue, { digits: 4 })} · at zero true effect this ε₀ needs ≈ ${fmtNum(bitsForEps, { digits: 0 })} bits per intention`"
        />
      </div>
    </div>

    <HonestNote variant="caveat" class="mt-4">
      An effect the control arm reproduces indicts the pipeline rather than the operator — that is
      this workspace's methodological stance, not the field's consensus. PEAR's own 12-year review
      reports no correlation on strictly deterministic sources, while an earlier account reports
      comparable results on pseudo-random and prerecorded ones. The equivalence margin here is
      typically 100–200× the PEAR-scale effect of ≈ 10⁻⁴ per bit, so "equivalent at ε₀" says far
      less than it sounds like.
    </HonestNote>
  </DemoSection>
</template>
