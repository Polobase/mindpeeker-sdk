<script setup lang="ts">
/**
 * Haigh's non-uniformity lemma, made visible: slide a distribution toward
 * uniform and watch the match probability fall, monotonically, to its minimum.
 *
 * The identity is exact — averaging two probabilities x, y raises
 * P(all different) by n!·(x−y)²/4·e₍ₙ₋₂₎(rest) ≥ 0 — and the "average the two
 * largest" button prices exactly that step with the SDK.
 */
import { noMatchNonUniform } from '@mindpeeker/coincidence'
import { createYielder } from '~/lib/async'
import { unequal, unequalVector } from '~/lib/coincidence/state'
import { mixToUniform } from '~/lib/coincidence/vectors'
import { fmtNum } from '~/lib/format'

const STEPS = 21

const lambda = ref(0)

const parsed = computed(() => unequalVector.value)
const safeN = computed(() => Math.max(0, Math.trunc(Number(unequal.n) || 0)))
const ready = computed(() => !parsed.value.error && parsed.value.probs.length > 1)

interface LemmaResult {
  /** Match probability at λ = 0, 0.05, …, 1. */
  readonly y: number[]
  readonly x: number[]
  /** Match probability after averaging the two largest categories. */
  readonly averagedPair: number
  readonly baseline: number
  readonly uniform: number
}

const task = useTask<LemmaResult>()
const result = computed(() => task.result.value)

const atLambda = computed(() => {
  const r = result.value
  if (!r) return undefined
  const index = Math.round((lambda.value / 100) * (STEPS - 1))
  return r.y[Math.min(STEPS - 1, Math.max(0, index))]
})

function averageTwoLargest(probs: readonly number[]): number[] {
  const order = probs.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p)
  const first = order[0]
  const second = order[1]
  if (!first || !second) return [...probs]
  const out = [...probs]
  const mean = (first.p + second.p) / 2
  out[first.i] = mean
  out[second.i] = mean
  return out
}

function compute(): void {
  if (!ready.value) return
  const probs = parsed.value.probs as number[]
  const n = safeN.value
  const method = unequal.method
  void task.run(async (signal, setProgress) => {
    const tick = createYielder(8, signal)
    const x: number[] = []
    const y: number[] = []
    for (let i = 0; i < STEPS; i++) {
      const l = i / (STEPS - 1)
      x.push(l)
      y.push(noMatchNonUniform(n, mixToUniform(probs, l), { method }).match)
      setProgress((i + 1) / (STEPS + 1))
      await tick()
    }
    const averaged = noMatchNonUniform(n, averageTwoLargest(probs), { method }).match
    setProgress(1)
    return {
      x,
      y,
      averagedPair: averaged,
      baseline: y[0] as number,
      uniform: y[STEPS - 1] as number,
    }
  })
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [unequal.text, unequal.method, safeN.value] as const,
  () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(compute, 450)
  },
)
onMounted(compute)
onUnmounted(() => {
  if (timer !== undefined) clearTimeout(timer)
})

const series = computed(() => {
  const r = result.value
  if (!r) return []
  return [{ name: 'P(at least one match)', y: r.y, x: r.x, color: 3 as const }]
})

const monotone = computed(() => {
  const r = result.value
  if (!r) return true
  return r.y.every((value, index) => index === 0 || value <= (r.y[index - 1] as number) + 1e-12)
})

const code = computed(
  () => `import { noMatchNonUniform } from '@mindpeeker/coincidence'

// mix a fraction λ of the way to uniform: pᵢ(λ) = (1−λ)pᵢ + λ/c
const mixed = probs.map((p) => (1 - ${fmtNum(lambda.value / 100, { digits: 2 })}) * p + ${fmtNum(lambda.value / 100, { digits: 2 })} / probs.length)

noMatchNonUniform(${safeN.value}, probs).match  // ${result.value ? fmtNum(result.value.baseline, { digits: 8 }) : '…'}  your histogram
noMatchNonUniform(${safeN.value}, mixed).match  // ${atLambda.value === undefined ? '…' : fmtNum(atLambda.value, { digits: 8 })}  at λ = ${fmtNum(lambda.value / 100, { digits: 2 })}
// λ = 1 is the flat distribution, and it is the minimum:
// ${result.value ? fmtNum(result.value.uniform, { digits: 8 }) : '…'}`,
)
</script>

<template>
  <DemoSection
    id="lemma"
    title="The non-uniformity lemma"
    :level="3"
    :api="['noMatchNonUniform']"
    description="Slide the same histogram toward uniform. P(all different) rises monotonically, so the match probability falls — equal categories are the cheapest possible coincidence, and every unevenness makes matches more likely."
  >
    <template #controls>
      <UFormField
        label="λ — how far toward uniform"
        :hint="fmtNum(lambda / 100, { digits: 2 })"
        size="sm"
        class="w-full sm:w-80"
      >
        <USlider v-model="lambda" :min="0" :max="100" :step="5" class="mt-2" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Recompute"
        busy-label="Flattening…"
        icon="i-lucide-move-horizontal"
        @run="compute"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" title="The flattened vector was rejected" @dismiss="task.reset()" />

      <p v-if="!ready" class="text-sm text-muted">
        Paste at least two categories above and this section prices the whole path from your
        histogram to the flat one.
      </p>

      <div v-if="result" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="λ = 0 — your histogram"
          :value="result.baseline"
          :digits="6"
          tone="warning"
          :note="`P(match) for ${safeN} draws`"
        />
        <StatTile
          label="At the slider"
          :value="atLambda ?? null"
          :digits="6"
          tone="primary"
          :note="`λ = ${fmtNum(lambda / 100, { digits: 2 })}`"
        />
        <StatTile
          label="λ = 1 — flat"
          :value="result.uniform"
          :digits="6"
          note="the minimum over every distribution on these categories"
        />
        <StatTile
          label="Two largest averaged"
          :value="result.averagedPair"
          :digits="6"
          :note="`one step of the lemma: ${fmtNum(result.baseline - result.averagedPair, { digits: 6 })} cheaper`"
        />
      </div>

      <LineChart
        v-if="series.length"
        :series="series"
        :vlines="[{ value: lambda / 100, label: `λ = ${fmtNum(lambda / 100, { digits: 2 })}`, color: 'primary', dashed: false }]"
        x-label="λ — fraction of the way to uniform"
        y-label="P(at least one match)"
        :height="240"
        :format="(v) => fmtNum(v, { digits: 5 })"
        aria-label="Match probability against how far the distribution has been flattened toward uniform"
      />

      <div class="rounded-md border border-default bg-elevated/40 p-3 text-sm">
        <p>
          Averaging any two category probabilities x and y raises P(all different) by exactly
          <span class="font-mono">n!·(x−y)²/4·e₍ₙ₋₂₎(rest)</span>, which is ≥ 0 because every
          elementary symmetric polynomial of non-negative numbers is non-negative. Repeating that
          step drives any distribution to the flat one, so the flat one minimises matches. The SDK's
          tests check this identity in exact rational arithmetic on random vectors.
        </p>
        <p class="mt-2 text-muted">
          Curve monotone over the {{ STEPS }} sampled λ values:
          <UBadge :color="monotone ? 'success' : 'error'" variant="subtle" size="sm">
            {{ monotone ? 'yes' : 'no — report this' }}
          </UBadge>
        </p>
      </div>

      <CodeSnippet :code="code" title="what the slider ran" />
    </div>

    <template #footer>
      J. Haigh, <em>Taking Chances: Winning with Probability</em> (Oxford, 1999). The consequence
      for real data: any deviation from the idealised flat model — uneven birthdays, uneven word
      values, a favoured hexagram — makes coincidences <em>more</em> common than the textbook
      number, never less.
    </template>
  </DemoSection>
</template>
