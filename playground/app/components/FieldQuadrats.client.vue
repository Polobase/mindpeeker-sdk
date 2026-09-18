<script setup lang="ts">
/**
 * Section 4 — the two classical summaries: quadrat counts (a χ² on a grid)
 * and Clark–Evans (mean nearest-neighbour distance), with and without
 * Donnelly's boundary correction.
 */
import { clarkEvans, quadratTest } from '@mindpeeker/field'
import { errorLine } from '~/lib/errors'
import { useFieldLab } from '~/lib/field/lab'
import { flipCounts, quadratShape } from '~/lib/field/stats'
import { fmtNum } from '~/lib/format'

const { field, setOverlay } = useFieldLab()

const STATISTICS = [
  { label: "Pearson X² = Σ (O−E)²/E", value: 'pearson' as const },
  { label: 'likelihood ratio G² = 2 Σ O ln(O/E)', value: 'g2' as const },
]
const ALTERNATIVES = [
  { label: 'two.sided — 2·min(P_lo, P_up)', value: 'two.sided' as const },
  { label: 'clustered — upper tail', value: 'clustered' as const },
  { label: 'regular — lower tail', value: 'regular' as const },
]

const nx = ref(5)
const ny = ref(5)
const statistic = ref<'pearson' | 'g2'>('pearson')
const alternative = ref<'two.sided' | 'clustered' | 'regular'>('two.sided')
const donnelly = ref(true)

const quadrat = computed<{ ok?: ReturnType<typeof quadratTest>; error?: unknown }>(() => {
  const f = field.value
  if (!f) return {}
  try {
    return {
      ok: quadratTest(f.points, f.region, nx.value, ny.value, {
        statistic: statistic.value,
        alternative: alternative.value,
      }),
    }
  } catch (error) {
    return { error }
  }
})

const isRect = computed(() => field.value?.region.kind === 'rect')
const correctionUsable = computed(() => donnelly.value && isRect.value)

const evans = computed<{ plain?: ReturnType<typeof clarkEvans>; corrected?: ReturnType<typeof clarkEvans>; error?: unknown }>(() => {
  const f = field.value
  if (!f) return {}
  try {
    const plain = clarkEvans(f.points, f.region)
    return correctionUsable.value
      ? { plain, corrected: clarkEvans(f.points, f.region, { correction: 'donnelly' }) }
      : { plain }
  } catch (error) {
    return { error }
  }
})

const heat = computed(() => {
  const q = quadrat.value.ok
  if (!q) return undefined
  return flipCounts(q.counts, q.nx, q.ny)
})

const shape = computed(() => {
  const q = quadrat.value.ok
  if (!q) return undefined
  return quadratShape(q.counts, q.expected)
})

const usableCells = computed(() => {
  const q = quadrat.value.ok
  if (!q) return 0
  let out = 0
  for (const e of q.expected) if (e > 0) out++
  return out
})

watchEffect(() => {
  setOverlay('quadrats', [{ kind: 'grid', nx: nx.value, ny: ny.value, color: 6, label: 'quadrat grid' }])
})

onUnmounted(() => setOverlay('quadrats', undefined))

const snippet = computed(
  () => `import { clarkEvans, quadratTest } from '@mindpeeker/field'

const q = quadratTest(points, region, ${nx.value}, ${ny.value}, {
  statistic: '${statistic.value}',
  alternative: '${alternative.value}',
})
q.statistic       // ${statistic.value === 'pearson' ? 'X²' : 'G²'} on q.df = (cells with positive area) − 1
q.dispersionIndex // X²/(m−1): the variance-to-mean ratio of the counts, ≈ 1 under CSR
q.minExpected     // spatstat warns below 5 — the χ² reference is asymptotic

clarkEvans(points, region)                              // R = r̄_obs / r̄_exp, z, p
clarkEvans(points, region, { correction: 'donnelly' })  // rectangles only`,
)
</script>

<template>
  <DemoSection
    id="quadrats"
    title="4 · Quadrats and Clark–Evans"
    description="Two classical CSR summaries: counts on a grid against their exact clipped expectations E_c = n·|c ∩ W|/A, and the mean nearest-neighbour distance against 1/(2√λ)."
    :api="['quadratTest', 'clarkEvans']"
  >
    <UAlert
      v-if="quadrat.error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="quadratTest rejected these options"
      :description="errorLine(quadrat.error)"
      class="mb-4"
    />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="Columns nx" :hint="`${nx}`" size="sm">
        <USlider v-model="nx" :min="2" :max="12" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="Rows ny" :hint="`${ny}`" size="sm">
        <USlider v-model="ny" :min="2" :max="12" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="Statistic" size="sm">
        <USelect v-model="statistic" :items="STATISTICS" class="w-full" />
      </UFormField>
      <UFormField label="Alternative" size="sm">
        <USelect v-model="alternative" :items="ALTERNATIVES" class="w-full" />
      </UFormField>
    </div>

    <div v-if="quadrat.ok" class="mt-4 flex flex-col gap-4">
      <div class="grid gap-4 lg:grid-cols-2">
        <HeatmapCanvas
          :data="heat ?? []"
          :rows="quadrat.ok.ny"
          :cols="quadrat.ok.nx"
          :height="240"
          aria-label="Points per quadrat cell"
          row-label="y, top row = highest y"
          col-label="x"
          :format="(v) => fmtNum(v, { digits: 0 })"
        />
        <BarChart
          v-if="shape"
          :categories="shape.categories"
          :values="shape.observed"
          :expected="shape.expected"
          expected-label="Σ_c Poisson(k; E_c)"
          x-label="points in a cell"
          y-label="cells"
          :height="240"
          aria-label="Distribution of points per cell against its Poisson reference"
        />
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          :label="quadrat.ok.statisticName === 'pearson' ? 'Pearson X²' : 'Likelihood ratio G²'"
          :value="quadrat.ok.statistic"
          :digits="2"
          size="sm"
          :note="`df = ${quadrat.ok.df} · ${usableCells} cells with positive area`"
        />
        <StatTile label="χ² reference p" size="sm">
          <template #value><PValue :p="quadrat.ok.pValue" kind="pointwise" label="p" /></template>
          <template #note>{{ quadrat.ok.alternative }} · asymptotic, not exact</template>
        </StatTile>
        <StatTile
          label="Index of dispersion"
          :value="quadrat.ok.dispersionIndex"
          :digits="3"
          size="sm"
          :tone="quadrat.ok.dispersionIndex > 1.4 ? 'warning' : 'neutral'"
          note="X²/(m−1) = s²/x̄ for equal cells · 1 = CSR, > 1 clustered"
        />
        <StatTile label="Dispersion p" size="sm">
          <template #value><PValue :p="quadrat.ok.dispersionP" kind="pointwise" label="p" /></template>
          <template #note>two-sided χ²(m−1), Fisher–Thornton–Mackenzie 1922</template>
        </StatTile>
      </div>

      <UAlert
        v-if="quadrat.ok.minExpected < 5"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="The χ² approximation is thin here"
        :description="`Smallest expected cell count is ${fmtNum(quadrat.ok.minExpected, { digits: 2 })}; spatstat warns below 5. Use fewer cells, more points, or a Monte-Carlo test instead of reading this p literally.`"
      />
    </div>

    <div class="mt-6 flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-4">
        <h3 class="text-sm font-semibold text-highlighted">Clark–Evans nearest-neighbour test</h3>
        <USwitch v-model="donnelly" :disabled="!isRect" label="Donnelly boundary correction" />
        <span v-if="!isRect" class="text-xs text-muted">
          Donnelly is defined for rectangles only — on a disk window the SDK throws
          <code class="font-mono">invalid_config</code>, so the switch is disabled.
        </span>
      </div>

      <UAlert
        v-if="evans.error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="clarkEvans rejected this field"
        :description="errorLine(evans.error)"
      />

      <div v-if="evans.plain" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="R = r̄_obs / r̄_exp"
          :value="evans.plain.R"
          :digits="4"
          size="sm"
          :note="`uncorrected · < 1 clustered, > 1 regular`"
        />
        <StatTile label="z (uncorrected)" :value="evans.plain.z" :digits="3" size="sm" />
        <StatTile label="p (uncorrected)" size="sm">
          <template #value><PValue :p="evans.plain.pValue" kind="pointwise" label="p" /></template>
          <template #note>two-sided normal, SE = 0.26136 √A / n</template>
        </StatTile>
        <StatTile
          label="r̄ observed / expected"
          size="sm"
          :value="`${fmtNum(evans.plain.meanNearest, { digits: 3 })} / ${fmtNum(evans.plain.expectedNearest, { digits: 3 })}`"
          note="r̄_exp = 1/(2√λ)"
        />
        <template v-if="evans.corrected">
          <StatTile
            label="R (Donnelly)"
            :value="evans.corrected.R"
            :digits="4"
            size="sm"
            tone="primary"
            note="expectation gains (0.0514 + 0.0412/√n)·P/n"
          />
          <StatTile label="z (Donnelly)" :value="evans.corrected.z" :digits="3" size="sm" tone="primary" />
          <StatTile label="p (Donnelly)" size="sm" tone="primary">
            <template #value><PValue :p="evans.corrected.pValue" kind="pointwise" label="p" /></template>
            <template #note>same SE, corrected expectation</template>
          </StatTile>
          <StatTile
            label="Correction size"
            :value="evans.corrected.expectedNearest - evans.plain.expectedNearest"
            :digits="4"
            size="sm"
            note="added to r̄_exp — it is the uncorrected test that is biased toward ‘regular’"
          />
        </template>
      </div>
    </div>

    <HonestNote variant="caveat" title="Nearest-neighbour distance is blind to a small dense blob">
      Clark–Evans averages <em>every</em> point's nearest-neighbour distance, so a tight cluster of a
      few per cent of the points barely moves it while the attractor count, the L-function and the
      scan statistic all shout. Try the planted blob above: R usually stays within a few per cent of
      1 and its p above 0.2. One summary failing to react is not evidence of absence — it is a
      statistic answering a different question.
    </HonestNote>

    <CodeSnippet class="mt-4" :code="snippet" title="what this section ran" />

    <template #footer>
      Cell indices run row-major from the lower-left corner; a point on an interior edge belongs to
      the cell above/right of it. Degrees of freedom are (cells with positive area) − 1, because the
      intensity is estimated from the data. The SE uses Clark &amp; Evans's published 0.26136, where
      spatstat uses the exact √((4−π)/4π) = 0.261362…
    </template>
  </DemoSection>
</template>
