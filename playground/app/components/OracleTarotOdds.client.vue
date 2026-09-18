<script setup lang="ts">
/**
 * Tarot — how big the deal space is, and whether a single-card deal really is
 * uniform over the 78 cards from this source.
 */
import { castSpread, expectedBytes, TAROT_DECK } from '@mindpeeker/oracle'
import { fmtNum } from '~/lib/format'
import { acceptance, expectedUniformBytes, fmtBig, orderedDeals } from '~/lib/oracle/exact'
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
import { goodnessOfFit, toFrequencies } from '~/lib/oracle/stats'

interface Tally {
  readonly cards: readonly number[]
  readonly reversed: number
  readonly deals: number
  readonly rate: number
  readonly bytesConsumed: number
  readonly source: string
}

const GROUPS = ['Majors', 'Wands', 'Cups', 'Swords', 'Pentacles'] as const
const GROUP_SIZES = [22, 14, 14, 14, 14] as const
const COUNTS = [
  { value: 200, label: '200 single-card deals' },
  { value: 1000, label: '1 000 deals' },
  { value: 5000, label: '5 000 deals' },
] as const
const RATES = [
  { value: 0, label: 'Upright only' },
  { value: 1, label: 'Reversed 1/2 — one bit per card' },
  { value: 2, label: 'Reversed 1/4 — two bits per card' },
  { value: 3, label: 'Reversed 1/3 — rejection-sampled (not dyadic)' },
] as const

const count = ref<number>(200)
const rate = ref<number>(1)
const sample = ref<SampleSourceId>(defaultSampleSource())
const sourceItems = sampleSourceOptions()
const task = useTask<Tally>()
const tally = computed(() => task.result.value)

/** The `reversals` option and its exact probability, chosen before the run. */
const reversalModel = computed(() => {
  if (rate.value === 0) return { option: false as const, p: 0, text: 'off' }
  if (rate.value === 1) return { option: true as const, p: 0.5, text: '1/2' }
  if (rate.value === 2) return { option: { reversed: 1, upright: 3 }, p: 0.25, text: '1/4' }
  return { option: { reversed: 1, upright: 2 }, p: 1 / 3, text: '1/3' }
})

const perDeal = computed(() =>
  expectedBytes('single', { reversals: reversalModel.value.option }),
)
const bytesNeeded = computed(() => Math.ceil(count.value * perDeal.value))

function go(): void {
  void task.run(async (signal, setProgress) => {
    const model = reversalModel.value
    const cards = new Array<number>(TAROT_DECK.length).fill(0)
    let reversed = 0
    const deals = count.value
    setProgress(0)
    const receipt = await repeatCasts(
      deals,
      async (reader) => {
        const cast = await castSpread(reader, 'single', { reversals: model.option })
        const drawn = cast.cards[0]
        if (!drawn) return
        cards[drawn.card.index] = (cards[drawn.card.index] as number) + 1
        if (drawn.reversed) reversed++
      },
      {
        signal,
        setProgress,
        source: sampleProvider(sample.value),
        chunkBytes: bulkChunkBytes(isNetworkSample(sample.value)),
      },
    )
    return {
      cards,
      reversed,
      deals,
      rate: model.p,
      bytesConsumed: receipt.bytesConsumed,
      source: sampleSourceName(sample.value),
    }
  })
}

const groupCounts = computed(() => {
  const counts = tally.value?.cards
  if (!counts) return [0, 0, 0, 0, 0]
  const out = [0, 0, 0, 0, 0]
  let index = 0
  GROUP_SIZES.forEach((size, g) => {
    for (let i = 0; i < size; i++) out[g] = (out[g] as number) + (counts[index++] as number)
  })
  return out
})
const groupProbs = GROUP_SIZES.map((size) => size / TAROT_DECK.length)
const groupFreq = computed(() => toFrequencies(groupCounts.value))
const cardFit = computed(() =>
  tally.value
    ? goodnessOfFit(tally.value.cards, new Array(TAROT_DECK.length).fill(1 / TAROT_DECK.length))
    : undefined,
)
const observedRate = computed(() =>
  tally.value && tally.value.deals > 0 ? tally.value.reversed / tally.value.deals : undefined,
)

const code = computed(
  () => `import { castSpread, expectedBytes } from '@mindpeeker/oracle'

// 78 cards, one dealt: uniformInt(78) accepts 234 of 256 byte values (α = ${fmtNum(acceptance(78), { digits: 4 })}),
// so one deal costs ${fmtNum(expectedUniformBytes(78), { digits: 3 })} bytes on average — plus the orientation draw.
const cast = await castSpread(reader, 'single', { reversals: ${JSON.stringify(reversalModel.value.option)} })
expectedBytes('single', { reversals: ${JSON.stringify(reversalModel.value.option)} })  // ${fmtNum(perDeal.value, { digits: 3 })}`,
)
</script>

<template>
  <DemoSection
    id="tarot-odds"
    title="Deal space and uniformity"
    :api="['castSpread', 'expectedBytes', 'drawWithoutReplacement', 'weightedIndexRational']"
    description="Every ordered deal is exactly equiprobable — which is a claim about the mapping, testable by dealing one card many times and looking at which cards come out."
  >
    <template #controls>
      <UFormField label="Deals" size="sm" class="w-full sm:w-56">
        <USelect v-model="count" :items="COUNTS" class="w-full" :disabled="task.busy.value" />
      </UFormField>
      <UFormField label="Reversal rate" size="sm" class="w-full sm:w-80">
        <USelect v-model="rate" :items="RATES" class="w-full" :disabled="task.busy.value" />
      </UFormField>
      <UFormField label="Sample from" size="sm" class="w-full sm:w-72">
        <USelect v-model="sample" :items="sourceItems" class="w-full" :disabled="task.busy.value" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Deal ${count} cards`"
        icon="i-lucide-bar-chart-3"
        :hint="sampleHint(sample, bytesNeeded)"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The run failed" @dismiss="task.reset()" />

    <div class="grid gap-3 sm:grid-cols-4">
      <StatTile
        label="Ordered Celtic Crosses"
        :value="fmtBig(orderedDeals(78, 10))"
        note="78!/68! — before orientations"
        size="sm"
      />
      <StatTile
        label="× orientations at 1/2"
        :value="fmtBig(orderedDeals(78, 10) * 1024n)"
        note="2¹⁰ per deal"
        size="sm"
      />
      <StatTile
        label="uniformInt(78) acceptance"
        :value="acceptance(78)"
        :digits="4"
        note="234 of 256 byte values"
        size="sm"
      />
      <StatTile
        label="Expected bytes / deal"
        :value="perDeal"
        :digits="3"
        note="exact expectation of the model"
        size="sm"
      />
    </div>

    <div v-if="tally" class="mt-4 flex flex-col gap-4">
      <BarChart
        :categories="GROUPS"
        :values="groupFreq"
        :expected="groupProbs"
        expected-label="exact 22/78 and 14/78"
        y-label="frequency"
        :height="240"
        :format="(v) => fmtNum(v, { digits: 4 })"
        aria-label="observed arcana-group frequencies against their exact probabilities"
      />

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Deals" :value="tally.deals" note="one card each" />
        <StatTile
          label="Reversed"
          :value="observedRate"
          :digits="4"
          :note="`exact ${reversalModel.text}`"
          :tone="rate === 0 ? 'neutral' : 'primary'"
        />
        <StatTile
          label="Bytes consumed"
          :value="tally.bytesConsumed"
          :note="`≈ ${fmtNum(perDeal, { digits: 2 })} per deal`"
        />
        <StatTile
          label="χ² over all 78 cards"
          :value="cardFit?.chi2"
          :note="`df = ${cardFit?.df ?? 0}`"
        />
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <PValue :p="cardFit?.p" kind="pointwise" label="χ² p" />
        <span class="text-xs text-muted">
          uniformity of the single dealt card over all 78, from
          <span class="font-mono">{{ tally.source }}</span>
        </span>
      </div>

      <HonestNote variant="caveat">
        This tests the <em>mapping and the source together</em>. A small p means the observed deals
        do not look uniform — which could be the source, the sample size, or (if it were ever
        broken) the deal. It says nothing about tarot. The bars are a chosen grouping of an
        assumed-uniform 78; the χ² above uses all 78 cells.
      </HonestNote>

      <CodeSnippet :code="code" title="what this button ran" />
    </div>

    <template #footer>
      Rejection is what costs the extra bytes: <code>uniformInt(78)</code> rejects 22 of 256 byte
      values, and a non-dyadic reversal rate such as 1/3 costs one more rejection-sampled draw per
      card. Exactness is not free, and the accounting shows the price.
    </template>
  </DemoSection>
</template>
