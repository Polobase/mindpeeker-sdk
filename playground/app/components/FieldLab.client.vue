<script setup lang="ts">
/**
 * The shared field lab: draw n area-uniform points from the header-selected
 * source into a rectangle or a disk, optionally planting a tight blob as a
 * positive control, and show the result on one canvas that every section below
 * marks up.
 */
import { regionArea } from '@mindpeeker/field'
import { fmtBytes, fmtDuration, fmtNum } from '~/lib/format'
import { applyDefaultNullSource, drawField, NULL_SOURCE_LABELS, plantedCount, useFieldLab } from '~/lib/field/lab'
import { type LabField, nullBytesNeeded, type RegionKind, regionLabel, regionOf } from '~/lib/field/types'

const lab = useFieldLab()
const { params, field, overlays } = lab
const task = useTask<LabField>()

const COUNTS = [60, 100, 150, 250, 400, 600].map((n) => ({ label: `${n} points`, value: n }))
const REGIONS: { label: string; value: RegionKind }[] = [
  { label: 'Rectangle 100 × 80', value: 'rect' },
  { label: 'Disk, radius 50', value: 'disk' },
]
const NULL_SOURCES = [
  { label: 'Browser CSPRNG (instant)', value: 'local' as const },
  { label: 'The selected source', value: 'selected' as const },
  { label: 'Seeded DRBG control', value: 'drbg' as const },
]

const region = computed(() => regionOf(params.regionKind))
const marks = computed(() => Object.values(overlays).flat())
const blob = computed(() => plantedCount(params))

const drawBytes = computed(() => params.count * 8 + (blob.value > 0 ? blob.value * 8 : 0))

/** 99 simulated fields is the page's default Monte-Carlo size. */
const nullBytes = computed(() => nullBytesNeeded(99, params.count))

const GENERATING = ['count', 'regionKind', 'planted', 'plantedPercent', 'plantedRadius'] as const
const stale = computed(() => {
  const drawn = field.value?.params
  if (!drawn) return false
  return GENERATING.some((key) => drawn[key] !== params[key])
})

const density = computed(() => params.count / regionArea(region.value))

async function draw(): Promise<void> {
  const result = await task.run(async (signal, setProgress) => {
    setProgress(null)
    return await drawField(signal)
  })
  if (result) field.value = result
}

const snippet = computed(
  () => `import { sampleField } from '@mindpeeker/field'
import { byteReader } from '@mindpeeker/oracle'

const region = ${params.regionKind === 'rect' ? `{ kind: 'rect', width: 100, height: 80 }` : `{ kind: 'disk', radius: 50 }`} as const
const reader = byteReader(provider)          // one reader ⇒ disjoint bytes
const { points, accounting } = await sampleField(reader, ${params.count}, region)${
    params.planted
      ? `

// positive control: ${blob.value} of the ${params.count} points re-drawn into a tight blob
const { points: cluster } = await sampleField(reader, ${blob.value}, { kind: 'disk', radius: ${params.plantedRadius} })
const planted = [...points.slice(${blob.value}), ...cluster.map((p) => ({ x: ${params.regionKind === 'rect' ? 50 : 0} + p.x, y: ${params.regionKind === 'rect' ? 40 : 0} + p.y }))]`
      : ''
  }
await reader.close()
// accounting.bytesConsumed === ${drawBytes.value}  (8 bytes per point)`,
)

onMounted(() => {
  applyDefaultNullSource()
  // A beacon would have to serve a kilobyte before anything appears: local
  // sources draw straight away, network ones wait for a click.
  if (!sourceMeta().network) void draw()
})
</script>

<template>
  <DemoSection
    id="lab"
    title="The field"
    description="Two 32-bit coordinates per point, straight from the selected source: rect x = uW, y = vH; disk r = R√u, θ = 2πv. No modulo, no rounding bias — the draw is deterministic in the input bytes, so a seeded source gives the same field every time."
    :api="['sampleField', 'byteReader', 'regionArea']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Draw field"
        busy-label="Drawing…"
        icon="i-lucide-dices"
        :hint="`${fmtBytes(drawBytes)} from the selected source · a 99-run Monte-Carlo test below then costs ${fmtBytes(nullBytes)} of null-field bytes`"
        @run="draw"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="Points in the field" size="sm">
        <USelect v-model="params.count" :items="COUNTS" class="w-full" />
      </UFormField>
      <UFormField label="Study window W" size="sm" :hint="`A = ${fmtNum(regionArea(region), { digits: 0 })}`">
        <USelect v-model="params.regionKind" :items="REGIONS" class="w-full" />
      </UFormField>
      <UFormField
        label="Null-field bytes"
        size="sm"
        description="where every Monte-Carlo test below draws its simulated CSR fields"
      >
        <USelect v-model="params.nullSource" :items="NULL_SOURCES" class="w-full" />
      </UFormField>
      <div class="flex flex-col gap-2">
        <USwitch v-model="params.planted" label="Plant a cluster" />
        <p class="text-xs text-muted">
          A positive control: the tests should find it. Nothing about a real field is asserted by it.
        </p>
      </div>
      <UFormField
        v-if="params.planted"
        label="Blob share"
        :hint="`${params.plantedPercent}% = ${blob} points`"
        size="sm"
      >
        <USlider v-model="params.plantedPercent" :min="2" :max="25" :step="1" class="mt-2" />
      </UFormField>
      <UFormField
        v-if="params.planted"
        label="Blob radius"
        :hint="`${params.plantedRadius} units`"
        size="sm"
      >
        <USlider v-model="params.plantedRadius" :min="1" :max="20" :step="1" class="mt-2" />
      </UFormField>
    </div>

    <UAlert
      v-if="stale"
      color="warning"
      variant="subtle"
      icon="i-lucide-refresh-cw"
      title="The controls have moved past the drawn field"
      description="Points, window and the planted blob take effect on the next draw. Every section below still measures the field you can see."
      class="mt-4"
    />

    <div v-if="field" class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <FieldCanvas
        :points="field.points"
        :region="field.region"
        :overlays="marks"
        :highlight-from="field.plantedCount > 0 ? field.points.length - field.plantedCount : undefined"
        :aria-label="`${field.points.length} points in a ${regionLabel(field.region)} window`"
      />
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 content-start">
        <StatTile
          label="Points"
          :value="field.points.length"
          :digits="0"
          size="sm"
          :note="field.plantedCount > 0 ? `${field.plantedCount} of them in the planted blob` : 'all area-uniform under CSR'"
        />
        <StatTile
          label="Intensity λ = n / A"
          :value="density"
          :digits="5"
          size="sm"
          :note="`${regionLabel(field.region)} · A = ${fmtNum(regionArea(field.region), { digits: 0 })}`"
        />
        <StatTile
          label="Draw"
          size="sm"
          :value="fmtDuration(field.elapsedMs)"
          mono
          :note="`${fmtBytes(field.accounting.bytesConsumed)} consumed · 8 bytes per point`"
        />
        <AccountingBadge
          :bytes-consumed="field.accounting.bytesConsumed"
          :bytes-fetched="field.accounting.bytesFetched"
          :bits-used="field.accounting.bitsUsed"
          :source="field.source.providerName"
        />
      </div>
    </div>

    <HonestNote variant="caveat" title="Where the simulated null fields come from, and why it matters" class="mt-4">
      The field above is drawn from the source you picked in the header. The Monte-Carlo tests below
      need a hundred kilobytes more for their simulated CSR fields, which a public beacon cannot
      serve in a second — so this page draws them from
      <strong class="text-highlighted">{{ NULL_SOURCE_LABELS[params.nullSource] }}</strong>, and you
      can change that above. The distinction is real: simulate from the
      <em>same</em> source and a defect in it cancels out, so the test asks “is this field clustered
      for that source?”; simulate from a different good RNG and the same defect shows up as a small
      p, so the test asks “is this field CSR at all?”. Both are valid questions; only one of them is
      the one you meant.
    </HonestNote>

    <CodeSnippet class="mt-4" :code="snippet" title="what “Draw field” ran" />

    <template #footer>
      A field drawn from a good RNG <em>is</em> complete spatial randomness. Everything below tests
      against that null, so “an attractor appeared” is never news — only the calibrated p-values are.
    </template>
  </DemoSection>
</template>
