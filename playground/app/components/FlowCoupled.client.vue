<script setup lang="ts">
/** Section 1 — build a coupled pair and measure the flow both ways. */
import {
  entropyRate,
  mutualInformation,
  netTransferEntropy,
  shannonEntropy,
  transferEntropy,
} from '@mindpeeker/flow'
import type { Task } from '~/composables/useTask'
import { fmtBytes, fmtNum } from '~/lib/format'
import { bitStrip, bytesForBits, DRIVER_LAG_X, DRIVER_LAG_Y, nextBitTable } from '~/lib/flow/series'
import { biasFloor, cellCount, degreesOfFreedom, tupleCount } from '~/lib/flow/theory'
import { num } from '~/lib/flow/types'
import type { LabParams, LabSeries } from '~/lib/flow/types'

const props = defineProps<{
  params: LabParams
  series?: LabSeries
  task: Task<LabSeries>
}>()

const emit = defineEmits<{ draw: [] }>()

const SAMPLE_SIZES = [1000, 2000, 4000, 8000, 16000].map((n) => ({
  label: `${fmtNum(n, { digits: 0 })} symbols`,
  value: n,
}))
const HISTORIES = [1, 2, 3].map((v) => ({ label: String(v), value: v }))

/** Parameters that change the data, not just the measurement. */
const GENERATING = ['n', 'lag', 'coupling', 'noise', 'driver'] as const

const stale = computed(() => {
  const drawn = props.series?.params
  if (!drawn) return false
  return GENERATING.some((key) => num(drawn[key]) !== num(props.params[key]))
})

const drawBytes = computed(() => bytesForBits(num(props.params.n, 0)))

const stats = computed(() => {
  const s = props.series
  if (!s) return undefined
  // The measurement runs at the lag that was actually planted, so moving the
  // slider before redrawing cannot silently change what the numbers mean.
  const opts = {
    k: num(props.params.k, 1),
    l: num(props.params.l, 1),
    lag: s.params.lag,
    alphabet: 2,
    millerMadow: props.params.millerMadow === true,
  }
  const forward = transferEntropy(s.x, s.y, opts)
  const backward = transferEntropy(s.y, s.x, opts)
  const tuples = tupleCount(s.params.n, opts.k, opts.l, opts.lag)
  const df = degreesOfFreedom(2, 2, opts.k, opts.l)
  return {
    opts,
    forward,
    backward,
    net: netTransferEntropy(s.x, s.y, opts),
    mi: mutualInformation(s.x, s.y, { alphabet: 2, millerMadow: opts.millerMadow }),
    hx: shannonEntropy(s.x, { alphabet: 2 }),
    hy: shannonEntropy(s.y, { alphabet: 2 }),
    rate: entropyRate(s.y, { k: opts.k, alphabet: 2, millerMadow: opts.millerMadow }),
    tuples,
    df,
    cells: cellCount(2, 2, opts.k, opts.l),
    floor: biasFloor(df, tuples),
    strip: bitStrip(s.x, s.y, 240),
    table: nextBitTable(s.x, s.y, s.params.lag),
  }
})

const tone = computed(() => {
  const value = stats.value
  if (!value) return 'neutral' as const
  return value.forward > 10 * value.floor ? ('primary' as const) : ('neutral' as const)
})

const snippet = computed(() => {
  const p = props.series?.params ?? props.params
  const k = props.params.k
  const l = props.params.l
  return `import {
  mutualInformation, netTransferEntropy, symbolsFromBytes, transferEntropy,
} from '@mindpeeker/flow'

// X is the source's own bits, MSB-first; Y copies X from ${p.lag} step(s) back
// with probability ${(p.coupling / 100).toFixed(2)}.
const x = symbolsFromBytes(bytes, { alphabet: 2 })
const embedding = { k: ${k}, l: ${l}, lag: ${p.lag}, alphabet: 2 }

const forward = transferEntropy(x, y, embedding)   // TE X→Y, bits
const backward = transferEntropy(y, x, embedding)  // TE Y→X, bits
const net = netTransferEntropy(x, y, embedding)    // forward − backward
const mi = mutualInformation(x, y)                 // symmetric, and lag-blind`
})
</script>

<template>
  <DemoSection
    id="lab"
    title="1 · Coupled processes lab"
    :api="[
      'symbolsFromBytes',
      'xoshiro128ss',
      'transferEntropy',
      'netTransferEntropy',
      'mutualInformation',
      'entropyRate',
    ]"
  >
    <template #description>
      X is the selected source's bits. Y copies X from <code>lag</code> steps back with the coupling
      probability you set — and flips the copied bit with the noise probability — otherwise it takes
      a bit of its own. An optional common driver Z feeds X at lag {{ DRIVER_LAG_X }} and Y at lag
      {{ DRIVER_LAG_Y }}, which is what a confound looks like from the outside.
    </template>

    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Draw & measure"
        busy-label="Drawing…"
        icon="i-lucide-dices"
        :hint="`${fmtBytes(drawBytes)} from the selected source · ${params.n} bits for X, 4 bytes to seed the coupling coin`"
        @run="emit('draw')"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UFormField label="Samples per series" size="sm">
        <USelect v-model="params.n" :items="SAMPLE_SIZES" class="w-full" />
      </UFormField>
      <UFormField label="Coupling probability c" :hint="`${params.coupling}%`" size="sm">
        <USlider v-model="params.coupling" :min="0" :max="100" :step="5" class="mt-2" />
      </UFormField>
      <UFormField label="Copy lag L" :hint="`${params.lag} step${params.lag === 1 ? '' : 's'}`" size="sm">
        <USlider v-model="params.lag" :min="1" :max="8" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="Channel noise (bit flips)" :hint="`${params.noise}%`" size="sm">
        <USlider v-model="params.noise" :min="0" :max="50" :step="1" class="mt-2" />
      </UFormField>
      <UFormField
        label="Common driver Z"
        :hint="params.driver === 0 ? 'off' : `${params.driver}%`"
        description="Z → X at lag 1, Z → Y at lag 2"
        size="sm"
      >
        <USlider v-model="params.driver" :min="0" :max="100" :step="5" class="mt-2" />
      </UFormField>
      <div class="flex flex-wrap items-end gap-4">
        <UFormField label="k (dest. history)" size="sm">
          <USelect v-model="params.k" :items="HISTORIES" class="w-20" />
        </UFormField>
        <UFormField label="l (source history)" size="sm">
          <USelect v-model="params.l" :items="HISTORIES" class="w-20" />
        </UFormField>
        <USwitch v-model="params.millerMadow" label="Miller–Madow" class="pb-2" />
      </div>
    </div>

    <UAlert
      v-if="stale"
      color="warning"
      variant="subtle"
      icon="i-lucide-refresh-cw"
      title="The controls have moved past the drawn data"
      description="Samples, lag, coupling, noise and the driver only take effect on the next draw. k, l and Miller–Madow re-measure the series you already have."
      class="mt-4"
    />

    <div v-if="stats && series" class="mt-4 flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="TE X→Y"
          :value="stats.forward"
          :digits="4"
          :tone="tone"
          note="bits per symbol of Y"
        />
        <StatTile
          label="TE Y→X"
          :value="stats.backward"
          :digits="4"
          note="the direction nothing was planted in"
        />
        <StatTile label="net TE (X→Y − Y→X)" :value="stats.net" :digits="4" note="netTransferEntropy" />
        <StatTile
          label="I(X;Y)"
          :value="stats.mi"
          :digits="4"
          note="mutual information — symmetric, sees no direction"
        />
        <StatTile
          label="bias floor ≈ df / (2N ln2)"
          :value="stats.floor"
          :digits="5"
          tone="warning"
          :note="`df ${stats.df} · N ${fmtNum(stats.tuples, { digits: 0 })} tuples — what two independent streams score`"
        />
        <StatTile
          label="H(Yₜ₊₁ | Yₜᵏ)"
          :value="stats.rate"
          :digits="4"
          note="entropyRate — the uncertainty TE is allowed to remove"
        />
        <StatTile label="H(X)" :value="stats.hx" :digits="4" note="bits; 1.000 for fair bits" />
        <StatTile label="H(Y)" :value="stats.hy" :digits="4" note="bits" />
      </div>

      <div>
        <h3 class="text-sm font-medium text-highlighted">First 240 symbols</h3>
        <p class="mt-1 text-xs text-muted">
          X on the top row, Y below it. At a high coupling the rows look like one another shifted by
          {{ series.params.lag }} — which is exactly the structure the estimator prices.
        </p>
        <HeatmapCanvas
          class="mt-2"
          :data="stats.strip.data"
          :rows="stats.strip.rows"
          :cols="stats.strip.cols"
          :min="0"
          :max="1"
          :height="90"
          :legend="false"
          row-label="series"
          col-label="t"
          aria-label="First 240 symbols of X (top row) and Y (bottom row)"
          :format="(v: number) => (v === 1 ? '1' : '0')"
        />
      </div>

      <div>
        <h3 class="text-sm font-medium text-highlighted">
          p(Yₜ₊₁ = 1 | Yₜ, Xₜ₋ᵤ₊₁) — the four numbers transfer entropy compares
        </h3>
        <p class="mt-1 text-xs text-muted">
          TE is zero exactly when knowing X changes none of these. Under coupling the bars split into
          pairs by X's value.
        </p>
        <BarChart
          class="mt-2"
          :categories="stats.table.map((cell) => cell.label)"
          :values="stats.table.map((cell) => cell.p)"
          :expected="0.5"
          expected-label="0.5 — no information at all"
          y-label="p(next symbol = 1)"
          :height="220"
          aria-label="Conditional probability of the next symbol of Y given its own last symbol and X's"
          :format="(v: number) => v.toFixed(4)"
        />
      </div>

      <AccountingBadge
        :bytes-consumed="series.draw.bytes"
        :bits-used="series.draw.sourceBits"
        :source="series.draw.providerName"
      />

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <p v-else-if="!task.busy.value" class="text-sm text-muted">
      Draw a pair to measure it. Network sources wait for the button; the local CSPRNG starts on its
      own.
    </p>

    <template #footer>
      A positive TE X→Y is the expected reading here even at coupling 0 — the plug-in estimator is
      biased upward by about df / (2N ln2) bits. Compare every value with that floor, and with the
      surrogate null in the next section, before calling it flow.
    </template>
  </DemoSection>
</template>
