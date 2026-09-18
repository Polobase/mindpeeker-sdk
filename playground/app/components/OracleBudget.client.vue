<script setup lang="ts">
/**
 * `expectedBytes` — how much entropy to budget for a deal, and what the actual
 * per-deal cost looks like when you measure it.
 */
import type { SpreadName } from '@mindpeeker/oracle'
import {
  castSpread,
  DEFAULT_CAST_CHUNK_BYTES,
  drawWithoutReplacement,
  expectedBytes,
  SPREADS,
} from '@mindpeeker/oracle'
import { fmtNum } from '~/lib/format'
import { clampInt } from '~/lib/oracle/exact'
import { bulkChunkBytes, repeatCasts } from '~/lib/oracle/loops'
import {
  defaultSampleSource,
  isNetworkSample,
  type SampleSourceId,
  sampleHint,
  sampleProvider,
  sampleSourceName,
  sampleSourceOptions,
} from '~/lib/oracle/sources'

interface Costs {
  readonly values: readonly number[]
  readonly expected: number
  readonly label: string
  readonly source: string
}

const MODES = [
  { value: 'spread', label: 'A tarot spread' },
  { value: 'deal', label: 'Any deal — { n, count }' },
] as const

const SPREAD_ITEMS = (Object.keys(SPREADS) as SpreadName[]).map((name) => ({
  value: name,
  label: SPREADS[name].name,
}))

const REVERSAL_ITEMS = [
  { value: 'off', label: 'no reversals' },
  { value: 'even', label: 'reversals: true — 1 bit per card' },
  { value: 'quarter', label: '{ reversed: 1, upright: 3 } — 2 bits per card' },
  { value: 'third', label: '{ reversed: 1, upright: 2 } — rejection-sampled' },
] as const

const RUNS = [
  { value: 200, label: '200 deals' },
  { value: 1000, label: '1 000 deals' },
] as const

const PRIMITIVES = [
  {
    name: 'uniformInt(reader, n)',
    claim: 'Exactly uniform on [0, n) by rejection sampling — never modulo alone.',
    used: 'every deal index, kau cim sticks, Mo and Homer dice',
  },
  {
    name: 'weightedIndex(bits, weights)',
    claim: 'Exact wᵢ/2ᵏ from k bits, no rejection — the flat Knuth–Yao case.',
    used: 'I-Ching lines, jiaobei throws, uniform astragaloi, dyadic reversals',
  },
  {
    name: 'weightedIndexRational(reader, weights)',
    claim: 'Exact wᵢ/W for any integer weights, via one uniformInt(W).',
    used: 'Hagström astragaloi 1:4:4:1, non-dyadic reversal rates',
  },
  {
    name: 'drawWithoutReplacement(reader, n, count)',
    claim: 'Unbiased Fisher–Yates prefix, O(count) memory for n up to 2³².',
    used: 'tarot deals, rune draws',
  },
  {
    name: 'bitReader(reader)',
    claim: 'MSB-first bits, SDK-wide; a fresh one per cast, so bits never leak between casts.',
    used: 'hexagrams, shields, odu, cowries',
  },
  {
    name: 'expectedBytes(spec, opts)',
    claim: 'The exact expectation Σ kₘ/αₘ (+ the orientation phase) as a float.',
    used: 'sizing a finite recorded batch before you cast from it',
  },
] as const

const mode = ref<'spread' | 'deal'>('spread')
const spreadName = ref<SpreadName>('celticCross')
const withSignificator = ref(false)
const reversalMode = ref<'off' | 'even' | 'quarter' | 'third'>('even')
const dealN = ref<number>(78)
const dealCount = ref<number>(10)
/** Cleared number inputs must never reach expectedBytes or the draw. */
const safeN = computed(() => clampInt(dealN.value, 1, 1_000_000, 78))
const safeCount = computed(() => clampInt(dealCount.value, 0, safeN.value, 1))
const runs = ref<number>(200)
const sample = ref<SampleSourceId>(defaultSampleSource())
const sourceItems = sampleSourceOptions()

const task = useTask<Costs>()
const costs = computed(() => task.result.value)

const reversals = computed(() => {
  if (reversalMode.value === 'off') return false
  if (reversalMode.value === 'even') return true
  if (reversalMode.value === 'quarter') return { reversed: 1, upright: 3 }
  return { reversed: 1, upright: 2 }
})

const spreadOptions = computed(() => ({
  reversals: reversals.value,
  ...(withSignificator.value ? { significator: 'm11' } : {}),
}))

const expectation = computed(() => {
  try {
    return mode.value === 'spread'
      ? expectedBytes(spreadName.value, spreadOptions.value)
      : expectedBytes({ n: safeN.value, count: safeCount.value })
  } catch {
    return undefined
  }
})

const label = computed(() =>
  mode.value === 'spread'
    ? `${SPREADS[spreadName.value].name}${withSignificator.value ? ' + significator' : ''}`
    : `${safeCount.value} of ${safeN.value}`,
)

function go(): void {
  const exact = expectation.value
  if (exact === undefined) return
  const isSpread = mode.value === 'spread'
  const spread = spreadName.value
  const opts = spreadOptions.value
  const n = safeN.value
  const drawCount = safeCount.value
  const text = label.value
  void task.run(async (signal, setProgress) => {
    const values: number[] = []
    setProgress(0)
    await repeatCasts(
      runs.value,
      async (reader) => {
        const before = reader.bytesConsumed
        if (isSpread) await castSpread(reader, spread, opts)
        else await drawWithoutReplacement(reader, n, drawCount)
        values.push(reader.bytesConsumed - before)
      },
      {
        signal,
        setProgress,
        source: sampleProvider(sample.value),
        chunkBytes: bulkChunkBytes(isNetworkSample(sample.value)),
      },
    )
    return { values, expected: exact, label: text, source: sampleSourceName(sample.value) }
  })
}

const stats = computed(() => {
  const values = costs.value?.values
  if (!values || values.length === 0) return undefined
  let sum = 0
  let min = Number.POSITIVE_INFINITY
  let max = 0
  for (const v of values) {
    sum += v
    if (v < min) min = v
    if (v > max) max = v
  }
  return { mean: sum / values.length, min, max, total: sum }
})

const histogramBins = computed(() => {
  const s = stats.value
  return s ? Math.max(1, Math.min(40, s.max - s.min + 1)) : 20
})
const histogramDomain = computed<[number, number] | undefined>(() => {
  const s = stats.value
  return s ? [s.min - 0.5, s.max + 0.5] : undefined
})

const bytesNeeded = computed(() => Math.ceil(runs.value * (expectation.value ?? 1)))

const code = computed(
  () => `import { expectedBytes } from '@mindpeeker/oracle'

${
  mode.value === 'spread'
    ? `expectedBytes('${spreadName.value}', ${JSON.stringify(spreadOptions.value)})`
    : `expectedBytes({ n: ${safeN.value}, count: ${safeCount.value} })`
}
// → ${expectation.value === undefined ? 'invalid' : fmtNum(expectation.value, { digits: 4 })} bytes on average.
// Size a finite recorded batch generously: the tail is geometric, so a deal
// CAN need more, and running out throws OracleError('insufficient_entropy').`,
)
</script>

<template>
  <DemoSection
    id="exactness-budget"
    title="How many bytes will this cost?"
    :api="['expectedBytes', 'castSpread', 'drawWithoutReplacement', 'DEFAULT_CAST_CHUNK_BYTES']"
    description="E[bytes] = Σ kₘ/αₘ over the deal, plus ⌈c·k/8⌉ for dyadic orientations or one rejection-sampled draw per card otherwise. It is the exact expectation of a random cost, not a bound — measure it and see."
  >
    <template #controls>
      <UFormField label="Spec" size="sm" class="w-full sm:w-52">
        <USelect v-model="mode" :items="MODES" class="w-full" />
      </UFormField>
      <template v-if="mode === 'spread'">
        <UFormField label="Spread" size="sm" class="w-full sm:w-56">
          <USelect v-model="spreadName" :items="SPREAD_ITEMS" class="w-full" />
        </UFormField>
        <UFormField label="Reversals" size="sm" class="w-full sm:w-72">
          <USelect v-model="reversalMode" :items="REVERSAL_ITEMS" class="w-full" />
        </UFormField>
        <div class="pb-1">
          <USwitch v-model="withSignificator" label="Significator (deal from 77)" size="sm" />
        </div>
      </template>
      <template v-else>
        <UFormField label="n" size="sm" class="w-32">
          <UInputNumber v-model="dealN" :min="1" :max="1000000" class="w-full" />
        </UFormField>
        <UFormField label="count" size="sm" class="w-28">
          <UInputNumber v-model="dealCount" :min="0" :max="Math.min(safeN, 500)" class="w-full" />
        </UFormField>
      </template>
      <UFormField label="Measure over" size="sm" class="w-full sm:w-44">
        <USelect v-model="runs" :items="RUNS" class="w-full" :disabled="task.busy.value" />
      </UFormField>
      <UFormField label="Sample from" size="sm" class="w-full sm:w-72">
        <USelect v-model="sample" :items="sourceItems" class="w-full" :disabled="task.busy.value" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Measure"
        icon="i-lucide-ruler"
        :disabled="expectation === undefined"
        :hint="sampleHint(sample, bytesNeeded)"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The measurement failed" @dismiss="task.reset()" />

    <div class="grid gap-3 sm:grid-cols-4">
      <StatTile
        label="expectedBytes"
        :value="expectation"
        :digits="4"
        tone="primary"
        :note="label"
      />
      <StatTile
        label="Observed mean"
        :value="stats?.mean"
        :digits="4"
        :note="costs ? `over ${costs.values.length} runs` : 'press Measure'"
      />
      <StatTile
        label="Observed range"
        :value="stats ? `${stats.min} – ${stats.max}` : undefined"
        note="the geometric tail is real"
      />
      <StatTile
        label="Cast chunk hint"
        :value="DEFAULT_CAST_CHUNK_BYTES"
        note="what a cast asks a ByteSource for"
      />
    </div>

    <div v-if="costs && stats" class="mt-4 flex flex-col gap-4">
      <Histogram
        :values="costs.values"
        :bins="histogramBins"
        :domain="histogramDomain"
        :markers="[
          { value: costs.expected, label: 'expectedBytes', color: 'primary' },
          { value: stats.mean, label: 'observed mean', color: 2, dashed: true },
        ]"
        x-label="bytes consumed per run"
        y-label="runs"
        :height="250"
        :aria-label="`distribution of the per-run byte cost for ${costs.label}`"
      />
      <p class="text-xs text-muted">
        {{ costs.label }} from <span class="font-mono">{{ costs.source }}</span> — total
        {{ fmtNum(stats.total) }} bytes over {{ costs.values.length }} runs. The spread of the
        histogram is rejection sampling: each draw retries with probability 1 − α, so the cost has a
        geometric tail and no hard upper bound.
      </p>
      <CodeSnippet :code="code" title="the exact expectation" />
    </div>

    <template #footer>
      Rune merkstave bits are deliberately <em>not</em> covered by <code>expectedBytes</code>: how
      many bits they cost depends on which runes were drawn.
    </template>
  </DemoSection>

  <DemoSection
    id="exactness-primitives"
    title="The four primitives everything is built from"
    :api="['uniformInt', 'weightedIndex', 'weightedIndexRational', 'drawWithoutReplacement', 'bitReader', 'expectedBytes']"
    description="Every system on this page is a thin layer over these. They are exported, so building your own system on the same guarantees means composing them rather than reimplementing them."
  >
    <div class="overflow-x-auto">
      <table class="w-full min-w-[42rem] text-sm">
        <caption class="sr-only">
          The exported core primitives and what each guarantees
        </caption>
        <thead class="text-xs uppercase tracking-wide text-muted">
          <tr class="border-b border-default">
            <th scope="col" class="py-1.5 text-left font-medium">Export</th>
            <th scope="col" class="py-1.5 text-left font-medium">What it guarantees</th>
            <th scope="col" class="py-1.5 text-left font-medium">Used by</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in PRIMITIVES" :key="row.name" class="border-b border-default/60">
            <td class="py-1.5 pe-3 align-top font-mono text-[12px] text-primary">{{ row.name }}</td>
            <td class="py-1.5 pe-3 align-top text-muted">{{ row.claim }}</td>
            <td class="py-1.5 align-top text-dimmed">{{ row.used }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <HonestNote variant="exact" title="What “exact” means here, precisely">
      Uniform bytes in ⇒ the stated probability out, with no floating-point threshold anywhere in
      the selection path. Feed biased bytes and the guarantee is void — condition them first (that
      is what <code>@mindpeeker/negentropy</code>'s extractors are for). And no cryptographic claim
      is made: this package maps entropy, it does not make it.
    </HonestNote>
  </DemoSection>
</template>
