<script setup lang="ts">
/**
 * Section 5d — FieldREG: one device through an event that subdivides into
 * temporal segments declared in advance, with the extreme segment corrected
 * over the segments and again over the registered analysis scales.
 */
import {
  analyzeFieldReg,
  type FieldRegAnalysis,
  type FieldRegSegment,
  type TrialSeries,
} from '@mindpeeker/psi'
import { fmtNum, fmtP } from '~/lib/format'

const props = defineProps<{
  series?: TrialSeries
  rounds: number
}>()

const segmentCount = ref(4)
const statistic = ref<'mean' | 'variance'>('mean')
const correction = ref<'sidak' | 'bonferroni'>('sidak')
const scales = ref(1)

const STATISTICS = [
  { label: 'mean — two-sided Stouffer z per segment', value: 'mean' },
  { label: 'variance — upper-tail Σz² per segment', value: 'variance' },
]
const CORRECTIONS = [
  { label: 'Šidák — 1 − (1 − p_min)^S (default)', value: 'sidak' },
  { label: 'Bonferroni — S · p_min', value: 'bonferroni' },
]

const segments = computed<FieldRegSegment[]>(() => {
  const steps = props.series?.sums.length ?? props.rounds
  const width = Math.max(1, Math.floor(steps / segmentCount.value))
  return Array.from({ length: segmentCount.value }, (_, i) => ({
    id: `seg-${i + 1}`,
    label: `segment ${i + 1}`,
    startStep: i * width,
    endStep: i === segmentCount.value - 1 ? steps : (i + 1) * width,
  }))
})

const analysis = computed<{ ok?: FieldRegAnalysis; error?: unknown }>(() => {
  if (!props.series) return {}
  try {
    return {
      ok: analyzeFieldReg(props.series, segments.value, {
        statistic: statistic.value,
        correction: correction.value,
        scales: scales.value,
      }),
    }
  } catch (error) {
    return { error }
  }
})

const bars = computed(() => {
  const ok = analysis.value.ok
  if (!ok) return undefined
  const extremeIndex = ok.segments.findIndex((s) => s.id === ok.extreme.id)
  return {
    categories: ok.segments.map((s) => s.id),
    values: ok.segments.map((s) => s.z),
    highlight: extremeIndex >= 0 ? [extremeIndex] : [],
  }
})

/** P(min of S uniform p-values ≤ 0.05) — why the extreme segment needs a correction. */
const minPRate = computed(() => 100 * (1 - Math.pow(0.95, segmentCount.value)))

const snippet = computed(
  () => `import { analyzeFieldReg } from '@mindpeeker/psi'

// segment boundaries and the number of analysis scales are registered first
const result = analyzeFieldReg(series, [
  { id: 'seg-1', startStep: 0, endStep: ${segments.value[0]?.endStep ?? 0} },
  /* … ${segmentCount.value} disjoint segments … */
], { statistic: '${statistic.value}', correction: '${correction.value}', scales: ${scales.value} })

console.log(result.extreme.pMin, result.extreme.pCorrected, result.extreme.pScale)
console.log(result.composite.stouffer, result.composite.chiSquare, result.composite.fisher)`,
)
</script>

<template>
  <DemoSection
    id="event-fieldreg"
    title="4 · FieldREG segments and the extreme-segment correction"
    description="The FieldREG claim is the most extreme of S pre-declared segments — which is a maximum over S tests, so it is corrected over the segments and again over the number of analysis scales you registered."
    :api="['analyzeFieldReg', 'FieldRegAnalysis.extreme', 'FieldRegAnalysis.composite']"
  >
    <template #controls>
      <UFormField label="Segments S">
        <UInputNumber v-model="segmentCount" :min="2" :max="12" class="w-28" />
      </UFormField>
      <UFormField label="Statistic" class="min-w-64">
        <USelect v-model="statistic" :items="STATISTICS" class="w-full" />
      </UFormField>
      <UFormField label="Correction" class="min-w-64">
        <USelect v-model="correction" :items="CORRECTIONS" class="w-full" />
      </UFormField>
      <UFormField label="Analysis scales" help="how many segmentations you registered">
        <UInputNumber v-model="scales" :min="1" :max="20" class="w-28" />
      </UFormField>
    </template>

    <ErrorAlert
      v-if="analysis.error"
      :err="analysis.error"
      :dismissible="false"
      title="analyzeFieldReg refused these segments"
    />

    <div v-if="analysis.ok" class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="extreme segment"
          :value="analysis.ok.extreme.id"
          size="sm"
          :note="`p_min ${fmtP(analysis.ok.extreme.pMin)} — before any correction`"
        />
        <StatTile label="corrected over S" size="sm">
          <template #value><PValue :p="analysis.ok.extreme.pCorrected" kind="family-wise" /></template>
          <template #note>{{ correction }} over {{ segmentCount }} segments</template>
        </StatTile>
        <StatTile label="corrected over scales" size="sm">
          <template #value><PValue :p="analysis.ok.extreme.pScale" kind="family-wise" /></template>
          <template #note>the same correction again over {{ scales }} registered scale(s)</template>
        </StatTile>
        <StatTile
          label="composite Stouffer"
          :value="analysis.ok.composite.stouffer.statistic"
          :digits="3"
          size="sm"
          :note="`p ${fmtP(analysis.ok.composite.stouffer.pValue)} — all segments, two-sided`"
        />
      </div>

      <BarChart
        v-if="bars"
        :categories="bars.categories"
        :values="bars.values"
        :highlight="bars.highlight"
        :expected="0"
        expected-label="chance (z = 0)"
        y-label="segment Stouffer z"
        :height="220"
        aria-label="Stouffer z per declared segment, the extreme one highlighted"
      />

      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse">
          <caption class="text-left text-xs text-muted pb-2">
            Segments must be disjoint and declared before looking; the composites cover all of them,
            so they are not a maximum and need no correction.
          </caption>
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" class="py-1.5 pr-3">segment</th>
              <th scope="col" class="py-1.5 pr-3">steps</th>
              <th scope="col" class="py-1.5 pr-3">trials</th>
              <th scope="col" class="py-1.5 pr-3">z</th>
              <th scope="col" class="py-1.5 pr-3">Σz²</th>
              <th scope="col" class="py-1.5 pr-3">p</th>
            </tr>
          </thead>
          <tbody class="font-mono tabular-nums">
            <tr
              v-for="segment in analysis.ok.segments"
              :key="segment.id"
              class="border-t border-default"
              :class="segment.id === analysis.ok.extreme.id ? 'text-warning' : ''"
            >
              <td class="py-1.5 pr-3 font-sans">{{ segment.label ?? segment.id }}</td>
              <td class="py-1.5 pr-3">{{ segment.startStep }}–{{ segment.endStep }}</td>
              <td class="py-1.5 pr-3">{{ segment.trials }}</td>
              <td class="py-1.5 pr-3">{{ fmtNum(segment.z, { digits: 3 }) }}</td>
              <td class="py-1.5 pr-3">{{ fmtNum(segment.chiSquare.statistic, { digits: 2 }) }}</td>
              <td class="py-1.5 pr-3">{{ fmtP(segment.pValue) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="composite Σz²"
          :value="analysis.ok.composite.chiSquare.statistic"
          :digits="2"
          size="sm"
          :note="`χ²(${analysis.ok.composite.chiSquare.df}) · p ${fmtP(analysis.ok.composite.chiSquare.pValue)}`"
        />
        <StatTile
          label="composite Fisher"
          :value="analysis.ok.composite.fisher.statistic"
          :digits="2"
          size="sm"
          :note="`χ²(${analysis.ok.composite.fisher.df}) · p ${fmtP(analysis.ok.composite.fisher.pValue)}`"
        />
        <StatTile label="device" :value="analysis.ok.source" size="sm" mono :note="`${analysis.ok.bitsPerTrial} bits per trial`" />
      </div>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <HonestNote variant="caveat">
      The original FieldREG record says only "appropriate correction for multiple sampling" — so the
      correction has to be named in the registration, along with the segment boundaries and how many
      segmentations were tried. Reporting p_min without the correction is the single easiest way to
      manufacture a result from noise: with {{ segmentCount }} segments, the smallest of
      {{ segmentCount }} uniform p-values is below 0.05 about
      {{ fmtNum(minPRate, { digits: 0 }) }} % of the time.
    </HonestNote>
  </DemoSection>
</template>
