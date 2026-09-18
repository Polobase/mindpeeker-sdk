<script setup lang="ts">
/**
 * Tab 1 — the full AetherOne-style catalog scan: the EV race, General Vitality,
 * and the exact fair-coin deviation model with multiplicity control.
 *
 * Behaviour preserved from f261c80: the scan auto-runs on mount **only** on the
 * local CSPRNG; every other source waits for the button, so opening the page
 * never fires a burst of beacon requests.
 */
import type { BetaPrior } from '@mindpeeker/psi'
import type { ScanMode, ScanReport } from '@mindpeeker/scan'
import { raceSubsetSize, resolveRaceOptions, scan } from '@mindpeeker/scan'
import { provider, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import {
  buildCatalog,
  catalogLines,
  DEFAULT_CATALOG_TEXT,
  duplicateNames,
} from '~/lib/scan/catalog'
import { BEACON_ROUND_BYTES, median } from '~/lib/scan/stats'

const MODES: { label: string; value: ScanMode }[] = [
  { label: 'both — race, vitality, then the deviation null (default)', value: 'both' },
  { label: 'race — AetherOne EV race only', value: 'race' },
  { label: 'deviation — the honest null model only', value: 'deviation' },
]

const text = ref(DEFAULT_CATALOG_TEXT)
const dedupe = ref(true)
const mode = ref<ScanMode>('both')
const maxValue = ref(100)
const subsetFraction = ref(0.1)
const subsetMin = ref(120)
const subsetMax = ref(5000)
const deviationRounds = ref(256)
const withVitality = ref(true)
const priorA = ref(1)
const priorB = ref(1)
const alpha = ref(0.05)

const names = computed(() => catalogLines(text.value))
const duplicates = computed(() => duplicateNames(names.value))
const itemCount = computed(() => (dedupe.value ? new Set(names.value).size : names.value.length))

/** `resolveRaceOptions` validates before any byte is read — show its typed error. */
const raceOptions = computed(() => {
  try {
    return {
      value: resolveRaceOptions({
        maxValue: maxValue.value,
        subsetFraction: subsetFraction.value,
        subsetMin: subsetMin.value,
        subsetMax: subsetMax.value,
      }),
      error: undefined as unknown,
    }
  } catch (error) {
    return { value: undefined, error }
  }
})

const subsetSize = computed(() => {
  const opts = raceOptions.value.value
  if (!opts || itemCount.value === 0) return 0
  return raceSubsetSize(itemCount.value, opts)
})

const scoredCount = computed(() => (mode.value === 'deviation' ? itemCount.value : subsetSize.value))

/** Rough byte budget: race draws + vitality draws + one bit per item per round. */
const estimatedBytes = computed(() => {
  const s = subsetSize.value
  const scored = scoredCount.value
  const racePasses = Math.ceil(maxValue.value / 5) // mean EV increment is 5
  const raceBytes = mode.value === 'deviation' ? 0 : 2 * s + racePasses * s
  const vitalityBytes = withVitality.value ? 8 * scored : 0
  const devBytes = mode.value === 'race' ? 0 : Math.ceil((scored * deviationRounds.value) / 8)
  return raceBytes + vitalityBytes + devBytes
})

const source = computed(() => sourceSummary())
const hint = computed(() =>
  source.value.network
    ? `≈ ${fmtBytes(estimatedBytes.value)} from ${source.value.label} — about ${Math.ceil(estimatedBytes.value / BEACON_ROUND_BYTES)} beacon rounds, one fetch each.`
    : `≈ ${fmtBytes(estimatedBytes.value)} from ${source.value.providerName}`,
)

const tooBig = computed(() => scoredCount.value * deviationRounds.value > 200_000)

const task = useTask<ScanReport>()
const report = computed(() => task.result.value)
const waiting = ref<string>()

const hasVitality = computed(() =>
  (report.value?.results ?? []).some((r) => r.vitality !== undefined),
)

const medianBf = computed(() => {
  const rows = report.value?.results ?? []
  const bfs = rows.map((r) => r.deviation?.bayesFactor).filter((v): v is number => v !== undefined)
  return bfs.length ? median(bfs) : undefined
})

function go(): void {
  waiting.value = undefined
  void task.run(async (signal, setProgress) => {
    setProgress(null)
    restartSource() // a deterministic source rewinds, so a rerun reproduces exactly
    const prior: BetaPrior = { a: priorA.value, b: priorB.value }
    const catalog = buildCatalog('demo', 'Demo catalog', names.value, { dedupe: dedupe.value })
    return await scan(catalog, provider, {
      mode: mode.value,
      maxValue: maxValue.value,
      subsetFraction: subsetFraction.value,
      subsetMin: subsetMin.value,
      subsetMax: subsetMax.value,
      deviationRounds: deviationRounds.value,
      withVitality: withVitality.value,
      prior,
      alpha: alpha.value,
      signal,
    })
  })
}

// Auto-run only on the local CSPRNG: a remote beacon would fire a burst of
// network requests before the visitor asked for anything.
onMounted(() => {
  if (currentSourceId() === 'crypto') go()
  else
    waiting.value = `press “Scan catalog” to pull about ${fmtBytes(estimatedBytes.value)} from ${sourceLabel(currentSourceId())}`
})

const snippet = computed(
  () => `import { defineCatalog, generalVitalitySf, scan } from '@mindpeeker/scan'

const catalog = defineCatalog('demo', 'Demo catalog', [
${names.value
  .slice(0, 3)
  .map((n) => `  { name: ${JSON.stringify(n)} },`)
  .join('\n')}
  // …${Math.max(0, itemCount.value - 3)} more
])

const report = await scan(catalog, source, {
  mode: '${mode.value}',
  maxValue: ${maxValue.value},            // AetherOnePi's winning EV
  subsetFraction: ${subsetFraction.value}, subsetMin: ${subsetMin.value}, subsetMax: ${subsetMax.value},
  deviationRounds: ${deviationRounds.value},  // one fair coin per item per round
  withVitality: ${withVitality.value},
  prior: { a: ${priorA.value}, b: ${priorB.value} }, alpha: ${alpha.value},
})

for (const r of report.results) {
  console.log(r.rank, r.id, r.energy, r.vitality, r.vitalityP, r.deviation?.pHolm)
}
console.log(report.multiplicity?.expectedFalsePositives) // M·α, expected by luck
console.log(report.multiplicity?.omnibus.p)              // "is the source off at all?"`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="scan-catalog"
      title="1 · Scan a catalog"
      description="The pipeline consumes one byte stream in a fixed order — race, then vitality, then the deviation coins — so the report is a deterministic function of the bytes. Edit the list and scan."
      :api="['defineCatalog', 'scan', 'raceSubsetSize', 'resolveRaceOptions', 'ScanReport']"
    >
      <template #controls>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          :disabled="itemCount < 1 || !!raceOptions.error"
          label="Scan catalog"
          busy-label="Scanning…"
          :hint="hint"
          @run="go"
          @cancel="task.cancel()"
        >
          <UBadge color="neutral" variant="subtle">{{ itemCount }} items</UBadge>
        </RunControls>
      </template>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div class="flex flex-col gap-3">
          <UFormField
            label="Catalog — one item per line"
            help="Ids default to the name and must be unique within the catalog."
          >
            <UTextarea
              v-model="text"
              :rows="10"
              class="w-full"
              :ui="{ base: 'font-mono text-xs' }"
            />
          </UFormField>
          <USwitch
            v-model="dedupe"
            label="Deduplicate repeated lines"
            :description="
              dedupe
                ? 'Repeats are dropped, keeping the first occurrence.'
                : 'Repeats reach defineCatalog, which rejects them with ScanError(invalid_catalog).'
            "
          />
          <UAlert
            v-if="duplicates.length"
            :color="dedupe ? 'neutral' : 'warning'"
            variant="subtle"
            icon="i-lucide-copy"
            :title="`${duplicates.length} repeated line${duplicates.length === 1 ? '' : 's'}`"
            :description="
              dedupe
                ? `${duplicates.join(', ')} — dropped before defineCatalog sees them.`
                : `${duplicates.join(', ')} — scanning now raises the typed catalog error.`
            "
          />
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Mode" class="sm:col-span-2">
            <USelect v-model="mode" :items="MODES" class="w-full" />
          </UFormField>
          <UFormField label="maxValue" help="EV a racing item must reach to win">
            <UInputNumber v-model="maxValue" :min="1" :max="5000" class="w-full" />
          </UFormField>
          <UFormField label="deviationRounds" help="fair coins per item">
            <UInputNumber v-model="deviationRounds" :min="1" :max="4096" class="w-full" />
          </UFormField>
          <UFormField label="subsetMin" help="AetherOnePi: 120">
            <UInputNumber v-model="subsetMin" :min="1" :max="5000" class="w-full" />
          </UFormField>
          <UFormField label="subsetMax" help="AetherOnePi: 5000 (Py's rule is 24/24)">
            <UInputNumber v-model="subsetMax" :min="1" :max="100000" class="w-full" />
          </UFormField>
          <UFormField
            :label="`subsetFraction — ${subsetFraction.toFixed(2)}`"
            help="share of the catalog raced"
            class="sm:col-span-2"
          >
            <USlider v-model="subsetFraction" :min="0.05" :max="1" :step="0.05" class="mt-2" />
          </UFormField>
          <UFormField label="prior a" help="Beta(a, b) for BF₁₀">
            <UInputNumber v-model="priorA" :min="0.1" :step="0.5" class="w-full" />
          </UFormField>
          <UFormField label="prior b">
            <UInputNumber v-model="priorB" :min="0.1" :step="0.5" class="w-full" />
          </UFormField>
          <UFormField label="alpha" help="family level for the multiplicity summary">
            <UInputNumber v-model="alpha" :min="0.001" :max="0.5" :step="0.01" class="w-full" />
          </UFormField>
          <div class="flex items-end">
            <USwitch v-model="withVitality" label="General Vitality" />
          </div>
        </div>
      </div>

      <div class="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="raced subset"
          :value="mode === 'deviation' ? 'n/a' : `${subsetSize} of ${itemCount}`"
          size="sm"
          mono
          note="min(M, clamp(⌊M·f⌋, min, max))"
        />
        <StatTile label="items scored" :value="scoredCount" size="sm" :digits="0" note="tests in the family" />
        <StatTile
          label="expected nominal hits"
          :value="mode === 'race' ? '—' : scoredCount * alpha"
          size="sm"
          :digits="2"
          tone="warning"
          note="M·α from a perfect coin"
        />
        <StatTile label="byte budget" :value="fmtBytes(estimatedBytes)" size="sm" note="estimate before the run" />
      </div>

      <ErrorAlert
        :err="raceOptions.error"
        :dismissible="false"
        title="These race options are rejected before any byte is read"
      />
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <UAlert
        v-if="tooBig"
        color="warning"
        variant="subtle"
        icon="i-lucide-hourglass"
        title="That is a lot of coins"
        :description="`${fmtNum(scoredCount * deviationRounds, { digits: 0 })} coin draws run as one uninterruptible call inside scan(); the page will not repaint while it does. Keep items × rounds under ~200 000.`"
      />

      <p v-if="waiting && !report" class="text-sm text-muted">{{ waiting }}</p>

      <template #footer>
        Energy has <strong>no</strong> chance baseline; vitality has only the one
        <code class="font-mono">vitalityP</code> states; the deviation column is the field with a
        real null. AetherOnePi seeds <code class="font-mono">java.util.Random</code> per call from
        the clock plus a hotbit seed — the hardware contributes a seed, not the numbers. Here every
        draw is rejection-sampled from the source itself and replays byte for byte.
      </template>
    </DemoSection>

    <template v-if="report">
      <ScanReportTable :report="report" :alpha="alpha" :median-bf="medianBf" />
      <ScanVitality v-if="hasVitality" :report="report" />
    </template>

    <DemoSection title="The code behind this section" :api="['@mindpeeker/scan']">
      <CodeSnippet :code="snippet" title="what “Scan catalog” runs" />
      <template #footer>
        The scan opens one stream and closes it when the call completes, fails or is aborted — 0.1
        left serial ports and camera tracks open.
      </template>
    </DemoSection>
  </div>
</template>
