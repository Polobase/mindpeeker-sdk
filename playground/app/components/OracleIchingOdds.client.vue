<script setup lang="ts">
/**
 * I Ching — the exact line-value odds against observed frequencies. The odds
 * are dyadic, so `weightedIndex` realizes them from 3 or 4 bits with no
 * rejection at all.
 */
import type { LineMethod } from '@mindpeeker/oracle'
import { castHexagram, LINE_WEIGHTS } from '@mindpeeker/oracle'
import { fmtNum } from '~/lib/format'
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
  readonly method: LineMethod
  readonly counts: readonly number[]
  readonly hexagrams: number
  readonly bytesConsumed: number
  readonly bytesFetched: number
  readonly source: string
}

const LABELS = ['6 old yin', '7 young yang', '8 young yin', '9 old yang'] as const
const METHODS = [
  { value: 'coins', label: 'Three coins — 1 : 3 : 3 : 1 of 8' },
  { value: 'yarrow', label: 'Yarrow stalks — 1 : 5 : 7 : 3 of 16' },
] as const
const COUNTS = [
  { value: 60, label: '60 hexagrams — 360 lines' },
  { value: 240, label: '240 hexagrams — 1 440 lines' },
  { value: 1200, label: '1 200 hexagrams — 7 200 lines' },
  { value: 6000, label: '6 000 hexagrams — 36 000 lines' },
] as const

const method = ref<LineMethod>('coins')
const count = ref<number>(60)
const sample = ref<SampleSourceId>(defaultSampleSource())
const sourceItems = sampleSourceOptions()
const task = useTask<Tally>()
const tally = computed(() => task.result.value)

const bytesNeeded = computed(() => count.value * 3)

function go(): void {
  void task.run(async (signal, setProgress) => {
    const chosen = method.value
    const counts = [0, 0, 0, 0]
    const runs = count.value
    setProgress(0)
    const receipt = await repeatCasts(
      runs,
      async (reader) => {
        const cast = await castHexagram(reader, { method: chosen })
        for (const line of cast.lines) counts[line.value - 6] = (counts[line.value - 6] as number) + 1
      },
      {
        signal,
        setProgress,
        source: sampleProvider(sample.value),
        chunkBytes: bulkChunkBytes(isNetworkSample(sample.value)),
      },
    )
    return {
      method: chosen,
      counts,
      hexagrams: runs,
      bytesConsumed: receipt.bytesConsumed,
      bytesFetched: receipt.bytesFetched,
      source: sampleSourceName(sample.value),
    }
  })
}

const observed = computed(() => (tally.value ? toFrequencies(tally.value.counts) : [0, 0, 0, 0]))
const reference = computed(() => {
  const weights = LINE_WEIGHTS[tally.value?.method ?? method.value]
  const total = weights.reduce((a, b) => a + b, 0)
  return { weights, total, probs: weights.map((w) => w / total) }
})
const fit = computed(() =>
  tally.value ? goodnessOfFit(tally.value.counts, reference.value.probs) : undefined,
)

const code = computed(
  () => `import { castHexagram, byteReader, LINE_WEIGHTS } from '@mindpeeker/oracle'

const reader = byteReader(source)                 // one stream, many casts
const counts = [0, 0, 0, 0]
for (let i = 0; i < ${count.value}; i++) {
  const cast = await castHexagram(reader, { method: '${method.value}' })
  for (const line of cast.lines) counts[line.value - 6]++
}
await reader.close()
LINE_WEIGHTS['${method.value}']  // [${LINE_WEIGHTS[method.value].join(', ')}] — the exact null`,
)
</script>

<template>
  <DemoSection
    id="iching-odds"
    title="Line-value distribution"
    :api="['castHexagram', 'LINE_WEIGHTS', 'byteReader', 'weightedIndex']"
    description="Cast many hexagrams on one shared reader and compare the six-lines-per-cast frequencies with the exact weights. A frequency check can only fail an implementation — it can never validate a tradition."
  >
    <template #controls>
      <UFormField label="Model" size="sm" class="w-full sm:w-72">
        <USelect v-model="method" :items="METHODS" class="w-full" :disabled="task.busy.value" />
      </UFormField>
      <UFormField label="Casts" size="sm" class="w-full sm:w-64">
        <USelect v-model="count" :items="COUNTS" class="w-full" :disabled="task.busy.value" />
      </UFormField>
      <UFormField label="Sample from" size="sm" class="w-full sm:w-72">
        <USelect v-model="sample" :items="sourceItems" class="w-full" :disabled="task.busy.value" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Run ${count} casts`"
        icon="i-lucide-bar-chart-3"
        :hint="sampleHint(sample, bytesNeeded)"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The run failed" @dismiss="task.reset()" />

    <div v-if="tally" class="flex flex-col gap-4">
      <BarChart
        :categories="LABELS"
        :values="observed"
        :expected="reference.probs"
        :expected-label="`exact ${tally.method} odds`"
        y-label="frequency"
        x-label="line value"
        :height="260"
        :format="(v) => fmtNum(v, { digits: 4 })"
        :aria-label="`observed line-value frequencies against the exact ${tally.method} odds`"
      />

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="sr-only">
            Exact line odds against observed frequencies
          </caption>
          <thead class="text-xs uppercase tracking-wide text-muted">
            <tr class="border-b border-default">
              <th scope="col" class="py-1.5 text-left font-medium">Line</th>
              <th scope="col" class="py-1.5 text-right font-medium">Exact</th>
              <th scope="col" class="py-1.5 text-right font-medium">= p</th>
              <th scope="col" class="py-1.5 text-right font-medium">Observed</th>
              <th scope="col" class="py-1.5 text-right font-medium">Count</th>
            </tr>
          </thead>
          <tbody class="font-mono tabular-nums">
            <tr v-for="(label, i) in LABELS" :key="label" class="border-b border-default/60">
              <td class="py-1.5 font-sans text-highlighted">{{ label }}</td>
              <td class="py-1.5 text-right text-primary">
                {{ reference.weights[i] }}/{{ reference.total }}
              </td>
              <td class="py-1.5 text-right text-muted">
                {{ fmtNum(reference.probs[i], { digits: 4 }) }}
              </td>
              <td class="py-1.5 text-right text-highlighted">
                {{ fmtNum(observed[i], { digits: 4 }) }}
              </td>
              <td class="py-1.5 text-right text-muted">{{ fmtNum(tally.counts[i]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Lines drawn" :value="tally.hexagrams * 6" note="6 per cast" />
        <StatTile
          label="Bytes consumed"
          :value="tally.bytesConsumed"
          :note="`${tally.method === 'coins' ? 18 : 24} bits per cast, 3 bytes either way`"
        />
        <StatTile label="Bytes fetched" :value="tally.bytesFetched" note="what the source delivered" />
        <StatTile label="χ² goodness of fit" :value="fit?.chi2" :note="`df = ${fit?.df ?? 0}`" />
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <PValue :p="fit?.p" kind="pointwise" label="χ² p" />
        <span class="text-xs text-muted">
          against the exact {{ tally.method }} weights, from
          <span class="font-mono">{{ tally.source }}</span>
        </span>
      </div>

      <HonestNote variant="exact">
        Both tables are dyadic: <code>weightedIndex</code> reads exactly 3 bits (coins) or 4 bits
        (yarrow) per line and compares against integer cumulative sums — the flat case of the
        Knuth–Yao generating tree, optimal for dyadic targets, with no rejection and no floats. A
        large p above means no deviation was detected at this sample size; it is not evidence that
        anything is "working".
      </HonestNote>

      <CodeSnippet :code="code" title="what this button ran" />
    </div>

    <p v-else-if="!task.busy.value" class="text-sm text-muted">
      Press <strong>Run</strong>. The default of 60 casts finishes in well under a second and costs
      180 bytes.
    </p>

    <template #footer>
      Sharing one <code>byteReader</code> across casts is what makes the per-cast byte deltas
      meaningful — and the reader is closed on success, failure and cancellation alike.
    </template>
  </DemoSection>
</template>
