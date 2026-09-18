<script setup lang="ts">
/**
 * What chance alone gives the best of several looks — and what the best of
 * several looks therefore has to beat.
 */
import {
  closedDeckMatchDistribution,
  deflatedCriticalValue,
  expectedMaxOfLooks,
  expectedMaxOfPmf,
  maxOfLooksPValue,
} from '@mindpeeker/judging'
import type { LineSeries } from '~/lib/chart'
import { fmtNum, fmtP } from '~/lib/format'

const looks = ref(20)
const alpha = ref(0.05)
const sided = ref<'one' | 'two'>('one')
const bestZ = ref(2.4)
const pmfLooks = ref(3)

const alphaItems = [
  { label: 'α = 0.10', value: 0.1 },
  { label: 'α = 0.05 (default)', value: 0.05 },
  { label: 'α = 0.01', value: 0.01 },
  { label: 'α = 0.001', value: 0.001 },
]
const sidedItems = [
  { label: 'one-sided — the largest z', value: 'one' },
  { label: 'two-sided — the largest |z|', value: 'two' },
]

const safeLooks = computed(() => Math.max(1, Math.trunc(Number(looks.value) || 1)))

const expectation = computed(() => {
  try {
    return expectedMaxOfLooks(safeLooks.value)
  } catch {
    return undefined
  }
})

const critical = computed(() => {
  try {
    return deflatedCriticalValue(safeLooks.value, {
      alpha: Number(alpha.value),
      sided: sided.value,
    })
  } catch {
    return undefined
  }
})

const familyWise = computed(() => {
  try {
    return maxOfLooksPValue(Number(bestZ.value) || 0, safeLooks.value, { sided: sided.value })
  } catch {
    return undefined
  }
})

const singleLook = computed(() => {
  try {
    return maxOfLooksPValue(Number(bestZ.value) || 0, 1, { sided: sided.value })
  } catch {
    return undefined
  }
})

/** Computed once: the shape of E[max] and of the Šidák bar over I = 1…100. */
const curves = (() => {
  const x: number[] = []
  const exact: number[] = []
  const approximation: number[] = []
  const bound: number[] = []
  const bar: number[] = []
  for (let i = 1; i <= 100; i++) {
    const value = expectedMaxOfLooks(i)
    x.push(i)
    exact.push(value.exact)
    approximation.push(value.approximation ?? 0)
    bound.push(value.upperBound)
    bar.push(deflatedCriticalValue(i).z)
  }
  return { x, exact, approximation, bound, bar }
})()

const series = computed<LineSeries[]>(() => [
  { name: 'E[max of I standard normals] — exact', y: curves.exact, x: curves.x },
  {
    name: 'Bailey & López de Prado approximation',
    y: curves.approximation,
    x: curves.x,
    color: 2,
    dashed: true,
  },
  { name: '√(2 ln I) — the bound', y: curves.bound, x: curves.x, color: 3, dashed: true },
  { name: 'Šidák bar at α = 0.05, one-sided', y: curves.bar, x: curves.x, color: 4 },
])

/** The best of k looks at one Zener run, under the exact closed-deck pmf. */
const zenerPmf = closedDeckMatchDistribution([5, 5, 5, 5, 5]).pmf
const pmfTable = computed(() =>
  [1, 2, 3, 4, 5].map((k) => ({ k, expected: expectedMaxOfPmf(zenerPmf, k) })),
)
const pmfBest = computed(() => {
  try {
    return expectedMaxOfPmf(zenerPmf, Math.max(1, Math.trunc(Number(pmfLooks.value) || 1)))
  } catch {
    return undefined
  }
})

const PINNED: readonly { label: string; published: string; compute: () => number; digits: number }[] = [
  { label: 'expectedMaxOfLooks(2).exact = 1/√π', published: '0.5642', compute: () => expectedMaxOfLooks(2).exact, digits: 4 },
  { label: 'expectedMaxOfLooks(3).exact = 3/(2√π)', published: '0.8463', compute: () => expectedMaxOfLooks(3).exact, digits: 4 },
  { label: 'expectedMaxOfLooks(10).exact', published: '1.539', compute: () => expectedMaxOfLooks(10).exact, digits: 3 },
  { label: 'expectedMaxOfLooks(20).exact', published: '1.867', compute: () => expectedMaxOfLooks(20).exact, digits: 3 },
  { label: 'deflatedCriticalValue(20).z', published: '2.799', compute: () => deflatedCriticalValue(20).z, digits: 3 },
  {
    label: 'expectedMaxOfPmf(zenerPmf, 3)',
    published: '6.740',
    compute: () => expectedMaxOfPmf(zenerPmf, 3),
    digits: 3,
  },
]
const pinned = computed(() => PINNED.map((entry) => ({ ...entry, live: entry.compute() })))

const code = computed(() => {
  const e = expectation.value
  const c = critical.value
  if (!e || !c) return ''
  return `import {
  deflatedCriticalValue, expectedMaxOfLooks, expectedMaxOfPmf, maxOfLooksPValue,
} from '@mindpeeker/judging'

expectedMaxOfLooks(${e.looks}).exact          // ${fmtNum(e.exact, { digits: 6 })}
expectedMaxOfLooks(${e.looks}).approximation  // ${e.approximation === null ? 'null' : fmtNum(e.approximation, { digits: 6 })}
expectedMaxOfLooks(${e.looks}).upperBound     // ${fmtNum(e.upperBound, { digits: 6 })}  = √(2 ln I)

const bar = deflatedCriticalValue(${c.looks}, { alpha: ${c.alpha}, sided: '${c.sided}' })
bar.perLookAlpha  // ${fmtNum(c.perLookAlpha, { digits: 8 })}  = 1 − (1−α)^(1/I)
bar.z             // ${fmtNum(c.z, { digits: 6 })}
bar.bonferroniZ   // ${fmtNum(c.bonferroniZ, { digits: 6 })}

maxOfLooksPValue(${fmtNum(Number(bestZ.value) || 0, { digits: 3 })}, ${c.looks})  // ${fmtP(familyWise.value)}  family-wise`
})
</script>

<template>
  <DemoSection
    id="looks"
    title="Many analyses, one reported"
    :api="['expectedMaxOfLooks', 'deflatedCriticalValue', 'maxOfLooksPValue', 'expectedMaxOfPmf']"
    description="The best of I independent looks is not a typical look. Its expectation under the null is E_I, its family-wise p is 1 − (1 − p₁)^I, and the bar it must clear at level α is Šidák's, not 1.645."
  >
    <template #controls>
      <UFormField label="I — independent looks" size="sm" class="w-full sm:w-44">
        <UInputNumber v-model="looks" :min="1" :max="1000000" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Family-wise level" size="sm" class="w-full sm:w-44">
        <USelect v-model="alpha" :items="alphaItems" class="w-full" />
      </UFormField>
      <UFormField label="Sided" size="sm" class="w-full sm:w-64">
        <USelect v-model="sided" :items="sidedItems" class="w-full" />
      </UFormField>
      <UFormField label="Best look's z" size="sm" class="w-full sm:w-36">
        <UInputNumber v-model="bestZ" :step="0.1" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div v-if="expectation && critical" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="E[best of I] under the null"
          :value="expectation.exact"
          :digits="4"
          tone="warning"
          note="chance alone gives the best look this much"
        />
        <StatTile
          label="Approximation"
          :value="expectation.approximation ?? '—'"
          :digits="4"
          note="Bailey & López de Prado; ~2 % high at I = 10"
        />
        <StatTile label="√(2 ln I)" :value="expectation.upperBound" :digits="4" note="the classical bound" />
        <StatTile
          label="Šidák critical z"
          :value="critical.z"
          :digits="4"
          tone="primary"
          :note="`per-look α = ${fmtNum(critical.perLookAlpha, { digits: 6 })}; Bonferroni ${fmtNum(critical.bonferroniZ, { digits: 4 })}`"
        />
      </div>

      <div v-if="critical" class="rounded-md border border-default bg-elevated/40 p-3 flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-4">
          <span class="text-sm text-muted">Your best look, z = {{ fmtNum(Number(bestZ) || 0, { digits: 3 }) }}:</span>
          <PValue :p="singleLook" kind="pointwise" label="naive p" />
          <PValue :p="familyWise" kind="family-wise" label="best-of-I p" />
        </div>
        <p class="text-sm text-muted">
          {{
            (Number(bestZ) || 0) > critical.z
              ? 'That clears the bar for the best of I looks.'
              : 'That does not clear the bar for the best of I looks.'
          }}
          Reporting the naive p for a statistic you chose <em>because</em> it was the largest is the
          single most common way a chance result becomes a finding.
        </p>
      </div>

      <LineChart
        :series="series"
        :vlines="safeLooks <= 100 ? [{ value: safeLooks, label: `I = ${safeLooks}`, color: 'primary', dashed: false }] : []"
        x-label="number of independent looks I"
        y-label="z"
        :height="300"
        :format="(v) => fmtNum(v, { digits: 4 })"
        aria-label="Expected maximum of I standard normals, its approximation, the square-root bound, and the Šidák critical value, against I"
      />

      <p class="text-sm text-muted">
        The gap between the two solid curves is the honest margin: at I = 20 the best look averages
        {{ fmtNum(curves.exact[19] ?? 0, { digits: 3 }) }} under the null and must exceed
        {{ fmtNum(curves.bar[19] ?? 0, { digits: 3 }) }} to be significant at α = 0.05 — while a
        single pre-registered look only has to beat 1.645.
      </p>

      <div class="rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-highlighted">
          The same trap with a discrete score: the best of k displacements
        </h3>
        <p class="text-sm text-muted">
          <span class="font-mono">expectedMaxOfPmf</span> takes any discrete pmf — here the exact
          closed-deck distribution of one Zener run — and returns the expected best of k independent
          looks at it. Scoring offsets −1, 0 and +1 and reporting the best is three looks.
        </p>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="k — looks at one run" size="sm" class="w-36">
            <UInputNumber v-model="pmfLooks" :min="1" :max="20" :step="1" class="w-full" />
          </UFormField>
          <StatTile
            label="Expected best score"
            :value="pmfBest"
            :digits="4"
            size="sm"
            tone="warning"
            note="chance is 5 hits per run"
          />
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Looks k</th>
                <th class="text-right py-1.5 pl-3 font-medium">E[best of k] hits per run</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in pmfTable" :key="row.k" class="border-t border-default">
                <td class="py-1 pr-3 font-mono tabular-nums">{{ row.k }}</td>
                <td class="py-1 pl-3 text-right font-mono tabular-nums">{{ fmtNum(row.expected, { digits: 4 }) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-muted">
          Three looks give 6.740 instead of 5 — Epstein's figure. The displacement scores of one run
          are not strictly independent, so this is the independent-looks baseline, which is the
          comparison Epstein uses.
        </p>
      </div>

      <div>
        <h3 class="text-sm font-semibold text-highlighted">Published values, recomputed here</h3>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Call</th>
                <th class="text-right py-1.5 px-3 font-medium">Computed now</th>
                <th class="text-right py-1.5 pl-3 font-medium">Published</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in pinned" :key="row.label" class="border-t border-default">
                <td class="py-1.5 pr-3 font-mono text-xs">{{ row.label }}</td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">{{ fmtNum(row.live, { digits: row.digits }) }}</td>
                <td class="py-1.5 pl-3 text-right font-mono tabular-nums text-muted">{{ row.published }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <CodeSnippet :code="code" title="what these controls ran" />

      <HonestNote variant="caveat">
        Šidák's correction assumes the looks are independent. Overlapping windows, adjacent
        displacements and nested models are positively dependent, which makes the correction
        conservative — not wrong, but not tight either. And no correction can rescue a look you did
        not count: the denominator has to include the analyses you tried and abandoned.
      </HonestNote>
    </div>

    <template #footer>
      Šidák (1967); Bailey &amp; López de Prado (2014) for the deflated threshold; Epstein (2009),
      p. 422 for the 6.74. The quadrature reaches a relative error below 1e-12, and the closed forms
      E₂ = 1/√π and E₃ = 3/(2√π) check it.
    </template>
  </DemoSection>
</template>
