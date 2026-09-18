<script setup lang="ts">
/**
 * Section 5 — the Gaussian KDE surface the open Randonaut ports take their
 * attractor from, with the chance baseline they never report.
 */
import type { Bandwidth } from '@mindpeeker/field'
import type { KdeResult } from '~/lib/field/jobs'
import { useFieldLab } from '~/lib/field/lab'
import { flipRows } from '~/lib/field/stats'
import { nullBytesNeeded } from '~/lib/field/types'
import { runFieldJob } from '~/lib/field/worker-client'
import { fmtBytes, fmtDuration, fmtNum } from '~/lib/format'

const { field, drawNullBytes, setOverlay } = useFieldLab()
const task = useTask<KdeResult>()

const BANDWIDTHS = [
  { label: "silverman — pyrandonaut's default", value: 'silverman' as const },
  { label: 'scott — identical in 2-D', value: 'scott' as const },
  { label: 'fixed σ = 3', value: 3 as const },
  { label: 'fixed σ = 8', value: 8 as const },
  { label: 'fixed σ = 15', value: 15 as const },
]
const GRIDS = [30, 40, 50, 60, 80, 100].map((g) => ({ label: `${g} × ${g} nodes`, value: g }))
const EXTENTS = [
  { label: "region — the window's bounding box", value: 'region' as const },
  { label: 'data — the points’ bounding box (pyrandonaut)', value: 'data' as const },
]
const RUNS = [
  { label: 'surface only (no test)', value: 0 },
  { label: '99 runs', value: 99 },
  { label: '199 runs', value: 199 },
  { label: '499 runs', value: 499 },
]

const bandwidth = ref<Bandwidth>('silverman')
const grid = ref(50)
const extent = ref<'region' | 'data'>('region')
const runs = ref(99)

const stamp = computed(() => {
  const f = field.value
  if (!f) return ''
  return `${f.serial}:${String(bandwidth.value)}:${grid.value}:${extent.value}:${runs.value}`
})
const measured = ref('')
const fresh = computed(() => task.result.value !== undefined && measured.value === stamp.value)
const kde = computed(() => (fresh.value ? task.result.value : undefined))

const bytes = computed(() => nullBytesNeeded(runs.value, field.value?.points.length ?? 0))

/**
 * O(grid² · n) per surface. Measured on this build at about 90 million
 * node–point evaluations a second, which is what the hint quotes.
 */
const estimateSeconds = computed(() => {
  const n = field.value?.points.length ?? 0
  return (grid.value * grid.value * n * (runs.value + 1)) / 90_000_000
})

/** The grid is stored with y increasing upwards; the heatmap paints top row first. */
const heat = computed(() => {
  const k = kde.value
  if (!k) return undefined
  return flipRows(k.grid.values, k.grid.gx, k.grid.gy)
})

/** scipy's covariance factor f = n^(−1/6) — the same for Scott and Silverman in 2-D. */
const factor = computed(() => {
  const n = field.value?.points.length ?? 0
  return n > 0 ? n ** (-1 / 6) : Number.NaN
})

watchEffect(() => {
  const k = kde.value
  if (!k) {
    setOverlay('kde', undefined)
    return
  }
  setOverlay('kde', [
    { kind: 'dot', x: k.attractor.x, y: k.attractor.y, color: 2, label: 'KDE attractor' },
    { kind: 'dot', x: k.void.x, y: k.void.y, color: 6, label: 'KDE void' },
  ])
})

onUnmounted(() => setOverlay('kde', undefined))

async function run(): Promise<void> {
  const f = field.value
  if (!f) return
  const at = stamp.value
  await task.run(async (signal, setProgress) => {
    setProgress(runs.value > 0 ? 0 : null)
    const nulls =
      runs.value > 0
        ? await drawNullBytes(runs.value, f.points.length, signal)
        : { bytes: new Uint8Array(0), label: 'none' }
    const out = await runFieldJob(
      'kde',
      {
        points: f.points,
        region: f.region,
        runs: runs.value,
        bandwidth: bandwidth.value,
        grid: grid.value,
        extent: extent.value,
        bytes: nulls.bytes,
      },
      signal,
      setProgress,
    )
    measured.value = at
    return out
  })
}

const snippet = computed(
  () => `import { kdeAttractor, kdeSignificance, kdeVoid, kernelDensity } from '@mindpeeker/field'

const opts = { bandwidth: ${typeof bandwidth.value === 'number' ? bandwidth.value : `'${bandwidth.value}'`}, grid: ${grid.value}, extent: '${extent.value}' } as const

const surface = kernelDensity(points, region, opts)   // values[ix + iy·gx], integrates to ≈ 1
const peak = kdeAttractor(points, region, opts)       // argmax over nodes inside W
const hollow = kdeVoid(points, region, opts)          // argmin over nodes inside W
${
  runs.value > 0
    ? `
// The baseline the open Randonaut ports never report:
const tested = await kdeSignificance(reader, points, region, { ...opts, runs: ${runs.value} })
tested.attractor.p   // (1 + #{simulated max density ≥ observed}) / (runs + 1)`
    : ''
}`,
)
</script>

<template>
  <DemoSection
    id="density"
    title="5 · Density — the KDE attractor, and how likely it was"
    description="pyrandonaut and OpenRando take the attractor as the argmax of a Gaussian KDE on a 100 × 100 grid. That node is reproduced here exactly (checked against scipy's gaussian_kde) — and then ranked against CSR fields, which is the part the ports leave out."
    :api="['kernelDensity', 'kdeAttractor', 'kdeVoid', 'kdeSignificance']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!field"
        :label="runs > 0 ? `Surface + ${runs} CSR fields` : 'Compute the surface'"
        busy-label="Estimating…"
        icon="i-lucide-flame"
        :hint="runs > 0
          ? `${fmtBytes(bytes)} of null-field bytes · O(grid² · n) per field ≈ ${fmtNum(estimateSeconds, { digits: 1 })} s in the worker`
          : 'no simulation: the surface, its argmax and its argmin only'"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="Bandwidth" size="sm">
        <USelect v-model="bandwidth" :items="BANDWIDTHS" class="w-full" />
      </UFormField>
      <UFormField label="Grid" size="sm">
        <USelect v-model="grid" :items="GRIDS" class="w-full" />
      </UFormField>
      <UFormField label="Grid extent" size="sm">
        <USelect v-model="extent" :items="EXTENTS" class="w-full" />
      </UFormField>
      <UFormField label="Simulated CSR fields" size="sm">
        <USelect v-model="runs" :items="RUNS" class="w-full" />
      </UFormField>
    </div>

    <div v-if="kde && heat" class="mt-4 flex flex-col gap-4">
      <HeatmapCanvas
        :data="heat"
        :rows="kde.grid.gy"
        :cols="kde.grid.gx"
        :height="300"
        aria-label="Gaussian kernel density of the point field"
        row-label="y, top row = highest y"
        col-label="x, left = smallest x"
        :format="(v) => fmtNum(v, { digits: 6 })"
      />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="KDE attractor"
          size="sm"
          :value="`(${fmtNum(kde.attractor.x, { digits: 1 })}, ${fmtNum(kde.attractor.y, { digits: 1 })})`"
          tone="primary"
          :note="`density ${fmtNum(kde.attractor.density, { digits: 6 })}`"
        />
        <StatTile label="Attractor p" size="sm">
          <template #value>
            <PValue v-if="kde.attractor.p !== undefined" :p="kde.attractor.p" kind="exact" label="p" />
            <span v-else class="text-dimmed text-base">not tested</span>
          </template>
          <template #note>
            <span v-if="kde.attractor.rank !== undefined">
              rank {{ kde.attractor.rank }} of {{ kde.runs + 1 }} simulated maxima
            </span>
            <span v-else>pick a run count to rank it against CSR</span>
          </template>
        </StatTile>
        <StatTile
          label="KDE void"
          size="sm"
          :value="`(${fmtNum(kde.void.x, { digits: 1 })}, ${fmtNum(kde.void.y, { digits: 1 })})`"
          :note="`density ${fmtNum(kde.void.density, { digits: 6 })}`"
        />
        <StatTile label="Void p" size="sm">
          <template #value>
            <PValue v-if="kde.void.p !== undefined" :p="kde.void.p" kind="exact" label="p" />
            <span v-else class="text-dimmed text-base">not tested</span>
          </template>
          <template #note>
            <span v-if="kde.void.rank !== undefined">rank {{ kde.void.rank }} of {{ kde.runs + 1 }} minima</span>
            <span v-else>the emptiest corner of a random field is not news</span>
          </template>
        </StatTile>
        <StatTile
          label="Kernel covariance Σ"
          size="sm"
          :value="`${fmtNum(kde.grid.covariance[0], { digits: 1 })} / ${fmtNum(kde.grid.covariance[2], { digits: 1 })}`"
          :note="`σxx / σyy · σxy = ${fmtNum(kde.grid.covariance[1], { digits: 2 })}`"
        />
        <StatTile
          label="Covariance factor f"
          :value="factor"
          :digits="4"
          size="sm"
          note="scipy's n^(−1/6) — Scott and Silverman coincide in 2-D"
        />
        <StatTile
          label="Grid"
          size="sm"
          :value="`${kde.grid.gx} × ${kde.grid.gy}`"
          :note="`${extent === 'data' ? 'points’ bounding box' : 'window bounding box'} · nodes include both ends`"
        />
        <StatTile
          label="Run"
          size="sm"
          :value="fmtDuration(kde.elapsedMs)"
          :note="kde.runs > 0 ? `${kde.runs} simulated surfaces in a Web Worker` : 'one surface, in a Web Worker'"
        />
      </div>

      <AccountingBadge
        v-if="kde.runs > 0"
        :bytes-consumed="kde.accounting.bytesConsumed"
        :bits-used="kde.accounting.bitsUsed"
        :source="`${kde.runs} simulated fields`"
      />
    </div>

    <UAlert
      v-if="task.result.value && !fresh"
      color="neutral"
      variant="subtle"
      icon="i-lucide-refresh-cw"
      title="That surface belongs to an earlier field or setting"
      description="Bandwidth, grid, extent and run count all change the statistic. Run it again for the field on the canvas."
      class="mt-4"
    />

    <HonestNote variant="caveat" title="A density peak is a picture, not a finding">
      The surface has <strong>no edge correction</strong>: near the boundary the kernel mass that
      falls outside W is simply lost, so the region's rim reads lower than its interior even under
      perfect CSR — which is why the void so often lands in a corner. The bandwidth is a choice, not
      a measurement: a wider σ moves the peak. Only the ranked p answers “was this peak unusual?”,
      and it answers it for the bandwidth, grid and extent you fixed before looking.
    </HonestNote>

    <CodeSnippet class="mt-4" :code="snippet" title="what this section ran" />

    <template #footer>
      <code class="font-mono">{ bandwidth: 'silverman', grid: 100, extent: 'data' }</code> reproduces
      pyrandonaut's node exactly — scipy <code class="font-mono">gaussian_kde(bw_method="silverman")</code>
      on a 100 × 100 <code class="font-mono">mgrid</code> over the points' bounding box. A number is
      an isotropic σ in region units (spatstat's <code class="font-mono">sigma</code>), not scipy's
      scalar factor.
    </template>
  </DemoSection>
</template>
