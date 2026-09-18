<script setup lang="ts">
/**
 * The birthday problem: n independent draws from c equally likely categories.
 *
 * Every number here is a closed form summed in log space, so the whole tab —
 * two curves, four inversions, six pinned reference values — recomputes in
 * microseconds on every keystroke. Nothing is simulated.
 */
import {
  birthdayApprox,
  birthdayMatch,
  birthdayNoMatch,
  peopleForMatch,
  peopleForMatchApprox,
} from '@mindpeeker/coincidence'
import type { RefLine } from '~/lib/chart'
import { birthdayCurve, birthdayRange } from '~/lib/coincidence/curves'
import { CATEGORY_PRESETS, categoryPreset } from '~/lib/coincidence/presets'
import { fmtNum } from '~/lib/format'

const CUSTOM = 'custom'

const presetId = ref('days')
const c = ref(365)
const n = ref(23)

const presetItems = computed(() => [
  ...CATEGORY_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
  { label: 'Custom — type a number of categories', value: CUSTOM },
])

watch(presetId, (id) => {
  const preset = categoryPreset(id)
  if (preset) c.value = preset.c
})
watch(c, (value) => {
  if (categoryPreset(presetId.value)?.c !== value) presetId.value = CUSTOM
})

const preset = computed(() => categoryPreset(presetId.value))
const safeC = computed(() => Math.max(1, Math.trunc(Number(c.value) || 1)))
const safeN = computed(() => Math.max(0, Math.trunc(Number(n.value) || 0)))

interface Outcome {
  match: number
  noMatch: number
  approxNoMatch: number
  n50: number
  n50Approx: number
  n95: number
  n95Approx: number
}

const outcome = computed<{ value?: Outcome; error?: unknown }>(() => {
  try {
    const cc = safeC.value
    const nn = safeN.value
    return {
      value: {
        match: birthdayMatch(nn, cc),
        noMatch: birthdayNoMatch(nn, cc),
        approxNoMatch: birthdayApprox(nn, cc),
        n50: peopleForMatch(0.5, cc),
        n50Approx: peopleForMatchApprox(0.5, cc),
        n95: peopleForMatch(0.95, cc),
        n95Approx: peopleForMatchApprox(0.95, cc),
      },
    }
  } catch (error) {
    return { error }
  }
})

const value = computed(() => outcome.value.value)

const curve = computed(() => {
  const cc = safeC.value
  const nMax = Math.max(birthdayRange(cc), Math.min(cc + 1, safeN.value + 2))
  return birthdayCurve(cc, nMax)
})

const series = computed(() => [
  { name: 'exact P(at least one match)', y: curve.value.exact, x: curve.value.x },
  {
    name: '1 − exp(−n(n−1)/2c) — pair-count approximation',
    y: curve.value.approx,
    x: curve.value.x,
    color: 2 as const,
    dashed: true,
  },
])

const vlines = computed<RefLine[]>(() => {
  const v = value.value
  if (!v) return []
  const top = curve.value.x[curve.value.x.length - 1] ?? 0
  const lines: RefLine[] = [{ value: v.n50, label: `n = ${v.n50} for ½` }]
  if (v.n95 <= top) lines.push({ value: v.n95, label: `n = ${v.n95} for 0.95` })
  lines.push({ value: safeN.value, label: `you: n = ${safeN.value}`, color: 'primary', dashed: false })
  return lines
})

/** Values printed in the README and the literature, recomputed live beside them. */
const PINNED: readonly { label: string; published: number; digits: number; compute: () => number; source: string }[] = [
  {
    label: 'birthdayMatch(23, 365) — the classic',
    published: 0.5072972343239854,
    digits: 16,
    compute: () => birthdayMatch(23, 365),
    source: 'README quick start',
  },
  {
    label: 'birthdayNoMatch(23, 365)',
    published: 0.4927027656760146,
    digits: 16,
    compute: () => birthdayNoMatch(23, 365),
    source: 'Haigh 1999',
  },
  {
    label: 'birthdayMatch(35, 365)',
    published: 0.8143832388747152,
    digits: 16,
    compute: () => birthdayMatch(35, 365),
    source: 'README: the popular “0.85” is wrong',
  },
  {
    label: 'birthdayMatch(10, 64) — a repeated hexagram',
    published: 0.5232407412578013,
    digits: 16,
    compute: () => birthdayMatch(10, 64),
    source: 'README quick start',
  },
  {
    label: 'peopleForMatch(0.5, 365)',
    published: 23,
    digits: 0,
    compute: () => peopleForMatch(0.5, 365),
    source: 'Diaconis & Mosteller eq. 7.3',
  },
  {
    label: 'peopleForMatch(0.95, 365)',
    published: 47,
    digits: 0,
    compute: () => peopleForMatch(0.95, 365),
    source: 'Diaconis & Mosteller eq. 7.4',
  },
]

const pinned = computed(() =>
  PINNED.map((entry) => {
    const live = entry.compute()
    return {
      ...entry,
      live,
      agrees: Math.abs(live - entry.published) <= 1e-12 * Math.max(1, Math.abs(entry.published)),
    }
  }),
)

const code = computed(
  () => `import {
  birthdayMatch, birthdayNoMatch, birthdayApprox,
  peopleForMatch, peopleForMatchApprox,
} from '@mindpeeker/coincidence'

const n = ${safeN.value}
const c = ${safeC.value}

birthdayMatch(n, c)          // ${fmtNum(value.value?.match ?? 0, { digits: 10 })}
birthdayNoMatch(n, c)        // ${fmtNum(value.value?.noMatch ?? 0, { digits: 10 })}
birthdayApprox(n, c)         // ${fmtNum(value.value?.approxNoMatch ?? 0, { digits: 10 })}  (approximates NO match)
peopleForMatch(0.5, c)       // ${value.value?.n50 ?? '—'}
peopleForMatchApprox(0.5, c) // ${fmtNum(value.value?.n50Approx ?? 0, { digits: 4 })}  = 1.1774·√c`,
)
</script>

<template>
  <DemoSection
    id="birthday"
    title="The birthday problem, exactly"
    :api="['birthdayMatch', 'birthdayNoMatch', 'birthdayApprox', 'peopleForMatch', 'peopleForMatchApprox']"
    description="n independent draws from c equally likely categories. P(all different) is ∏(1 − i/c), summed in log space so both tails keep full relative precision from c = 1 up to 2⁵³ − 1."
  >
    <template #controls>
      <UFormField label="Categories" size="sm" class="w-full sm:w-80">
        <USelect v-model="presetId" :items="presetItems" class="w-full" />
      </UFormField>
      <UFormField label="c — categories" size="sm" class="w-full sm:w-44">
        <UInputNumber v-model="c" :min="1" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="n — draws" size="sm" class="w-full sm:w-36">
        <UInputNumber v-model="n" :min="0" :step="1" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="The arguments were rejected" />

      <p v-if="preset" class="text-sm text-muted">
        One draw is one <strong>{{ preset.draw }}</strong> — {{ preset.note }}.
      </p>

      <div v-if="value" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="P(at least one match)"
          :value="value.match"
          :digits="6"
          tone="primary"
          :note="`${safeN} draws from ${fmtNum(safeC, { digits: 0 })} categories`"
        />
        <StatTile label="P(all different)" :value="value.noMatch" :digits="6" note="the exact product ∏(1 − i/c)" />
        <StatTile
          label="Pair-count approximation"
          :value="value.approxNoMatch"
          :digits="6"
          tone="info"
          note="birthdayApprox = exp(−n(n−1)/2c), of P(all different)"
        />
        <StatTile
          label="Approximation error"
          :value="value.approxNoMatch - value.noMatch"
          :digits="6"
          note="approximation − exact, on the no-match side"
        />
      </div>

      <div v-if="value" class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <div class="text-[11px] uppercase tracking-wide text-muted">Even odds</div>
          <p class="mt-1 text-sm">
            <span class="font-mono text-xl text-highlighted">{{ value.n50 }}</span>
            draws give P(match) ≥ ½ — exact inversion. Diaconis &amp; Mosteller's
            <span class="font-mono">1.1774·√c</span> gives
            <span class="font-mono">{{ fmtNum(value.n50Approx, { digits: 3 }) }}</span>
            (they round the multiplier to 1.2).
          </p>
        </div>
        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <div class="text-[11px] uppercase tracking-wide text-muted">95 % odds</div>
          <p class="mt-1 text-sm">
            <span class="font-mono text-xl text-highlighted">{{ value.n95 }}</span>
            draws give P(match) ≥ 0.95. The approximation
            <span class="font-mono">2.4477·√c</span> gives
            <span class="font-mono">{{ fmtNum(value.n95Approx, { digits: 3 }) }}</span>
            (rounded to 2.5 in the paper).
          </p>
        </div>
      </div>

      <LineChart
        :series="series"
        :hlines="[{ value: 0.5, label: '½' }, { value: 0.95, label: '0.95' }]"
        :vlines="vlines"
        :y-domain="[0, 1]"
        x-label="draws n"
        y-label="P(at least one match)"
        :height="300"
        :format="(v) => fmtNum(v, { digits: 4 })"
        aria-label="Probability of at least one match against the number of draws, exact and pair-count approximation"
      />

      <div>
        <h3 class="text-sm font-semibold text-highlighted">Published values, recomputed here</h3>
        <p class="mt-1 text-sm text-muted">
          Each row runs the SDK in your browser and prints the number the README or the source
          prints beside it. They are the same function, not a lookup table.
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
                  {{ row.digits === 0 ? row.live : row.live.toPrecision(16) }}
                </td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums text-muted">
                  {{ row.digits === 0 ? row.published : row.published.toPrecision(16) }}
                  <UIcon
                    v-if="row.agrees"
                    name="i-lucide-check"
                    class="size-3.5 text-success align-middle"
                    :aria-label="'agrees'"
                  />
                </td>
                <td class="py-1.5 pl-3 text-muted text-xs">{{ row.source }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <CodeSnippet :code="code" title="what these controls ran" />

      <HonestNote variant="exact">
        The product ∏(1 − i/c) is exact arithmetic under one explicit model: draws are independent
        and every category is equally likely. The match probability is formed as −expm1(ln P), so a
        one-in-a-billion match keeps its digits instead of being lost to 1 − P. The
        <em>model</em> is the approximation, not the computation: real birthdays are not uniform,
        and real casts are not always independent.
      </HonestNote>
    </div>

    <template #footer>
      Diaconis &amp; Mosteller (1989), Problem 1 and eqs. 7.1–7.4. Above 2048 draws the product
      switches to a rearranged Stirling series, so the large cancelling terms never meet.
    </template>
  </DemoSection>
</template>
