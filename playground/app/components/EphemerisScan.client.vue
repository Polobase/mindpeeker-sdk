<script setup lang="ts">
/**
 * Section 7 — Spottiswoode's window scan. A boxcar of `windowHours` slides in
 * `stepHours` steps around the sidereal day, over data padded at ±24 h so every
 * window spans its full width. Descriptive only: the peak it finds is the
 * statistic the next section has to pay for.
 */
import { type LstScanResult, lstWindowScan } from '@mindpeeker/ephemeris'
import type { RefLine } from '~/lib/chart'
import { toTrials } from '~/lib/ephemeris/jobs'
import { type Dataset, useEphemerisLab, useLstSettings } from '~/lib/ephemeris/lab'
import { fmtNum } from '~/lib/format'

const { data } = useEphemerisLab()
const { settings, registered } = useLstSettings()

const which = ref<'exploration' | 'confirmation'>('exploration')
const band = ref<'se' | 'sd' | 'none'>('se')

const WIDTHS = [
  { label: '1 h window', value: 1 },
  { label: '2 h window (Spottiswoode 1997)', value: 2 },
  { label: '3 h window', value: 3 },
  { label: '4 h window', value: 4 },
]
const STEPS = [
  { label: '0.1 h steps — 240 windows', value: 0.1 },
  { label: '0.25 h steps — 96 windows', value: 0.25 },
  { label: '0.5 h steps — 48 windows', value: 0.5 },
  { label: '1 h steps — 24 windows', value: 1 },
]
const BANDS = [
  { label: '±1 standard error of the window mean', value: 'se' },
  { label: '±1 standard deviation inside the window', value: 'sd' },
  { label: 'no band', value: 'none' },
]

const dataset = computed<Dataset | undefined>(() =>
  which.value === 'exploration' ? data.value?.exploration : data.value?.confirmation,
)

const scan = computed<{ result?: LstScanResult; error?: unknown }>(() => {
  const set = dataset.value
  if (!set) return {}
  try {
    return {
      result: lstWindowScan(toTrials(set.columns, 'none'), {
        windowHours: settings.windowHours,
        stepHours: settings.stepHours,
        minTrials: settings.minTrials,
      }),
    }
  } catch (error) {
    return { error }
  }
})

/** Windows with a mean, as chart-ready columns (an empty window has mean null). */
const curve = computed(() => {
  const result = scan.value.result
  if (!result) return undefined
  const x: number[] = []
  const mean: number[] = []
  const lo: number[] = []
  const hi: number[] = []
  let empty = 0
  for (const w of result.windows) {
    if (w.mean === null) {
      empty++
      continue
    }
    const spread = band.value === 'se' ? (w.standardError ?? 0) : band.value === 'sd' ? (w.sd ?? 0) : 0
    x.push(w.centerHours)
    mean.push(w.mean)
    lo.push(w.mean - spread)
    hi.push(w.mean + spread)
  }
  return { x, mean, lo, hi, empty }
})

const plantedCenter = computed(() => data.value?.params.centerHours)
const plantedShift = computed(() => data.value?.params.shift ?? 0)

const vlines = computed<RefLine[]>(() => {
  const result = scan.value.result
  if (!result) return []
  const lines: RefLine[] = [
    {
      value: result.peak.centerHours,
      label: `peak ${fmtNum(result.peak.centerHours, { digits: 1 })} h`,
      color: 'primary',
    },
  ]
  if (plantedShift.value > 0 && plantedCenter.value !== undefined) {
    lines.push({ value: plantedCenter.value, label: 'planted centre', color: 'warning' })
  }
  return lines
})

/** Copy the peak's centroid into the registered window of section 9. */
function registerPeak(): void {
  const result = scan.value.result
  if (!result) return
  registered.centerHours = Math.round(result.peak.centroidHours * 2) / 2
  registered.halfWidthHours = Math.max(0.25, Math.min(6, Math.round(result.peak.halfWidthHours * 4) / 4))
  registered.origin = `read off the ${which.value} scan (centroid ${fmtNum(result.peak.centroidHours, { digits: 2 })} h, half width ${fmtNum(result.peak.halfWidthHours, { digits: 2 })} h)`
}

const snippet = computed(
  () => `import { lstWindowScan } from '@mindpeeker/ephemeris'

const scan = lstWindowScan(trials, {
  windowHours: ${settings.windowHours},      // full boxcar width
  stepHours: ${settings.stepHours},        // window centres, must divide 24
  minTrials: ${settings.minTrials},         // thinner windows are reported, never chosen as the peak
  pad: true,          // copies at LST ± 24 h, so windows wrap the sidereal day
})

scan.windows     // [{ centerHours, n, mean, sd, standardError }, …] — ${scan.value.result?.windows.length ?? 240} of them
scan.overallMean // the mean every relabeling leaves unchanged
scan.peak        // { centerHours, mean, n, gain, centroidHours, halfWidthHours }`,
)
</script>

<template>
  <DemoSection
    id="scan"
    title="7 · The window scan — the shape of the effect against sidereal time"
    description="The boxcar mean of the per-trial effect, window by window. Spottiswoode's 1997 procedure exactly: a 2 h window in 0.1 h steps, padded at ±24 h so it wraps. The peak is the largest window mean among the windows holding at least minTrials trials, the gain is peak ÷ overall mean, and the centroid is this package's operationalisation of the paper's unspecified “centroid of the upper half of the peak”."
    :api="['lstWindowScan', 'LstScanResult', 'LstWindow', 'LstPeak']"
  >
    <template #controls>
      <UFormField label="Data set" size="sm" class="w-44">
        <USelect
          v-model="which"
          :items="[{ label: 'exploration', value: 'exploration' }, { label: 'confirmation', value: 'confirmation' }]"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Window width" size="sm" class="w-60">
        <USelect v-model="settings.windowHours" :items="WIDTHS" class="w-full" />
      </UFormField>
      <UFormField label="Step" size="sm" class="w-56">
        <USelect v-model="settings.stepHours" :items="STEPS" class="w-full" />
      </UFormField>
      <UFormField label="Minimum trials per window" size="sm" class="w-44">
        <UInput v-model.number="settings.minTrials" type="number" step="1" min="1" class="w-full" />
      </UFormField>
      <UFormField label="Band" size="sm" class="w-64">
        <USelect v-model="band" :items="BANDS" class="w-full" />
      </UFormField>
    </template>

    <ErrorAlert :err="scan.error" title="The scan refused these options" :dismissible="false" />

    <p v-if="!dataset" class="text-sm text-muted">
      Draw a pair of data sets in section 6 first.
    </p>

    <div v-else-if="scan.result && curve" class="flex flex-col gap-4">
      <LineChart
        :series="[{ name: `mean effect per ${settings.windowHours} h window`, y: curve.mean, x: curve.x, color: 1 }]"
        :bands="band === 'none' ? [] : [{ lo: curve.lo, hi: curve.hi, x: curve.x, label: band === 'se' ? '±1 SE of the window mean' : '±1 SD inside the window' }]"
        :hlines="[{ value: scan.result.overallMean, label: `overall mean ${fmtNum(scan.result.overallMean, { digits: 3 })}`, color: 'muted' }, { value: 0, label: 'no effect', dashed: false, color: 'grid' }]"
        :vlines="vlines"
        x-label="local sidereal time of the window centre (hours)"
        y-label="mean effect size"
        :x-domain="[0, 24]"
        :height="300"
        :format="(v) => v.toFixed(3)"
        aria-label="Mean effect size against local sidereal time, window by window"
      />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Peak window centre" :value="`${fmtNum(scan.result.peak.centerHours, { digits: 2 })} h`" size="sm" tone="primary" :note="`${scan.result.peak.n} trials inside (padding copies included)`" />
        <StatTile label="Peak mean effect" :value="scan.result.peak.mean" :digits="3" size="sm" tone="primary" note="the statistic the permutation test ranks" />
        <StatTile label="Overall mean" :value="scan.result.overallMean" :digits="3" size="sm" note="relabeling never changes it" />
        <StatTile
          label="Gain"
          :value="scan.result.peak.gain"
          :digits="2"
          size="sm"
          :tone="(scan.result.peak.gain ?? 0) > 2 ? 'warning' : 'neutral'"
          note="peak ÷ overall mean — null when the overall mean is not positive"
        />
        <StatTile label="Centroid of the peak" :value="`${fmtNum(scan.result.peak.centroidHours, { digits: 2 })} h`" size="sm" note="excess-weighted, over the run above the half level" />
        <StatTile label="Half width" :value="`${fmtNum(scan.result.peak.halfWidthHours, { digits: 2 })} h`" size="sm" note="half the length of that run" />
        <StatTile label="Windows examined" :value="scan.result.windows.length" :digits="0" size="sm" :note="`${curve.empty} empty · ${fmtNum(24 / settings.stepHours, { digits: 0 })} = 24 / step`" />
        <StatTile label="Trials" :value="scan.result.n" :digits="0" size="sm" note="each trial sits in windowHours / stepHours windows" />
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <UButton icon="i-lucide-bookmark" variant="soft" color="neutral" @click="registerPeak">
          Send this peak to the confirmatory window
        </UButton>
        <span class="text-xs text-muted">
          It fills section 9's window with {{ fmtNum(Math.round(scan.result.peak.centroidHours * 2) / 2, { digits: 1 }) }} h ± the peak's half width.
          That is only a pre-registration for the <em>other</em> data set.
        </span>
      </div>

      <HonestNote variant="caveat" title="A scan always has a peak, and the gain is not a statistic">
        <p>
          240 overlapping windows of a pure-noise data set still produce a highest one, and with a
          2 h window in 0.1 h steps the neighbouring windows share most of their trials, so the curve
          looks smooth and the peak looks like a feature. Nothing on this chart is a test. Read the
          peak as “where the largest window mean happened to fall”, and go to section 8 for what it
          is worth.
        </p>
        <p class="mt-2">
          The gain divides by the overall mean, so when that mean sits near zero — which is what a
          null data set looks like — the gain runs to dozens or hundreds without anything having
          happened. Relabelling cannot change the overall mean, so ranking the peak mean and ranking
          the gain are the same test; the gain is a headline number, not the statistic.
        </p>
      </HonestNote>

      <CodeSnippet :code="snippet" title="what this chart ran" />
    </div>

    <template #footer>
      The lab already resolved each trial's LST with <code class="font-mono">lst(jd, λ)</code>, so
      the trials handed to the scan are <code class="font-mono">{ lstHours, effect }</code>. Passing
      <code class="font-mono">{ time, longitudeEastDeg }</code> instead lets the scan resolve them
      itself and honours <code class="font-mono">sidereal: 'apparent'</code> — a difference of at
      most 1.2 s of sidereal time. Setting the minimum trials per window above the fullest window
      throws <code class="font-mono">EphemerisError('insufficient_data')</code>; try 10 000.
    </template>
  </DemoSection>
</template>
