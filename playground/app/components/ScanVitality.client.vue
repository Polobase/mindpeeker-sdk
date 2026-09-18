<script setup lang="ts">
/**
 * General Vitality — the one AetherOne number whose law is known exactly.
 * Draws a sample of GVs from the selected source and lays it over the exact
 * survival function `generalVitalitySf`.
 */
import type { ScanReport } from '@mindpeeker/scan'
import { generalVitalityReader, generalVitalitySf, GV_AUTO_MODE_THRESHOLD } from '@mindpeeker/scan'
import { createYielder } from '~/lib/async'
import type { ChartMarker } from '~/lib/chart'
import { sourceSummary, withReader } from '~/lib/entropy'
import { fmtBytes, fmtNum, fmtP } from '~/lib/format'
import { BEACON_ROUND_BYTES } from '~/lib/scan/stats'

const props = defineProps<{ report: ScanReport }>()

const draws = ref(200)
const task = useTask<{ values: number[]; bytesConsumed: number; source: string }>()
const sample = computed(() => task.result.value)

/** Exact tail probabilities, straight from the package. */
const REFERENCE_POINTS = [700, 950, 1000, 1200, GV_AUTO_MODE_THRESHOLD, 1700]
const referenceRows = computed(() =>
  REFERENCE_POINTS.map((t) => ({
    t,
    p: generalVitalitySf(t),
    oneIn: 1 / generalVitalitySf(t),
  })),
)

/** P(GV > t) on a grid — the curve, with the explosion knee at 950. */
const tailCurve = computed(() => {
  const xs: number[] = []
  const ys: number[] = []
  for (let t = 0; t <= 2000; t += 10) {
    const p = generalVitalitySf(t)
    if (p <= 0) break
    xs.push(t)
    ys.push(p)
  }
  return { xs, ys }
})

/** Exact density on a bin of width w: (sf(t − w/2) − sf(t + w/2)) / w. */
function exactDensity(x: number, binWidth: number): number {
  const lo = generalVitalitySf(x - binWidth / 2)
  const hi = generalVitalitySf(x + binWidth / 2)
  return Math.max(0, (lo - hi) / binWidth)
}

const BINS = 40
const domain = computed<[number, number]>(() => {
  const values = sample.value?.values ?? []
  const max = Math.max(1200, ...values)
  return [0, Math.ceil(max / 100) * 100]
})
const binWidth = computed(() => (domain.value[1] - domain.value[0]) / BINS)
const referenceFn = computed(() => (x: number) => exactDensity(x, binWidth.value))

const observedOverThreshold = computed(() => {
  const values = sample.value?.values ?? []
  if (!values.length) return undefined
  return values.filter((v) => v > GV_AUTO_MODE_THRESHOLD).length
})
const expectedOverThreshold = computed(
  () => (sample.value?.values.length ?? 0) * generalVitalitySf(GV_AUTO_MODE_THRESHOLD),
)

const reportVitalities = computed(() =>
  props.report.results.map((r) => r.vitality).filter((v): v is number => v !== undefined),
)
const hit = computed(() => {
  let best: { name: string; vitality: number; vitalityP: number } | undefined
  for (const r of props.report.results) {
    if (r.vitality === undefined) continue
    if (!best || r.vitality > best.vitality) {
      best = { name: r.name, vitality: r.vitality, vitalityP: r.vitalityP ?? Number.NaN }
    }
  }
  return best
})

const gvMarkers = computed<ChartMarker[]>(() => {
  const marks: ChartMarker[] = [
    { value: 950, label: 'explosion starts', color: 'warning' },
    { value: GV_AUTO_MODE_THRESHOLD, label: 'Auto-Mode 1400', color: 'error' },
  ]
  const best = hit.value
  if (best) marks.push({ value: best.vitality, label: `HIT ${Math.round(best.vitality)}`, color: 2 })
  return marks
})

const source = computed(() => sourceSummary())
const estimatedBytes = computed(() => draws.value * 8)
const hint = computed(() =>
  source.value.network
    ? `≈ ${fmtBytes(estimatedBytes.value)} from ${source.value.label} — about ${Math.ceil(estimatedBytes.value / BEACON_ROUND_BYTES)} beacon rounds.`
    : `≈ ${fmtBytes(estimatedBytes.value)} from ${source.value.providerName}, one shared reader`,
)

function go(): void {
  void task.run(async (signal, setProgress) => {
    setProgress(0)
    const tick = createYielder(8, signal)
    const values: number[] = []
    const n = draws.value
    const bytesConsumed = await withReader(
      async (reader) => {
        for (let i = 0; i < n; i++) {
          values.push(await generalVitalityReader(reader))
          if ((i & 15) === 0) {
            setProgress(i / n)
            await tick()
          }
        }
        return reader.bytesConsumed
      },
      { signal },
    )
    setProgress(1)
    return { values, bytesConsumed, source: source.value.providerName }
  })
}

const snippet = `import { generalVitalityReader, generalVitalitySf, GV_AUTO_MODE_THRESHOLD } from '@mindpeeker/scan'
import { byteReader } from '@mindpeeker/oracle'

const reader = byteReader(source)
try {
  const gv = await generalVitalityReader(reader)   // max of three U{0..1000}, >950 explodes
  const p = generalVitalitySf(gv - 1)              // P(GV ≥ gv), exact
  const auto = gv > GV_AUTO_MODE_THRESHOLD         // AetherOnePi Auto-Mode: GV > 1400
} finally {
  await reader.close()
}
generalVitalitySf(1400) // 0.00225… — about one fair-source rate in 444`
</script>

<template>
  <DemoSection
    id="scan-vitality"
    title="3 · General Vitality against its exact law"
    description="GV is the best of three uniform draws on 0…1000, with an open-ended explosion above 950. AetherOne never stated how often a given GV happens by chance; this package does, exactly."
    :api="['generalVitality', 'generalVitalityReader', 'generalVitalitySf', 'GV_AUTO_MODE_THRESHOLD']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Draw ${draws} GVs`"
        busy-label="Drawing…"
        :hint="hint"
        @run="go"
        @cancel="task.cancel()"
      >
        <UFormField label="draws" size="xs" class="w-28">
          <UInputNumber v-model="draws" :min="20" :max="2000" :step="100" class="w-full" />
        </UFormField>
      </RunControls>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        v-if="hit"
        label="HIT — highest GV in the scan"
        :value="`${Math.round(hit.vitality)}`"
        size="sm"
        tone="primary"
        :note="`${hit.name} · P(GV ≥ that) = ${fmtP(hit.vitalityP)}`"
      />
      <StatTile
        label="P(GV > 1400)"
        :value="generalVitalitySf(GV_AUTO_MODE_THRESHOLD)"
        :digits="5"
        size="sm"
        note="Auto-Mode threshold — one rate in 444"
      />
      <StatTile
        label="P(GV > 950)"
        :value="generalVitalitySf(950)"
        :digits="4"
        size="sm"
        note="the explosion fires this often"
      />
      <StatTile
        v-if="sample"
        label="sample > 1400"
        :value="`${observedOverThreshold} of ${sample.values.length}`"
        size="sm"
        :note="`expected ${fmtNum(expectedOverThreshold, { digits: 2 })}`"
      />
      <StatTile
        v-else
        label="scan vitalities"
        :value="reportVitalities.length"
        :digits="0"
        size="sm"
        note="one per scored item"
      />
    </div>

    <div v-if="sample" class="mt-4 flex flex-col gap-2">
      <Histogram
        :values="sample.values"
        :bins="BINS"
        :domain="domain"
        density
        :reference="referenceFn"
        reference-label="exact law (generalVitalitySf)"
        :markers="gvMarkers"
        x-label="General Vitality"
        y-label="density"
        :height="260"
        aria-label="Sampled General Vitality values against the exact density derived from generalVitalitySf"
      />
      <AccountingBadge :bytes-consumed="sample.bytesConsumed" :source="sample.source" />
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div>
        <LineChart
          :series="[{ name: 'P(GV > t)', y: tailCurve.ys, x: tailCurve.xs }]"
          :vlines="[
            { value: 950, label: 'explosion' },
            { value: GV_AUTO_MODE_THRESHOLD, label: 'Auto-Mode', color: 'error' },
          ]"
          log-y
          x-label="t"
          y-label="P(GV > t)"
          :height="240"
          aria-label="Exact survival function of General Vitality on a logarithmic scale"
          :format="(v) => v.toExponential(2)"
        />
        <p class="mt-1 text-xs text-muted">
          The kink at 950 is the explosion: below it the law is
          1 − ((t+1)/1001)³, above it a renewal tail over draws of 50…100.
        </p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="text-left text-xs uppercase tracking-wide text-muted pb-1">
            exact reference values
          </caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-right py-1 pe-3 font-medium">t</th>
              <th class="text-right py-1 px-3 font-medium">P(GV &gt; t)</th>
              <th class="text-right py-1 ps-3 font-medium">one in</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in referenceRows" :key="row.t" class="border-t border-default">
              <td class="py-1 pe-3 text-right font-mono tabular-nums">{{ row.t }}</td>
              <td class="py-1 px-3 text-right font-mono tabular-nums">{{ fmtP(row.p) }}</td>
              <td class="py-1 ps-3 text-right font-mono tabular-nums">
                {{ fmtNum(row.oneIn, { digits: 0 }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <CodeSnippet :code="snippet" title="drawing a GV and pricing it" />

    <HonestNote variant="caveat">
      A high GV is a high draw from a known distribution and nothing else. AetherOnePi's
      <strong>HIT</strong> label marks whichever entry happens to hold the highest GV on the page —
      with M items on screen, the expected maximum rises with M, so a "hit" is guaranteed every
      scan. Its Auto-Mode fires at GV &gt; 1400, which a fair source reaches about once in 444
      draws; that is a property of the dice, not of the rate it then broadcasts.
    </HonestNote>

    <template #footer>
      AetherOnePi's Java draws <code class="font-mono">nextInt(1000)</code> /
      <code class="font-mono">nextInt(100)</code>, one value less at the top of each range;
      this package follows AetherOnePy's inclusive ranges and states the resulting law.
    </template>
  </DemoSection>
</template>
