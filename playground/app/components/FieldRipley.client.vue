<script setup lang="ts">
/**
 * Section 3 — Ripley's K with the four edge corrections and both
 * normalisations, on one chart, against the exact CSR reference K(r) = πr².
 */
import { MAX_EDGE_WEIGHT, ripleyK, ripleyL, type KCorrection, type KDenominator } from '@mindpeeker/field'
import type { LineSeries } from '~/lib/chart'
import { useFieldLab } from '~/lib/field/lab'
import { fmtNum } from '~/lib/format'

const { field } = useFieldLab()

const CORRECTIONS: readonly KCorrection[] = ['none', 'border', 'isotropic', 'translation']
const CORRECTION_NOTE: Record<KCorrection, string> = {
  none: 'no weight — boundary points lose neighbours outside W',
  border: 'reduced sample: only centres at least r from the boundary',
  isotropic: 'Ripley 1977: 2πd / |∂B(xᵢ, d) ∩ W|, clipped to [1, 100]',
  translation: 'Ohser 1983: A / |W ∩ (W + xⱼ − xᵢ)|, clipped at 100',
}
const DENOMINATORS = [
  { label: "A / n(n−1) — spatstat's Kest", value: 'n(n-1)' as KDenominator },
  { label: "A / n² — 0.1's ripleyL", value: 'n2' as KDenominator },
]

const denominator = ref<KDenominator>('n(n-1)')
const maxRadius = ref(20)

const STEPS = 30

const radii = computed(() => {
  const top = maxRadius.value
  return Array.from({ length: STEPS }, (_, i) => ((i + 1) * top) / STEPS)
})

/**
 * Four corrections at the chosen normalisation, plus the isotropic curve under
 * the other one — five O(n²) passes, ~90 ms at the largest field on offer, so
 * the section stays interactive without a worker.
 */
const curves = computed(() => {
  const f = field.value
  if (!f) return undefined
  const other: KDenominator = denominator.value === 'n2' ? 'n(n-1)' : 'n2'
  try {
    const main: Partial<Record<KCorrection, ReturnType<typeof ripleyK>>> = {}
    for (const c of CORRECTIONS) {
      main[c] = ripleyK(f.points, f.region, radii.value, {
        correction: c,
        denominator: denominator.value,
      })
    }
    return {
      main,
      alt: ripleyK(f.points, f.region, radii.value, {
        correction: 'isotropic',
        denominator: other,
      }),
      other,
    }
  } catch {
    return undefined
  }
})

/** [x, y] pairs with the NaNs dropped — `border` is undefined at large r. */
function pairs(x: Float64Array, y: Float64Array): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < x.length; i++) {
    const v = y[i] as number
    if (Number.isFinite(v)) out.push([x[i] as number, v])
  }
  return out
}

const series = computed<LineSeries[]>(() => {
  const c = curves.value
  if (!c) return []
  return CORRECTIONS.map((name, i) => {
    const k = c.main[name]
    return {
      name,
      points: k ? pairs(k.radii, k.centered) : [],
      color: (i + 1) as 1 | 2 | 3 | 4,
    }
  })
})

/** A handful of radii for the exact-vs-estimated table. */
const rows = computed(() => {
  const c = curves.value
  const a = c?.main.isotropic
  const b = c?.alt
  if (!c || !a || !b) return []
  const selected = denominator.value
  return [4, 9, 19, 24, 29]
    .filter((i) => i < a.radii.length)
    .map((i) => {
      const r = a.radii[i] as number
      const main = a.k[i] as number
      const alt = b.k[i] as number
      return {
        r,
        exact: Math.PI * r * r,
        n2: selected === 'n2' ? main : alt,
        nn1: selected === 'n2' ? alt : main,
      }
    })
})

const n = computed(() => field.value?.points.length ?? 0)

/**
 * The documented equivalence, computed rather than asserted:
 * `ripleyL(...)` is exactly `ripleyK(..., { correction: 'none', denominator: 'n2' }).centered`.
 */
const legacyGap = computed(() => {
  const f = field.value
  if (!f) return undefined
  try {
    const fixed = [2, 4, 6, 8, 10, 14]
    const l = ripleyL(f.points, f.region, fixed)
    const k = ripleyK(f.points, f.region, fixed, { correction: 'none', denominator: 'n2' }).centered
    let worst = 0
    for (let i = 0; i < l.length; i++) worst = Math.max(worst, Math.abs((l[i] as number) - (k[i] as number)))
    return worst
  } catch {
    return undefined
  }
})

const snippet = computed(
  () => `import { MAX_EDGE_WEIGHT, ripleyK } from '@mindpeeker/field'

const radii = [2, 4, 6, 8, 10, 14]
for (const correction of ['none', 'border', 'isotropic', 'translation'] as const) {
  const k = ripleyK(points, region, radii, { correction, denominator: '${denominator.value}' })
  k.k          // K̂(r) — πr² under CSR
  k.l          // L̂(r) = √(K̂(r)/π)
  k.centered   // L̂(r) − r, what the chart shows
}
MAX_EDGE_WEIGHT  // ${MAX_EDGE_WEIGHT} — spatstat's clip on an edge weight`,
)
</script>

<template>
  <DemoSection
    id="ripley"
    title="3 · Ripley's K — four edge corrections, two denominators"
    description="λK(r) is the expected number of further points within r of a typical point: πr² under CSR, so L̂(r) − r sits at 0. Points near the boundary have neighbours outside the window; each correction pays that back a different way."
    :api="['ripleyK', 'ripleyL', 'MAX_EDGE_WEIGHT']"
  >
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="K normalisation" size="sm">
        <USelect v-model="denominator" :items="DENOMINATORS" class="w-full" />
      </UFormField>
      <UFormField label="Largest radius" :hint="`r ≤ ${maxRadius}`" size="sm">
        <USlider v-model="maxRadius" :min="4" :max="40" :step="4" class="mt-2" />
      </UFormField>
      <StatTile
        label="Denominator ratio"
        :value="n > 1 ? n / (n - 1) : 1"
        :digits="4"
        size="sm"
        :note="`n/(n−1) at n = ${n} — exactly what A/n² removes from A/n(n−1)`"
      />
      <StatTile
        label="ripleyL vs ripleyK(none, n²)"
        size="sm"
        :value="legacyGap === undefined ? '—' : fmtNum(legacyGap, { digits: 1, exponential: legacyGap > 0 })"
        tone="success"
        note="largest |difference| over r = 2…14 — the two are the same estimator"
      />
    </div>

    <div v-if="curves" class="mt-4 flex flex-col gap-4">
      <LineChart
        :series="series"
        :hlines="[{ value: 0, label: 'CSR: L(r) = r', color: 'axis' }]"
        x-label="radius r"
        y-label="L̂(r) − r"
        :height="300"
        aria-label="Centered L function under four edge corrections"
      />

      <ul class="grid gap-2 sm:grid-cols-2 text-xs text-muted">
        <li v-for="(c, i) in CORRECTIONS" :key="c" class="flex items-start gap-2">
          <span
            class="mt-1 size-2.5 shrink-0 rounded-full"
            :style="{ background: `var(--viz-${i + 1})` }"
            aria-hidden="true"
          />
          <span><code class="font-mono text-primary">{{ c }}</code> — {{ CORRECTION_NOTE[c] }}</span>
        </li>
      </ul>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="py-1 text-left text-xs text-muted">
            Isotropic K̂(r) under both normalisations, against the exact CSR value πr².
          </caption>
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" class="py-1 pr-3 font-medium">r</th>
              <th scope="col" class="py-1 pr-3 font-medium">πr² (exact)</th>
              <th scope="col" class="py-1 pr-3 font-medium">K̂ with A/n²</th>
              <th scope="col" class="py-1 pr-3 font-medium">K̂ with A/n(n−1)</th>
              <th scope="col" class="py-1 font-medium">ratio</th>
            </tr>
          </thead>
          <tbody class="font-mono tabular-nums">
            <tr v-for="row in rows" :key="row.r" class="border-t border-default">
              <td class="py-1 pr-3">{{ fmtNum(row.r, { digits: 1 }) }}</td>
              <td class="py-1 pr-3 text-muted">{{ fmtNum(row.exact, { digits: 2 }) }}</td>
              <td class="py-1 pr-3">{{ fmtNum(row.n2, { digits: 2 }) }}</td>
              <td class="py-1 pr-3">{{ fmtNum(row.nn1, { digits: 2 }) }}</td>
              <td class="py-1 text-muted">{{ fmtNum(row.n2 === 0 ? 1 : row.nn1 / row.n2, { digits: 4 }) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <HonestNote variant="exact" title="What is asserted here">
      The weights are closed-form and exact for both window shapes (circle–rectangle areas, circle
      arcs inside a disk, and the lens of two disks), cross-checked against independent numerical
      quadrature and root finding, and they match spatstat's <code class="font-mono">Kest</code>
      definitions. What the curve does <em>not</em> come with is a test: a curve above zero is only
      evidence once it is ranked against simulated CSR fields — section 2.
    </HonestNote>

    <CodeSnippet class="mt-4" :code="snippet" title="what this section ran" />

    <template #footer>
      Two documented differences from spatstat: it reports <code class="font-mono">NA</code> beyond
      the radius where a correction is defined (translation: the shorter side; isotropic: the
      bounding radius), while <code class="font-mono">ripleyK</code> computes every radius and leaves
      the range to you; and spatstat approximates a disk window by a polygon, while the weights here
      are exact for disks. <code class="font-mono">border</code> drops radii with no eligible centre
      (they are simply missing from its line).
    </template>
  </DemoSection>
</template>
