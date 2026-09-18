<script setup lang="ts">
/**
 * Unequal categories: the same coincidence, priced against a real histogram
 * instead of a flat one.
 *
 * The exact method costs n × categories, so a small vector is priced live and
 * anything larger — and every curve — goes through a chunked task with
 * progress and Cancel, never blocking the main thread for more than a slice.
 */
import {
  birthdayMatch,
  collisionProbability,
  NONUNIFORM_EXACT_LIMIT,
  noMatchNonUniform,
} from '@mindpeeker/coincidence'
import type { RefLine } from '~/lib/chart'
import { createYielder } from '~/lib/async'
import { drawGrid } from '~/lib/coincidence/curves'
import { DISTRIBUTION_PRESETS, gematriaProfileSummary } from '~/lib/coincidence/presets'
import { loadDistribution, unequal, unequalVector } from '~/lib/coincidence/state'
import { MAX_CATEGORIES, topCategories } from '~/lib/coincidence/vectors'
import { fmtNum } from '~/lib/format'

/** n × categories a keystroke may pay for before the task takes over. */
const LIVE_WORK = 200_000

const METHOD_ITEMS = [
  { label: 'auto — exact while n × categories ≤ 1e8', value: 'auto' },
  { label: 'exact — the symmetric-polynomial recursion', value: 'exact' },
  { label: 'second-order — the log expansion in power sums', value: 'second-order' },
  { label: 'poisson — first term only, exp(−C(n,2)·S₂)', value: 'poisson' },
]

const presetItems = computed(() => [
  ...DISTRIBUTION_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
  { label: 'Custom — your own numbers', value: 'custom' },
])

const parsed = computed(() => unequalVector.value)
const safeN = computed(() => Math.max(0, Math.trunc(Number(unequal.n) || 0)))
const support = computed(() => parsed.value.support)
const q = computed(() => (parsed.value.probs.length ? collisionProbability(parsed.value.probs) : 0))

const bars = computed(() => topCategories(parsed.value.probs, 40))

const gematria = computed(() => (unequal.presetId === 'gematria' ? gematriaProfileSummary() : undefined))

interface Point {
  uneven: number
  even: number
  method: string
}

function pointAt(n: number): Point {
  const result = noMatchNonUniform(n, parsed.value.probs as number[], { method: unequal.method })
  return { uneven: result.match, even: birthdayMatch(n, Math.max(1, support.value)), method: result.method }
}

/** Cheap enough to answer on every keystroke. */
const livePoint = computed<{ value?: Point; error?: unknown }>(() => {
  if (parsed.value.error || !parsed.value.probs.length) return {}
  if (safeN.value * support.value > LIVE_WORK) return {}
  try {
    return { value: pointAt(safeN.value) }
  } catch (error) {
    return { error }
  }
})

interface CurveResult {
  x: number[]
  uneven: number[]
  even: number[]
  point: Point
  method: string
}

const task = useTask<CurveResult>()
const curve = computed(() => task.result.value)

const point = computed(() => livePoint.value.value ?? curve.value?.point)

/** Past even odds there is nothing left to see; the support is a hard ceiling. */
const nMax = computed(() => {
  const even = q.value > 0 ? 1.1774 / Math.sqrt(q.value) : 20
  const want = Math.max(12, Math.ceil(3 * even), safeN.value + 2)
  return Math.max(2, Math.min(support.value + 1, 400, want))
})

function plot(): void {
  const probs = parsed.value.probs as number[]
  const method = unequal.method
  const c = Math.max(1, support.value)
  const n = safeN.value
  const grid = drawGrid(nMax.value, 90)
  void task.run(async (signal, setProgress) => {
    const tick = createYielder(8, signal)
    const uneven: number[] = []
    const even: number[] = []
    for (let i = 0; i < grid.length; i++) {
      const at = grid[i] as number
      uneven.push(noMatchNonUniform(at, probs, { method }).match)
      even.push(birthdayMatch(at, c))
      setProgress((i + 1) / (grid.length + 1))
      await tick()
    }
    const result = noMatchNonUniform(n, probs, { method })
    setProgress(1)
    return {
      x: grid,
      uneven,
      even,
      point: { uneven: result.match, even: birthdayMatch(n, c), method: result.method },
      method: result.method,
    }
  })
}

watch(
  () => unequal.presetId,
  (id) => {
    if (id !== 'custom') loadDistribution(id)
  },
)

let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [unequal.text, unequal.method, safeN.value] as const,
  () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      if (!parsed.value.error && parsed.value.probs.length) plot()
    }, 400)
  },
)
onMounted(() => {
  if (!parsed.value.error && parsed.value.probs.length) plot()
})
onUnmounted(() => {
  if (timer !== undefined) clearTimeout(timer)
})

/** Only mark n when the curve actually reaches it (the support is a hard ceiling). */
const vlines = computed<RefLine[]>(() => {
  const c = curve.value
  const top = c?.x[c.x.length - 1] ?? 0
  if (!c || safeN.value > top) return []
  return [{ value: safeN.value, label: `you: n = ${safeN.value}`, color: 'primary', dashed: false }]
})

const series = computed(() => {
  const c = curve.value
  if (!c) return []
  return [
    { name: 'your histogram — noMatchNonUniform', y: c.uneven, x: c.x },
    {
      name: `equal categories — birthdayMatch(n, ${support.value})`,
      y: c.even,
      x: c.x,
      color: 2 as const,
      dashed: true,
    },
  ]
})

const code = computed(() => {
  const head = parsed.value.raw.slice(0, 6).map((v) => fmtNum(v, { digits: 4 })).join(', ')
  const more = parsed.value.raw.length > 6 ? `, … ${parsed.value.raw.length} in all` : ''
  return `import {
  collisionProbability, noMatchNonUniform, probabilitiesFromCounts,
} from '@mindpeeker/coincidence'

const ${parsed.value.mode === 'counts' ? 'counts' : 'probs'} = [${head}${more}]
${parsed.value.mode === 'counts' ? 'const probs = probabilitiesFromCounts(counts)\n' : ''}
collisionProbability(probs)   // ${fmtNum(q.value, { digits: 8 })} — two draws coincide
1 / collisionProbability(probs) // ${fmtNum(q.value > 0 ? 1 / q.value : 0, { digits: 3 })} effective categories

const result = noMatchNonUniform(${safeN.value}, probs, { method: '${unequal.method}' })
result.match   // ${point.value ? fmtNum(point.value.uneven, { digits: 8 }) : '…'}
result.method  // '${point.value?.method ?? '…'}'`
})
</script>

<template>
  <DemoSection
    id="unequal"
    title="Unequal categories — every unevenness makes coincidences cheaper"
    :api="['collisionProbability', 'probabilitiesFromCounts', 'noMatchNonUniform', 'NONUNIFORM_EXACT_LIMIT']"
    description="Paste a histogram — counts or probabilities — and the exact probability that n draws from it collide, next to the flat distribution with the same number of categories."
  >
    <template #controls>
      <UFormField label="Distribution" size="sm" class="w-full sm:w-96">
        <USelect v-model="unequal.presetId" :items="presetItems" class="w-full" />
      </UFormField>
      <UFormField label="n — draws" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="unequal.n" :min="0" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Method" size="sm" class="w-full sm:w-80">
        <USelect v-model="unequal.method" :items="METHOD_ITEMS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Replot"
        busy-label="Pricing…"
        icon="i-lucide-line-chart"
        :hint="`${support} categories with p > 0`"
        @run="plot"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value ?? livePoint.error" title="noMatchNonUniform rejected that vector" @dismiss="task.reset()" />

      <UFormField
        label="Category weights — counts or probabilities, whitespace separated"
        size="sm"
        :help="`A vector summing to 1 is read as probabilities; anything else as counts. At most ${MAX_CATEGORIES} categories.`"
      >
        <UTextarea
          v-model="unequal.text"
          :rows="4"
          class="w-full font-mono"
          spellcheck="false"
          autocomplete="off"
          @update:model-value="unequal.presetId = 'custom'"
        />
      </UFormField>

      <div class="flex flex-wrap items-center gap-2">
        <UBadge color="neutral" variant="subtle">read as {{ parsed.mode }}</UBadge>
        <UBadge color="neutral" variant="outline">{{ parsed.raw.length }} entries</UBadge>
        <UBadge color="neutral" variant="outline">{{ support }} with p &gt; 0</UBadge>
        <UBadge v-if="parsed.mode === 'counts'" color="neutral" variant="outline">
          Σ = {{ fmtNum(parsed.sum, { digits: 0 }) }}
        </UBadge>
        <UBadge v-if="point" color="primary" variant="subtle">method: {{ point.method }}</UBadge>
      </div>

      <UAlert
        v-if="parsed.error"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="That vector cannot be priced"
        :description="parsed.error"
      />

      <div v-if="!parsed.error" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Collision probability q"
          :value="q"
          :digits="6"
          tone="primary"
          note="Σ pᵢ² — two draws land in the same category"
        />
        <StatTile
          label="Effective categories 1/q"
          :value="q > 0 ? 1 / q : null"
          :digits="2"
          note="a flat distribution with this many bins collides as often"
        />
        <StatTile
          label="P(match) — your histogram"
          :value="point?.uneven ?? null"
          :digits="6"
          tone="warning"
          :note="`${safeN} draws from the pasted weights`"
        />
        <StatTile
          label="P(match) — equal categories"
          :value="point?.even ?? null"
          :digits="6"
          :note="`birthdayMatch(${safeN}, ${support}) — the flat reference`"
        />
      </div>

      <div
        v-if="point"
        class="rounded-md border border-default bg-elevated/40 p-3 text-sm"
      >
        Unevenness is worth
        <span class="font-mono text-warning">{{ fmtNum(point.uneven - point.even, { digits: 6 }) }}</span>
        of extra match probability here — and that difference is never negative. Averaging two
        category probabilities x and y raises P(all different) by exactly
        <span class="font-mono">n!·(x−y)²/4·e₍ₙ₋₂₎(rest) ≥ 0</span>, so equal categories
        <em>minimise</em> coincidences (Haigh 1999). The lemma is demonstrated below.
      </div>

      <div class="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
        <p v-if="gematria">
          This is the value histogram of the bundled Sepher Sephiroth under Hechrachi:
          <span class="font-mono">{{ gematria.n }}</span> words over
          <span class="font-mono">{{ gematria.distinct }}</span> distinct values,
          q = <span class="font-mono">{{ fmtNum(gematria.collisionProbability, { digits: 6 }) }}</span>
          (Rényi-2 entropy {{ fmtNum(gematria.collisionEntropyBits, { digits: 3 }) }} bits),
          <span class="font-mono">{{ gematria.observedEqualPairs }}</span> equal pairs already in the
          entries and a birthday bound of
          <span class="font-mono">{{ fmtNum(gematria.birthdayBound50, { digits: 2 }) }}</span> draws.
          Ten random entries share a value with probability 0.3845; if the
          {{ gematria.distinct }} values were equally likely it would be 0.3314.
        </p>
        <p v-else>
          The worked case for this section is a gematria lexicon: how cheap is it that two Hebrew
          words share a value? Load its real value histogram and the answer is exact — and visibly
          cheaper than the flat idealisation.
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <UButton
            v-if="!gematria"
            size="xs"
            variant="soft"
            color="primary"
            icon="i-lucide-bar-chart-3"
            @click="loadDistribution('gematria')"
          >
            Load the gematria value histogram
          </UButton>
          <UButton to="/gematria" size="xs" variant="soft" color="primary" icon="i-lucide-scroll-text">
            Pricing a gematria coincidence — the gematria page
          </UButton>
        </div>
      </div>

      <BarChart
        v-if="bars.values.length"
        :categories="bars.labels"
        :values="bars.values"
        :expected="support > 0 ? 1 / support : 0"
        expected-label="flat 1/c"
        y-label="probability pᵢ"
        x-label="categories, largest first"
        :height="220"
        :format="(v) => fmtNum(v, { digits: 5 })"
        aria-label="Category probabilities, largest first, against the flat reference"
      />
      <p v-if="bars.truncated" class="text-xs text-muted -mt-2">
        Showing the 40 largest of {{ parsed.probs.length }} categories; every one of them is priced.
      </p>

      <LineChart
        v-if="series.length"
        :series="series"
        :hlines="[{ value: 0.5, label: '½' }]"
        :vlines="vlines"
        :y-domain="[0, 1]"
        x-label="draws n"
        y-label="P(at least one match)"
        :height="280"
        :format="(v) => fmtNum(v, { digits: 4 })"
        aria-label="Match probability against the number of draws, for the pasted histogram and for equal categories"
      />

      <CodeSnippet :code="code" title="what this section ran" />

      <HonestNote variant="caveat" title="A histogram is of one corpus, not of the world">
        The probabilities priced here are the ones you pasted. The bundled lexicon is a curated,
        value-indexed reference dictionary of 160 entries, not a random sample of Hebrew; real
        birthdays are not uniform either. The exact recursion answers the question you asked it —
        whether the histogram is the right null is a question about your data, not about the
        arithmetic. And a pair found by <em>searching</em> a corpus is priced by the search, not by
        one draw.
      </HonestNote>
    </div>

    <template #footer>
      The exact method is P(no match) = n!·eₙ(p₁ … p_c), an O(n·c) recursion over the categories,
      used while n × categories ≤ {{ fmtNum(NONUNIFORM_EXACT_LIMIT, { digits: 0 }) }}. Every step is
      a convex combination of non-negative terms, so a tiny match probability is not lost to 1 − P.
    </template>
  </DemoSection>
</template>
