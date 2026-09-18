<script setup lang="ts">
/**
 * Section 4a — Holm (family-wise, any dependence) and Benjamini–Hochberg
 * (false discovery rate) over an editable family of p-values.
 */
import { type AdjustedPValues, benjaminiHochberg, holm } from '@mindpeeker/psi'
import type { LineSeries } from '~/lib/chart'
import { fmtNum, fmtP } from '~/lib/format'

const raw = ref('0.0004, 0.006, 0.011, 0.028, 0.041, 0.055, 0.19, 0.33, 0.62, 0.88')
const alpha = ref(0.05)
const q = ref(0.1)

const parsed = computed<{ values: number[]; error?: string }>(() => {
  const tokens = raw.value.split(/[\s,;]+/).filter(Boolean)
  const values: number[] = []
  for (const token of tokens) {
    const value = Number(token)
    if (!Number.isFinite(value)) return { values: [], error: `“${token}” is not a number` }
    values.push(value)
  }
  if (values.length === 0) return { values: [], error: 'enter at least one p-value' }
  return { values }
})

function guard(fn: () => AdjustedPValues): { ok?: AdjustedPValues; error?: unknown } {
  try {
    return { ok: fn() }
  } catch (error) {
    return { error }
  }
}

const holmResult = computed(() => guard(() => holm(parsed.value.values, { alpha: alpha.value })))
const bhResult = computed(() => guard(() => benjaminiHochberg(parsed.value.values, { q: q.value })))

const rows = computed(() => {
  const values = parsed.value.values
  const h = holmResult.value.ok
  const b = bhResult.value.ok
  return values.map((p, i) => ({
    i,
    p,
    holm: h?.adjusted[i],
    holmRejected: h?.rejected[i] ?? false,
    bh: b?.adjusted[i],
    bhRejected: b?.rejected[i] ?? false,
  }))
})

const counts = computed(() => ({
  raw: parsed.value.values.filter((p) => p <= alpha.value).length,
  holm: holmResult.value.ok?.rejected.filter(Boolean).length ?? 0,
  bh: bhResult.value.ok?.rejected.filter(Boolean).length ?? 0,
}))

/** Sorted p against the Holm and BH step thresholds. */
const chart = computed<{ series: LineSeries[]; x: number[] } | undefined>(() => {
  const values = [...parsed.value.values].sort((a, b) => a - b)
  if (values.length < 2) return undefined
  const m = values.length
  const x = values.map((_, i) => i + 1)
  return {
    x,
    series: [
      { name: 'sorted p', y: values },
      {
        name: `Holm threshold α/(m−i+1), α = ${alpha.value}`,
        y: values.map((_, i) => alpha.value / (m - i)),
        color: 2,
        dashed: true,
      },
      {
        name: `BH threshold q·i/m, q = ${q.value}`,
        y: values.map((_, i) => (q.value * (i + 1)) / m),
        color: 3,
        dashed: true,
      },
    ],
  }
})

const snippet = computed(
  () => `import { benjaminiHochberg, holm } from '@mindpeeker/psi'

const p = [${parsed.value.values.slice(0, 6).join(', ')}${parsed.value.values.length > 6 ? ', /* … */' : ''}]
const fwer = holm(p, { alpha: ${alpha.value} })              // family-wise, any dependence
const fdr = benjaminiHochberg(p, { q: ${q.value} })          // false discovery rate, PRDS
console.log(fwer.adjusted, fwer.rejected, fwer.method)`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="multiplicity-adjust"
      title="1 · Holm and Benjamini–Hochberg"
      description="Twenty tests at α = 0.05 give a false positive about 64 % of the time. Holm controls the probability of any false positive; BH controls the expected share of false ones among the rejections. They answer different questions — pick one before looking."
      :api="['holm', 'benjaminiHochberg', 'AdjustedPValues']"
    >
      <template #controls>
        <UFormField
          label="p-values"
          help="comma, space or newline separated"
          class="w-full sm:w-[28rem]"
        >
          <UTextarea v-model="raw" :rows="3" class="w-full font-mono" />
        </UFormField>
        <UFormField label="Holm α">
          <UInputNumber v-model="alpha" :min="0.0001" :max="0.5" :step="0.01" class="w-28" />
        </UFormField>
        <UFormField label="BH q">
          <UInputNumber v-model="q" :min="0.0001" :max="0.5" :step="0.05" class="w-28" />
        </UFormField>
      </template>

      <UAlert
        v-if="parsed.error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Cannot read the family"
        :description="parsed.error"
      />
      <ErrorAlert :err="holmResult.error" :dismissible="false" title="holm refused this family" />
      <ErrorAlert
        :err="bhResult.error"
        :dismissible="false"
        title="benjaminiHochberg refused this family"
      />

      <div v-if="rows.length && holmResult.ok" class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="unadjusted p ≤ α"
            :value="`${counts.raw} / ${rows.length}`"
            tone="error"
            size="sm"
            note="what a reader sees when multiplicity is ignored"
          />
          <StatTile
            label="Holm rejections"
            :value="`${counts.holm} / ${rows.length}`"
            size="sm"
            :note="`FWER ≤ ${alpha}`"
          />
          <StatTile
            label="BH rejections"
            :value="`${counts.bh} / ${rows.length}`"
            size="sm"
            :note="`FDR ≤ ${q}`"
          />
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <caption class="text-left text-xs text-muted pb-2">
              Adjusted p-values are aligned with the input order, not the sorted one.
            </caption>
            <thead>
              <tr class="text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" class="py-1.5 pr-3">#</th>
                <th scope="col" class="py-1.5 pr-3">p</th>
                <th scope="col" class="py-1.5 pr-3">Holm</th>
                <th scope="col" class="py-1.5 pr-3">BH</th>
              </tr>
            </thead>
            <tbody class="font-mono tabular-nums">
              <tr v-for="row in rows" :key="row.i" class="border-t border-default">
                <td class="py-1.5 pr-3">{{ row.i + 1 }}</td>
                <td class="py-1.5 pr-3" :class="row.p <= alpha ? 'text-error' : ''">
                  {{ fmtP(row.p) }}
                </td>
                <td class="py-1.5 pr-3" :class="row.holmRejected ? 'text-warning' : 'text-muted'">
                  {{ fmtP(row.holm) }}
                  <span v-if="row.holmRejected" class="text-xs">✓</span>
                </td>
                <td class="py-1.5 pr-3" :class="row.bhRejected ? 'text-warning' : 'text-muted'">
                  {{ fmtP(row.bh) }}
                  <span v-if="row.bhRejected" class="text-xs">✓</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <LineChart
          v-if="chart"
          :series="chart.series"
          :x="chart.x"
          x-label="rank i (sorted ascending)"
          y-label="p"
          :height="240"
          :format="(v) => fmtNum(v, { digits: 4 })"
          aria-label="sorted p-values against the Holm and Benjamini-Hochberg step thresholds"
        />

        <CodeSnippet :code="snippet" title="what this section ran" />
      </div>

      <HonestNote variant="caveat">
        Adjusting after looking at which tests came out small is still cheating: the family has to
        be declared before the data, and that includes the hypotheses you decided not to report.
        Holm needs no assumption about dependence; Benjamini–Hochberg controls the FDR under
        independence or positive regression dependence (PRDS).
      </HonestNote>
    </DemoSection>

    <PsiEnvelope />
  </div>
</template>
