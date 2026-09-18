<script setup lang="ts">
/**
 * Several attributes at once: people compare birthdays, towns and first names,
 * and a match in *any* of them counts.
 *
 * The attributes are independent, so the exact no-match probability on the
 * product space is just the product of the per-attribute products — and
 * Diaconis & Mosteller's harmonic-mean rule collapses them into one attribute
 * with H/k values. Both are shown, because the rule is off by half a person in
 * their own example.
 */
import { multiCategory, multiCategoryMatch, multiCategoryNoMatch } from '@mindpeeker/coincidence'
import type { RefLine } from '~/lib/chart'
import { multiCurve } from '~/lib/coincidence/curves'
import { fmtNum } from '~/lib/format'

interface Attribute {
  name: string
  c: number
}

const DM_EXAMPLE: readonly Attribute[] = [
  { name: 'birthday', c: 365 },
  { name: 'lottery ticket', c: 1000 },
  { name: 'theatre night', c: 500 },
]

const ORACLE_EXAMPLE: readonly Attribute[] = [
  { name: 'hexagram', c: 64 },
  { name: 'tarot card', c: 78 },
  { name: 'rune', c: 24 },
]

const attributes = ref<Attribute[]>(DM_EXAMPLE.map((a) => ({ ...a })))
const n = ref(16)
const target = ref(50)

const cs = computed(() =>
  attributes.value.map((attribute) => Math.max(1, Math.trunc(Number(attribute.c) || 1))),
)
const safeN = computed(() => Math.max(0, Math.trunc(Number(n.value) || 0)))
const p = computed(() => Math.min(0.999, Math.max(0.001, (Number(target.value) || 50) / 100)))

interface Outcome {
  summary: ReturnType<typeof multiCategory>
  match: number
  noMatch: number
  single: number
}

const outcome = computed<{ value?: Outcome; error?: unknown }>(() => {
  try {
    if (!cs.value.length) return { error: new Error('Add at least one attribute.') }
    const summary = multiCategory(cs.value, { p: p.value })
    return {
      value: {
        summary,
        match: multiCategoryMatch(safeN.value, cs.value),
        noMatch: multiCategoryNoMatch(safeN.value, cs.value),
        /** The exact single-attribute answer if only the first attribute were compared. */
        single: multiCategoryMatch(safeN.value, [cs.value[0] as number]),
      },
    }
  } catch (error) {
    return { error }
  }
})

const value = computed(() => outcome.value.value)

const curve = computed(() => {
  const v = value.value
  if (!v) return undefined
  const nMax = Math.max(8, Math.min(Math.min(...cs.value) + 1, Math.max(safeN.value + 4, Math.ceil(3.2 * v.summary.peopleApprox))))
  return multiCurve(cs.value, v.summary.effectiveCategories, nMax)
})

const series = computed(() => {
  const c = curve.value
  if (!c) return []
  return [
    { name: 'exact — product over the attributes', y: c.exact, x: c.x },
    {
      name: 'harmonic-mean rule — one attribute with H/k values',
      y: c.harmonic,
      x: c.x,
      color: 2 as const,
      dashed: true,
    },
  ]
})

const vlines = computed<RefLine[]>(() => {
  const v = value.value
  if (!v) return []
  return [
    { value: v.summary.peopleExact, label: `exact: ${v.summary.peopleExact}` },
    { value: safeN.value, label: `you: n = ${safeN.value}`, color: 'primary', dashed: false },
  ]
})

function addAttribute(): void {
  attributes.value.push({ name: `attribute ${attributes.value.length + 1}`, c: 100 })
}
function removeAttribute(index: number): void {
  attributes.value.splice(index, 1)
}
function load(preset: readonly Attribute[], draws: number): void {
  attributes.value = preset.map((a) => ({ ...a }))
  n.value = draws
}

const code = computed(
  () => `import { multiCategory, multiCategoryMatch } from '@mindpeeker/coincidence'

const cs = [${cs.value.join(', ')}]   // ${attributes.value.map((a) => a.name).join(', ')}

multiCategoryMatch(${safeN.value}, cs)  // ${fmtNum(value.value?.match ?? 0, { digits: 8 })}
multiCategory(cs, { p: ${fmtNum(p.value, { digits: 2 })} })
// { harmonicMean: ${fmtNum(value.value?.summary.harmonicMean ?? 0, { digits: 4 })},
//   effectiveCategories: ${fmtNum(value.value?.summary.effectiveCategories ?? 0, { digits: 4 })},
//   peopleApprox: ${fmtNum(value.value?.summary.peopleApprox ?? 0, { digits: 4 })},
//   peopleExact: ${value.value?.summary.peopleExact ?? '—'} }`,
)
</script>

<template>
  <DemoSection
    id="attributes"
    title="Several attributes — a match in any of them"
    :api="['multiCategory', 'multiCategoryMatch', 'multiCategoryNoMatch', 'MultiCategorySummary']"
    description="Independent attributes with c₁ … c_k values. The exact answer multiplies the per-attribute no-match products; the Diaconis–Mosteller rule replaces them all with one attribute holding H/k values, where H is the harmonic mean."
  >
    <template #controls>
      <UFormField label="n — people" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="n" :min="0" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Target p (%)" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="target" :min="1" :max="99" :step="5" class="w-full" />
      </UFormField>
      <UButton size="sm" variant="soft" color="neutral" @click="load(DM_EXAMPLE, 16)">
        D–M example (365 / 1000 / 500)
      </UButton>
      <UButton size="sm" variant="soft" color="neutral" @click="load(ORACLE_EXAMPLE, 10)">
        Three oracles (64 / 78 / 24)
      </UButton>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="The attribute list was rejected" />

      <div class="flex flex-col gap-2">
        <div
          v-for="(attribute, index) in attributes"
          :key="index"
          class="flex flex-wrap items-end gap-2 rounded-md border border-default bg-elevated/30 p-2"
        >
          <UFormField :label="`Attribute ${index + 1} — name`" size="sm" class="w-48">
            <UInput v-model="attribute.name" class="w-full" spellcheck="false" />
          </UFormField>
          <UFormField :label="`Attribute ${index + 1} — values`" size="sm" class="w-40">
            <UInputNumber v-model="attribute.c" :min="1" :step="1" class="w-full" />
          </UFormField>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-trash-2"
            class="mb-1"
            :aria-label="`Remove attribute ${index + 1}`"
            @click="removeAttribute(index)"
          />
        </div>
        <div>
          <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-plus" @click="addAttribute">
            Add an attribute
          </UButton>
        </div>
      </div>

      <div v-if="value" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="P(match in any attribute)"
          :value="value.match"
          :digits="6"
          tone="primary"
          :note="`${safeN} people, ${cs.length} attributes`"
        />
        <StatTile
          label="P(match in the first alone)"
          :value="value.single"
          :digits="6"
          :note="`only ${attributes[0]?.name ?? 'attribute 1'} compared`"
        />
        <StatTile
          label="People needed — exact"
          :value="value.summary.peopleExact"
          :digits="0"
          tone="warning"
          :note="`for p = ${fmtNum(p, { digits: 2 })}, inverting the exact product`"
        />
        <StatTile
          label="People needed — harmonic rule"
          :value="value.summary.peopleApprox"
          :digits="3"
          tone="info"
          note="√(2·(H/k)·ln(1/(1−p))) — D–M's 1.2√(H/k) at ½"
        />
      </div>

      <div v-if="value" class="grid gap-3 sm:grid-cols-3">
        <StatTile label="Harmonic mean H" :value="value.summary.harmonicMean" :digits="3" size="sm" note="k / Σ(1/cᵢ)" />
        <StatTile
          label="Effective categories H/k"
          :value="value.summary.effectiveCategories"
          :digits="3"
          size="sm"
          note="one attribute with this many values behaves alike to leading order"
        />
        <StatTile
          label="P(no match anywhere)"
          :value="value.noMatch"
          :digits="6"
          size="sm"
          note="the product of the per-attribute products"
        />
      </div>

      <LineChart
        v-if="series.length"
        :series="series"
        :hlines="[{ value: p, label: `p = ${fmtNum(p, { digits: 2 })}` }]"
        :vlines="vlines"
        :y-domain="[0, 1]"
        x-label="people n"
        y-label="P(match in at least one attribute)"
        :height="280"
        :format="(v) => fmtNum(v, { digits: 4 })"
        aria-label="Probability of a match in at least one attribute against the number of people, exact and harmonic-mean approximation"
      />

      <CodeSnippet :code="code" title="what this section ran" />

      <HonestNote variant="exact">
        Independence of the attributes is an assumption, and it is the only one: given it, the
        no-match events are independent too and the product is exact, not an approximation. With
        Diaconis &amp; Mosteller's own numbers — 365 birthdays, 1000 lottery tickets, 500 theatre
        nights — the harmonic rule gives 15.54 people and the exact inversion gives 16. In real
        comparisons the attributes are usually <em>not</em> independent (town and first name are
        correlated), and correlation makes matches more likely than this product says, not less.
      </HonestNote>
    </div>

    <template #footer>
      Diaconis &amp; Mosteller (1989), Problem 2: “the attributes act like one with 1/Σ(1/cₐ)
      values, so about 1.2√(H/k) people give an even chance.”
    </template>
  </DemoSection>
</template>
