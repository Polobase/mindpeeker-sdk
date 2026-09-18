<script setup lang="ts">
/**
 * Tab 2 — the honest null model, shown from both sides: the selected source
 * (expect nothing) and a synthetic source with a *known* defect (expect a
 * detection). Cookbook recipe 7, made interactive.
 */
import type { DeviationReport } from '@mindpeeker/scan'
import { scanDeviation } from '@mindpeeker/scan'
import { localProvider, provider, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { syntheticCatalog } from '~/lib/scan/catalog'
import { biasedSource } from '~/lib/scan/sources'
import { BEACON_ROUND_BYTES, median, normalPdf } from '~/lib/scan/stats'

const items = ref(30)
const rounds = ref(256)
const bias = ref(0.55)
const alpha = ref(0.05)
const applyBias = ref(true)

const effectiveP = computed(() => (applyBias.value ? bias.value : 0.5))
const source = computed(() => sourceSummary())
const fairBytes = computed(() => Math.ceil((items.value * rounds.value) / 8))
/** The wrapper spends ~2 input bits per output bit (Knuth–Yao). */
const syntheticInputBytes = computed(() => 2 * fairBytes.value)
const hint = computed(() =>
  source.value.network
    ? `${fmtBytes(fairBytes.value)} from ${source.value.label} (≈ ${Math.ceil(fairBytes.value / BEACON_ROUND_BYTES)} beacon rounds) + ${fmtBytes(syntheticInputBytes.value)} from the browser CSPRNG for the synthetic arm`
    : `${fmtBytes(fairBytes.value)} from ${source.value.providerName} + ${fmtBytes(syntheticInputBytes.value)} for the synthetic arm`,
)

interface Arms {
  fair: DeviationReport
  synthetic: DeviationReport
  p: number
}

const task = useTask<Arms>()
const arms = computed(() => task.result.value)

function go(): void {
  void task.run(async (signal) => {
    restartSource()
    const catalog = syntheticCatalog('null-demo', items.value)
    const opts = { rounds: rounds.value, alpha: alpha.value, signal }
    const p = effectiveP.value
    const fair = await scanDeviation(catalog, provider, opts)
    const synthetic = await scanDeviation(catalog, biasedSource(localProvider, p), opts)
    return { fair, synthetic, p }
  })
}

function summarise(report: DeviationReport | undefined) {
  if (!report) return undefined
  const zs = report.results.map((r) => r.deviation.z)
  const bfs = report.results.map((r) => r.deviation.bayesFactor)
  const top = report.results[0]
  return {
    report,
    zs,
    medianBf: median(bfs),
    top,
    m: report.multiplicity,
  }
}

const fair = computed(() => summarise(arms.value?.fair))
const synthetic = computed(() => summarise(arms.value?.synthetic))
const expectedHits = computed(() => (arms.value ? arms.value.fair.multiplicity.expectedFalsePositives : items.value * alpha.value))

const hitBars = computed(() => {
  if (!arms.value) return { categories: [] as string[], values: [] as number[] }
  return {
    categories: ['selected source', `synthetic P(1)=${arms.value.p.toFixed(3)}`],
    values: [arms.value.fair.multiplicity.nominalHits, arms.value.synthetic.multiplicity.nominalHits],
  }
})

const snippet = computed(
  () => `import { defineCatalog, scanDeviation } from '@mindpeeker/scan'

const catalog = defineCatalog('null-demo', '${items.value} synthetic items',
  Array.from({ length: ${items.value} }, (_, i) => ({ id: \`item-\${i + 1}\`, name: \`Item \${i + 1}\` })))

// a positive control with a known defect: every emitted bit is 1 with probability ${effectiveP.value}
const biased = {
  name: 'synthetic-bias(P(1)=${effectiveP.value})',
  async *stream(opts) { /* compare a uniform binary fraction with p, bit by bit */ },
}

const fair = await scanDeviation(catalog, source,  { rounds: ${rounds.value}, alpha: ${alpha.value} })
const bad  = await scanDeviation(catalog, biased, { rounds: ${rounds.value}, alpha: ${alpha.value} })

console.log(fair.multiplicity.expectedFalsePositives, fair.multiplicity.nominalHits)
console.log(fair.multiplicity.omnibus.p, bad.multiplicity.omnibus.p)
console.log(fair.p0) // 0.5 — exact, not estimated`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="scan-null"
      title="1 · Two sources, one null model"
      description="Both arms run the identical test: one fair coin per item per round, exact binomial p, Holm and BH adjustment, and an omnibus χ² over all items. The only difference is the source."
      :api="['scanDeviation', 'DeviationReport', 'P0', 'MultiplicitySummary']"
    >
      <template #controls>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          label="Run both arms"
          busy-label="Flipping coins…"
          :hint="hint"
          @run="go"
          @cancel="task.cancel()"
        />
      </template>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UFormField label="items (M)" help="tests in the family">
          <UInputNumber v-model="items" :min="2" :max="200" :step="10" class="w-full" />
        </UFormField>
        <UFormField label="rounds (N)" help="fair coins per item">
          <UInputNumber v-model="rounds" :min="8" :max="2048" :step="64" class="w-full" />
        </UFormField>
        <UFormField label="alpha" help="family level">
          <UInputNumber v-model="alpha" :min="0.001" :max="0.5" :step="0.01" class="w-full" />
        </UFormField>
        <div class="flex items-end">
          <USwitch
            v-model="applyBias"
            label="Bias the synthetic source"
            :description="applyBias ? 'a broken RNG' : 'P(1) = 0.5 — the wrapper is exactly fair'"
          />
        </div>
        <UFormField
          :label="`P(bit = 1) on the synthetic source — ${effectiveP.toFixed(3)}`"
          :help="
            applyBias
              ? 'exact, by comparing a uniform binary fraction with p bit by bit (≈ 2 input bits per output bit)'
              : 'switch the bias on to move this'
          "
          class="sm:col-span-2 lg:col-span-4"
        >
          <USlider
            v-model="bias"
            :min="0.5"
            :max="0.75"
            :step="0.005"
            :disabled="!applyBias"
            class="mt-2"
          />
        </UFormField>
      </div>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <p v-if="!arms && !task.busy.value" class="text-sm text-muted">
        Nothing has run yet. The expected outcome on the left is nothing at all:
        {{ fmtNum(expectedHits, { digits: 1 }) }} items below p = {{ alpha }} by luck, no Holm
        rejection, an omnibus p that is just a number between 0 and 1, and a median Bayes factor
        well below 1.
      </p>

      <template #footer>
        The synthetic arm draws its input from the browser CSPRNG rather than the selected source:
        it is a simulation of a broken device, not a reading of anything, and at P(1) = 0.5 it is
        exactly fair — which is what makes it usable as its own negative control.
      </template>
    </DemoSection>

    <DemoSection
      v-if="arms && fair && synthetic"
      id="scan-null-results"
      title="2 · What each arm reports"
      description="Read the adjusted values, not the raw ones. With M items, M·α of them cross α on a perfect coin every single time."
      :api="['MultiplicitySummary', 'OmnibusTest', 'holm', 'benjaminiHochberg']"
    >
      <div class="grid gap-4 lg:grid-cols-2">
        <div
          v-for="arm in [
            { key: 'fair', title: 'Selected source', data: fair },
            { key: 'synthetic', title: `Synthetic P(1) = ${arms.p.toFixed(3)}`, data: synthetic },
          ]"
          :key="arm.key"
          class="rounded-md border border-default p-3 flex flex-col gap-3"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">{{ arm.title }}</h3>
            <code class="text-[11px] text-dimmed font-mono">{{ arm.data?.report.source }}</code>
          </div>
          <div class="grid gap-2 grid-cols-2">
            <StatTile
              label="p ≤ α observed"
              :value="`${arm.data?.m.nominalHits} of ${arm.data?.m.tests}`"
              size="sm"
              :note="`expected ${fmtNum(arm.data?.m.expectedFalsePositives, { digits: 1 })}`"
            />
            <StatTile
              label="Holm / BH"
              :value="`${arm.data?.m.holmRejections} / ${arm.data?.m.bhRejections}`"
              size="sm"
              :tone="(arm.data?.m.holmRejections ?? 0) > 0 ? 'warning' : 'success'"
              note="survive multiplicity"
            />
            <StatTile
              label="omnibus Σz²"
              :value="arm.data?.m.omnibus.statistic"
              :digits="1"
              size="sm"
              :note="`df ${arm.data?.m.omnibus.df}`"
            />
            <StatTile
              label="median BF₁₀"
              :value="arm.data?.medianBf"
              :digits="3"
              size="sm"
              :tone="(arm.data?.medianBf ?? 0) > 1 ? 'warning' : 'success'"
              note="below 1 favours chance"
            />
          </div>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-muted">omnibus</span>
            <PValue :p="arm.data?.m.omnibus.p" kind="exact" label="p" />
          </div>
          <Histogram
            :values="arm.data?.zs ?? []"
            :bins="24"
            :domain="[-6, 6]"
            density
            :reference="normalPdf"
            reference-label="N(0, 1)"
            :markers="[
              { value: -1.96, label: '−1.96' },
              { value: 1.96, label: '+1.96' },
            ]"
            x-label="per-item z"
            y-label="density"
            :height="200"
            :aria-label="`Distribution of per-item z scores for the ${arm.title} arm against the standard normal`"
          />
          <p class="text-xs text-muted">
            top item <code class="font-mono">{{ arm.data?.top?.id }}</code>
            {{ arm.data?.top?.deviation.successes }}/{{ arm.data?.top?.deviation.rounds }} ·
            exact p {{ fmtNum(arm.data?.top?.deviation.p, { digits: 4 }) }} · Holm
            {{ fmtNum(arm.data?.top?.deviation.pHolm, { digits: 4 }) }}
          </p>
          <AccountingBadge
            :bytes-consumed="arm.data?.report.accounting.bytesConsumed"
            :bits-used="arm.data?.report.accounting.bitsUsed"
          />
        </div>
      </div>

      <div class="mt-4">
        <BarChart
          :categories="hitBars.categories"
          :values="hitBars.values"
          :expected="expectedHits"
          expected-label="M·α expected by luck"
          y-label="items with p ≤ α"
          :height="200"
          aria-label="Items below the nominal alpha in each arm, against the number expected by luck"
          :format="(v) => v.toFixed(1)"
        />
      </div>

      <HonestNote variant="exact">
        Eight coins per source byte, p₀ = ½ exactly, and the p-value is the exact two-sided binomial
        tail — so under a fair source P(p ≤ α) ≤ α at <em>every</em> level and every N, with no
        normal approximation to fail at small N. The omnibus Σz² ≈ χ²(M) is slightly conservative
        (each z² has variance 2 − 2/N).
      </HonestNote>

      <template #footer>
        A collapsing omnibus p means <em>the source</em> is off, not that an item is special: when
        every item deviates, the source is the explanation to rule out first. The synthetic arm's
        ranking is a ranking of noise from a broken RNG.
      </template>
    </DemoSection>

    <DemoSection title="The code behind this tab" :api="['@mindpeeker/scan', 'ByteSource']">
      <CodeSnippet :code="snippet" title="cookbook recipe 7, parameterised" />
      <template #footer>
        A source is anything with <code class="font-mono">{ name, stream(opts) }</code> — the same
        shape every <code class="font-mono">@mindpeeker/entropy</code> provider already has, so a
        webcam TRNG, an ESP32 at 921 600 baud, or this fake all drop in with no adapter.
      </template>
    </DemoSection>
  </div>
</template>
