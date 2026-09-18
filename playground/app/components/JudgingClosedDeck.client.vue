<script setup lang="ts">
/**
 * The exact matching distribution of a shuffled pack, in integer arithmetic —
 * and the binomial curve it is so often mistaken for.
 *
 * `closedDeckMatchDistribution` builds the rook polynomial of the match board
 * and inclusion–excludes it in bigints; everything drawn here comes out of
 * those integers.
 */
import type { ClosedDeckDistribution, ClosedDeckTest } from '@mindpeeker/judging'
import {
  closedDeckMatchDistribution,
  closedDeckTest,
  compositionProbability,
  MAX_CLOSED_DECK_CARDS,
  MAX_CLOSED_DECK_RUN_CARDS,
} from '@mindpeeker/judging'
import { fmtNum, fmtP } from '~/lib/format'
import { binomialPmf, groupBigInt } from '~/lib/judging/math'
import { DECK_PRESETS, deckPreset, parseIntList } from '~/lib/judging/presets'

const CUSTOM = 'custom'

const presetId = ref('zener')
const countsText = ref('5, 5, 5, 5, 5')
const callMode = ref<'balanced' | 'single' | 'custom'>('balanced')
const callsText = ref('5, 5, 5, 5, 5')
const hits = ref(9)
const runs = ref(1)

const presetItems = computed(() => [
  ...DECK_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
  { label: 'Custom — type the pack composition', value: CUSTOM },
])

const callModeItems = [
  { label: 'Balanced — the same composition as the pack', value: 'balanced' },
  { label: 'One symbol only — every call the first symbol', value: 'single' },
  { label: 'Custom — type the call composition', value: 'custom' },
]

watch(presetId, (id) => {
  const preset = deckPreset(id)
  if (preset) countsText.value = preset.counts.join(', ')
})

const parsed = computed(() => parseIntList(countsText.value))
const counts = computed(() => parsed.value.values)
const cards = computed(() => counts.value.reduce((sum, n) => sum + n, 0))

const callCounts = computed<number[]>(() => {
  const pack = counts.value
  if (callMode.value === 'balanced') return pack.slice()
  if (callMode.value === 'single') return pack.map((_, i) => (i === 0 ? cards.value : 0))
  return parseIntList(callsText.value).values
})

watch([counts, callMode], () => {
  if (callMode.value === 'custom' && parseIntList(callsText.value).values.length !== counts.value.length) {
    callsText.value = counts.value.join(', ')
  }
})

const outcome = computed<{ dist?: ClosedDeckDistribution; error?: unknown }>(() => {
  try {
    return { dist: closedDeckMatchDistribution(counts.value, callCounts.value) }
  } catch (error) {
    return { error }
  }
})

const dist = computed(() => outcome.value.dist)

const test = computed<{ result?: ClosedDeckTest; error?: unknown }>(() => {
  try {
    return {
      result: closedDeckTest(Math.max(0, Math.trunc(Number(hits.value) || 0)), counts.value, {
        callCounts: callCounts.value,
        runs: Math.max(1, Math.trunc(Number(runs.value) || 1)),
      }),
    }
  } catch (error) {
    return { error }
  }
})

const composition = computed(() => {
  try {
    return compositionProbability(counts.value)
  } catch {
    return undefined
  }
})

/** The exact pmf next to the binomial with the same mean — the classic mix-up. */
const chart = computed(() => {
  const d = dist.value
  if (!d) return undefined
  const p = d.mean / d.cards
  const binomial = binomialPmf(d.cards, p)
  let top = d.pmf.length - 1
  while (top > 1 && (d.pmf[top] as number) < 1e-5 && (binomial[top] as number) < 1e-5) top--
  const categories: string[] = []
  const values: number[] = []
  const reference: number[] = []
  for (let k = 0; k <= top; k++) {
    categories.push(String(k))
    values.push(d.pmf[k] as number)
    reference.push(binomial[k] as number)
  }
  return { categories, values, reference, p }
})

/** The integer counts themselves, for packs small enough to print. */
const integerTable = computed(() => {
  const d = dist.value
  if (!d || d.cards > 12) return undefined
  return d.counts.map((count, k) => ({ k, count, p: d.pmf[k] as number }))
})

const inflation = computed(() => {
  const d = dist.value
  if (!d || !(d.variance > 0)) return undefined
  return Math.sqrt(d.variance / d.openDeckVariance) - 1
})

const code = computed(() => {
  const d = dist.value
  const t = test.value.result
  if (!d || !t) return ''
  return `import { closedDeckMatchDistribution, closedDeckTest } from '@mindpeeker/judging'

const pack  = [${d.symbolCounts.join(', ')}]
const calls = [${d.callCounts.join(', ')}]

const dist = closedDeckMatchDistribution(pack, calls)
dist.arrangements       // ${d.arrangements}n  distinct orders
dist.mean               // ${fmtNum(d.mean, { digits: 6 })}
dist.variance           // ${fmtNum(d.variance, { digits: 6 })}   sd ${fmtNum(d.sd, { digits: 6 })}
dist.openDeckVariance   // ${fmtNum(d.openDeckVariance, { digits: 6 })}   sd ${fmtNum(Math.sqrt(d.openDeckVariance), { digits: 6 })}
dist.counts[${t.hits}]           // ${d.counts[t.hits] ?? 0n}n  orders with exactly ${t.hits} matches

const test = closedDeckTest(${t.hits}, pack, { callCounts: calls, runs: ${t.runs} })
test.criticalRatio          // ${fmtNum(t.criticalRatio, { digits: 6 })}
test.openDeckCriticalRatio  // ${fmtNum(t.openDeckCriticalRatio, { digits: 6 })}
test.pOneSided              // ${fmtP(t.pOneSided)}`
})
</script>

<template>
  <DemoSection
    id="closed-deck"
    title="A shuffled pack is not independent draws"
    :api="['closedDeckMatchDistribution', 'closedDeckTest', 'compositionProbability']"
    description="Match a call sequence against a uniformly shuffled multiset pack. The count of orders with exactly k matches comes from the rook polynomial of the match board by inclusion–exclusion — an alternating sum, so it is done in bigints and only then divided."
  >
    <template #controls>
      <UFormField label="Pack" size="sm" class="w-full sm:w-80">
        <USelect v-model="presetId" :items="presetItems" class="w-full" />
      </UFormField>
      <UFormField label="Pack composition — copies of each symbol" size="sm" class="w-full sm:w-72">
        <UInput
          v-model="countsText"
          class="w-full font-mono"
          spellcheck="false"
          autocomplete="off"
          @update:model-value="presetId = CUSTOM"
        />
      </UFormField>
      <UFormField label="Calls" size="sm" class="w-full sm:w-80">
        <USelect v-model="callMode" :items="callModeItems" class="w-full" />
      </UFormField>
      <UFormField v-if="callMode === 'custom'" label="Call composition" size="sm" class="w-full sm:w-64">
        <UInput v-model="callsText" class="w-full font-mono" spellcheck="false" autocomplete="off" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="The pack was rejected" />

      <p v-if="parsed.bad.length" class="text-sm text-warning">
        Ignored, not integers: <span class="font-mono">{{ parsed.bad.join(' ') }}</span>
      </p>

      <div v-if="dist" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Cards" :value="dist.cards" :digits="0" :note="`limit ${MAX_CLOSED_DECK_CARDS}`" />
        <StatTile label="Exact mean" :value="dist.mean" :digits="4" note="Σ cₛ tₛ / N" />
        <StatTile
          label="Closed-deck SD"
          :value="dist.sd"
          :digits="6"
          tone="primary"
          note="from the integer counts"
        />
        <StatTile
          label="Open-deck SD"
          :value="Math.sqrt(dist.openDeckVariance)"
          :digits="6"
          tone="info"
          note="the shortcut: Σ cₛ fₛ(1 − fₛ)"
        />
      </div>

      <div v-if="dist" class="rounded-md border border-default bg-elevated/40 p-3 text-sm flex flex-col gap-1">
        <p>
          <span class="text-muted">Distinct target orders:</span>
          <span class="font-mono text-highlighted ml-1">{{ groupBigInt(dist.arrangements) }}</span>
          <span class="text-muted"> = N!/∏ tₛ! — all equally likely under H₀.</span>
        </p>
        <p v-if="dist.sd === 0">
          <span class="text-muted">The exact SD is</span>
          <span class="font-mono text-highlighted ml-1">0</span>
          <span class="text-muted">
            — these calls match this pack the same number of times in every possible order, so the
            score carries no information at all and no binomial can describe it. The open-deck
            shortcut would still print an SD of
            {{ fmtNum(Math.sqrt(dist.openDeckVariance), { digits: 4 }) }}.</span>
        </p>
        <p v-else-if="inflation !== undefined">
          <span class="text-muted">Using the open-deck SD inflates every critical ratio by</span>
          <span class="font-mono text-highlighted ml-1">{{ fmtNum(inflation * 100, { digits: 2 }) }} %</span>
          <span class="text-muted">
            — for the Zener pack that is the 2 % Epstein describes, and it always points the same
            way: towards ESP.</span>
        </p>
        <p v-if="composition !== undefined">
          <span class="text-muted">P(N independent uniform draws happen to give this exact
            composition) =</span>
          <span class="font-mono text-highlighted ml-1">{{ fmtNum(composition, { digits: 7 }) }}</span>
          <span class="text-muted">
            (<span class="font-mono">compositionProbability</span>) — an "i.i.d. pack" almost never
            looks like a real one, so the two nulls are genuinely different designs.</span>
        </p>
      </div>

      <BarChart
        v-if="chart"
        :categories="chart.categories"
        :values="chart.values"
        :expected="chart.reference"
        :expected-label="`Binomial(${cards}, ${fmtNum(chart.p, { digits: 4 })}) — the open-deck shortcut`"
        x-label="matches in one pass through the pack"
        y-label="probability"
        :height="280"
        :format="(v) => fmtNum(v, { digits: 6 })"
        aria-label="Exact closed-deck matching distribution with the binomial shortcut as reference ticks"
      />

      <p class="text-xs text-muted">
        The reference ticks are the binomial with the same mean. It is the exact open-deck null only
        when the pack is uniform and the calls are scored against independent draws; for an
        unbalanced pack the open-deck null is a Poisson-binomial and the ticks are indicative only.
        The SD comparison above uses the package's own
        <span class="font-mono">openDeckVariance</span>, which is exact in every case.
      </p>

      <div class="rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-highlighted">Score a total</h3>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Hits" size="sm" class="w-32">
            <UInputNumber v-model="hits" :min="0" :step="1" class="w-full" />
          </UFormField>
          <UFormField label="Runs (reshuffled packs)" size="sm" class="w-48">
            <UInputNumber v-model="runs" :min="1" :max="200" :step="1" class="w-full" />
          </UFormField>
          <p class="text-xs text-muted pb-2">
            One run is exact rational arithmetic; several runs convolve the run pmf (limit
            {{ MAX_CLOSED_DECK_RUN_CARDS.toLocaleString('en-US') }} cards in total).
          </p>
        </div>
        <ErrorAlert :err="test.error" title="The total was rejected" />
        <div v-if="test.result" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Expected total" :value="test.result.mean" :digits="3" />
          <StatTile label="SD of the total" :value="test.result.sd" :digits="5" />
          <StatTile label="Critical ratio (exact SD)" :value="test.result.criticalRatio" :digits="5" tone="primary" />
          <StatTile
            label="Critical ratio (open-deck SD)"
            :value="test.result.openDeckCriticalRatio"
            :digits="5"
            tone="warning"
            note="the inflated one"
          />
        </div>
        <div v-if="test.result" class="flex flex-wrap items-center gap-4">
          <PValue :p="test.result.pOneSided" kind="exact" label="P(total ≥ hits)" />
          <PValue :p="test.result.pLower" kind="exact" label="P(total ≤ hits)" />
        </div>
        <p class="text-sm text-muted">
          The default is the README's example: 9 hits in one Zener pack is
          <span class="font-mono">0.0504</span> exactly, while the binomial shortcut gives
          <span class="font-mono">0.0468</span> — the two land on opposite sides of 0.05, which is
          how a convention becomes a discovery.
        </p>
      </div>

      <div v-if="integerTable">
        <h3 class="text-sm font-semibold text-highlighted">The integer counts themselves</h3>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Matches k</th>
                <th class="text-right py-1.5 px-3 font-medium">Distinct orders</th>
                <th class="text-right py-1.5 pl-3 font-medium">Probability</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in integerTable" :key="row.k" class="border-t border-default">
                <td class="py-1 pr-3 font-mono tabular-nums">{{ row.k }}</td>
                <td class="py-1 px-3 text-right font-mono tabular-nums">{{ groupBigInt(row.count) }}</td>
                <td class="py-1 pl-3 text-right font-mono tabular-nums text-muted">
                  {{ fmtNum(row.p, { digits: 8 }) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <CodeSnippet :code="code" title="what these controls ran" />

      <HonestNote variant="exact">
        For the Zener pack the package reproduces Epstein's Table 11-1 exactly:
        623 360 743 125 120 orders, mean 5, variance 25/6 (SD 2.0412 against the binomial 2.000),
        P(24) = 0 — you cannot match exactly 24 of 25 — and P(25) = 1.604 × 10⁻¹⁵. Those are
        integers divided at the last step, not floating-point sums.
      </HonestNote>
    </div>

    <template #footer>
      Greville (1941); Riordan (1958), ch. 7–8 for rook polynomials; Epstein (2009), ch. 11. Try the
      "one symbol only" call mode: the mean does not move for a uniform pack, but the variance does
      — which is why the test takes the call composition instead of assuming it.
    </template>
  </DemoSection>
</template>
