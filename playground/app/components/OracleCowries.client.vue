<script setup lang="ts">
/**
 * Sixteen cowries (merindinlogun) — sixteen fair bits, so the number of shells
 * that fall mouth up is exactly Binomial(16, 1/2).
 */
import type { CowrieCast } from '@mindpeeker/oracle'
import { castCowries, COWRIE_ODU } from '@mindpeeker/oracle'
import { fmtNum } from '~/lib/format'
import { sourceSummary, withReader } from '~/lib/entropy'
import { bulkChunkBytes, repeatCasts } from '~/lib/oracle/loops'
import {
  autoRunAllowed,
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
  readonly counts: readonly number[]
  readonly casts: number
  readonly bytesConsumed: number
  readonly source: string
}

const COUNTS = [
  { value: 200, label: '200 casts — 400 bytes' },
  { value: 1000, label: '1 000 casts — 2 KiB' },
  { value: 10000, label: '10 000 casts — 20 KiB' },
] as const

const TOTAL_PATTERNS = 65536
const EXACT = COWRIE_ODU.map((odu) => odu.ways / TOTAL_PATTERNS)
const CATEGORIES = COWRIE_ODU.map((odu) => String(odu.count))

const summary = sourceSummary()
const task = useTask<CowrieCast>()
const cast = computed(() => task.result.value)

const count = ref<number>(200)
const sample = ref<SampleSourceId>(defaultSampleSource())
const sourceItems = sampleSourceOptions()
const bulk = useTask<Tally>()
const tally = computed(() => bulk.result.value)

function go(): void {
  void task.run((signal) => withReader((reader) => castCowries(reader), { signal }))
}

function goBulk(): void {
  void bulk.run(async (signal, setProgress) => {
    const counts = new Array<number>(17).fill(0)
    const casts = count.value
    setProgress(0)
    const receipt = await repeatCasts(
      casts,
      async (reader) => {
        const result = await castCowries(reader)
        counts[result.up] = (counts[result.up] as number) + 1
      },
      {
        signal,
        setProgress,
        source: sampleProvider(sample.value),
        chunkBytes: bulkChunkBytes(isNetworkSample(sample.value)),
      },
    )
    return {
      counts,
      casts,
      bytesConsumed: receipt.bytesConsumed,
      source: sampleSourceName(sample.value),
    }
  })
}

const observed = computed(() => (tally.value ? toFrequencies(tally.value.counts) : []))
const fit = computed(() => (tally.value ? goodnessOfFit(tally.value.counts, EXACT) : undefined))
const castProbability = computed(() =>
  cast.value ? cast.value.odu.ways / TOTAL_PATTERNS : undefined,
)

const code = `import { castCowries, COWRIE_ODU } from '@mindpeeker/oracle'

const cast = await castCowries(source)   // exactly 16 bits, 2 bytes
cast.up                                  // shells mouth up, 0–16
cast.odu.name                            // Bascom's odu for that count
cast.odu.ways / 65536                    // P(this count) — C(16, k) / 2¹⁶ exactly`

onMounted(() => {
  if (autoRunAllowed()) go()
})
</script>

<template>
  <DemoSection
    id="cowries-cast"
    title="Cast sixteen cowries"
    :api="['castCowries', 'COWRIE_ODU', 'bitReader']"
    description="One fair bit per shell, sixteen of them: the count that lands mouth up names the odu. Unlike the 256 odu of Ifá, these seventeen outcomes are not equally likely — 8 up happens 12 870 times in 65 536, 0 or 16 up exactly once each."
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        label="Cast"
        busy-label="Casting…"
        icon="i-lucide-shell"
        :hint="`exactly 2 bytes from ${summary.providerName}`"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The cast failed" @dismiss="task.reset()" />

    <div v-if="cast" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-1.5">
        <span
          v-for="(up, i) in cast.shells"
          :key="i"
          class="grid size-6 place-items-center rounded-full border text-[10px] font-mono"
          :class="
            up
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-default bg-elevated/40 text-dimmed'
          "
          :title="`shell ${i + 1}: mouth ${up ? 'up' : 'down'}`"
        >
          {{ i + 1 }}
        </span>
      </div>

      <div class="flex flex-wrap items-baseline gap-3">
        <h3 class="text-xl font-semibold text-highlighted">{{ cast.odu.name }}</h3>
        <span class="text-sm text-muted">{{ cast.up }} of 16 mouth up</span>
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Mouth up" :value="cast.up" note="the odu index, 0–16" />
        <StatTile
          label="Patterns with this count"
          :value="cast.odu.ways"
          note="C(16, k) of 65 536"
        />
        <StatTile
          label="P(this count)"
          :value="castProbability"
          :digits="5"
          tone="primary"
          note="exact: ways / 2¹⁶"
        />
        <StatTile label="Bits used" :value="cast.bitsUsed" note="always 16" />
      </div>

      <AccountingBadge
        :bytes-consumed="cast.bytesConsumed"
        :bytes-fetched="cast.bytesFetched"
        :bits-used="cast.bitsUsed"
        :source="summary.providerName"
      />

      <CodeSnippet :code="code" title="what this button ran" />
    </div>

    <template #footer>
      Names are Bascom's <em>Sixteen Cowries</em> (1980) chapter titles; they vary between houses and
      in the diaspora (Lucumí <em>diloggun</em> usage differs). Real cowries are not fair coins — no
      measured face probability is used anywhere.
    </template>
  </DemoSection>

  <DemoSection
    id="cowries-odds"
    title="Binomial(16, ½), exactly"
    :api="['castCowries', 'COWRIE_ODU', 'byteReader']"
    description="Cast many times and compare the seventeen observed frequencies with C(16, k)/65 536. The tails are genuinely rare: Opira and Irete are 1 in 65 536 each, so at these sample sizes they will usually be absent — which is what the exact model predicts."
  >
    <template #controls>
      <UFormField label="Casts" size="sm" class="w-full sm:w-56">
        <USelect v-model="count" :items="COUNTS" class="w-full" :disabled="bulk.busy.value" />
      </UFormField>
      <UFormField label="Sample from" size="sm" class="w-full sm:w-72">
        <USelect v-model="sample" :items="sourceItems" class="w-full" :disabled="bulk.busy.value" />
      </UFormField>
      <RunControls
        :busy="bulk.busy.value"
        :progress="bulk.progress.value"
        :label="`Run ${count} casts`"
        icon="i-lucide-bar-chart-3"
        :hint="sampleHint(sample, count * 2)"
        @run="goBulk"
        @cancel="bulk.cancel()"
      />
    </template>

    <ErrorAlert :err="bulk.error.value" title="The run failed" @dismiss="bulk.reset()" />

    <div v-if="tally" class="flex flex-col gap-4">
      <BarChart
        :categories="CATEGORIES"
        :values="observed"
        :expected="EXACT"
        expected-label="exact Binomial(16, ½)"
        x-label="shells mouth up"
        y-label="frequency"
        :height="260"
        :label-every="1"
        :format="(v) => fmtNum(v, { digits: 4 })"
        aria-label="observed cowrie counts against the exact binomial probabilities"
      />

      <div class="overflow-x-auto">
        <table class="w-full min-w-[30rem] text-sm">
          <caption class="sr-only">
            Odu names, exact probabilities and observed frequencies
          </caption>
          <thead class="text-xs uppercase tracking-wide text-muted">
            <tr class="border-b border-default">
              <th scope="col" class="py-1.5 text-left font-medium">Up</th>
              <th scope="col" class="py-1.5 text-left font-medium">Odu</th>
              <th scope="col" class="py-1.5 text-right font-medium">Ways</th>
              <th scope="col" class="py-1.5 text-right font-medium">Exact p</th>
              <th scope="col" class="py-1.5 text-right font-medium">Observed</th>
            </tr>
          </thead>
          <tbody class="tabular-nums">
            <tr v-for="odu in COWRIE_ODU" :key="odu.count" class="border-b border-default/60">
              <td class="py-1 font-mono text-highlighted">{{ odu.count }}</td>
              <td class="py-1 text-muted">{{ odu.name }}</td>
              <td class="py-1 text-right font-mono text-dimmed">{{ fmtNum(odu.ways) }}</td>
              <td class="py-1 text-right font-mono text-primary">
                {{ fmtNum(odu.ways / TOTAL_PATTERNS, { digits: 5 }) }}
              </td>
              <td class="py-1 text-right font-mono text-highlighted">
                {{ fmtNum(observed[odu.count], { digits: 5 }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile label="Casts" :value="tally.casts" note="2 bytes each" />
        <StatTile label="Bytes consumed" :value="tally.bytesConsumed" note="16 bits per cast" />
        <StatTile
          label="χ² goodness of fit"
          :value="fit?.chi2"
          :note="`df = ${fit?.df ?? 0}${fit?.pooled ? ' — rare tails pooled' : ''}`"
        />
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <PValue :p="fit?.p" kind="pointwise" label="χ² p" />
        <span class="text-xs text-muted">
          against C(16, k)/65 536, from <span class="font-mono">{{ tally.source }}</span>
        </span>
      </div>

      <HonestNote variant="exact">
        Sixteen independent fair bits are dyadic, so there is no rejection anywhere:
        <code>bytesConsumed</code> is exactly 2 and <code>bitsUsed</code> exactly 16, every time.
        Cells whose expected count falls below 5 are pooled before the χ² — the approximation is the
        only part of this that is not exact.
      </HonestNote>
    </div>

    <template #footer>
      This checks the mapping and the source together. It cannot check whether real shells behave
      like fair coins; they do not, and the package deliberately does not model any measured shell.
    </template>
  </DemoSection>
</template>
