<script setup lang="ts">
/**
 * Section 6 — the lab. Two independent simulated data sets, drawn from the
 * header-selected entropy source: one to explore with the scan, one to confirm
 * a window that was registered from that exploration. Every LST section below
 * reads what this section produced.
 */
import {
  applyDefaultByteSource,
  type DatasetPair,
  DEFAULT_PARAMS,
  drawDatasets,
  LABS,
  bytesNeeded,
  selectedLabs,
  useEphemerisLab,
} from '~/lib/ephemeris/lab'
import { fmtBytes, fmtDuration, fmtNum } from '~/lib/format'

const { params, data } = useEphemerisLab()
const task = useTask<DatasetPair>()

onMounted(applyDefaultByteSource)

const TRIALS = [300, 600, 1200, 2400].map((n) => ({ label: `${n} trials per set`, value: n }))
const SPANS = [
  { label: '182 days', value: 182 },
  { label: '365 days (1 year)', value: 365 },
  { label: '730 days (2 years)', value: 730 },
  { label: '1460 days (4 years)', value: 1460 },
]
const SOURCES = [
  { label: 'the header-selected source', value: 'selected' },
  { label: 'the browser CSPRNG', value: 'local' },
]

const labCount = computed(() => selectedLabs(params).length)
const bytes = computed(() => bytesNeeded(params) * 2)
/** A beacon serves 32 bytes a round; this many bytes would be hundreds of requests. */
const slowSource = computed(
  () => params.byteSource === 'selected' && (sourceMeta().network || sourceMeta().kind === 'trng'),
)

function toggleLab(id: string, on: boolean): void {
  const next = new Set(params.labIds)
  if (on) next.add(id)
  else next.delete(id)
  if (next.size === 0) return
  params.labIds = LABS.filter((l) => next.has(l.id)).map((l) => l.id)
}

function reset(): void {
  Object.assign(params, { ...DEFAULT_PARAMS, labIds: [...DEFAULT_PARAMS.labIds] })
}

async function run(): Promise<void> {
  const pair = await task.run((signal, setProgress) => drawDatasets(signal, setProgress))
  if (pair) data.value = pair
}

const pair = computed(() => data.value)

const normal = (x: number): number => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)

const labBreakdown = computed(() => {
  const set = pair.value?.exploration
  if (!set) return []
  const counts = new Map<number, number>()
  for (const index of set.columns.labIndex) counts.set(index, (counts.get(index) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, n]) => ({ name: LABS[index]?.name ?? `lab ${index}`, n }))
})

const snippet = computed(
  () => `import { julianDay, type LstTimedTrial, lst } from '@mindpeeker/ephemeris'
import { probitBytes } from '@mindpeeker/negentropy'
import { byteReader, uniformInt } from '@mindpeeker/oracle'

const labs = ${JSON.stringify(selectedLabs(params).map((l) => ({ id: l.id, lon: l.lon })))}
const plant = { centerHours: ${params.centerHours}, halfWidthHours: ${params.halfWidthHours}, shift: ${params.shift} }
const reader = byteReader(source)                       // the selected entropy source

const bytes = new Uint8Array(${params.trials})
for (let i = 0; i < bytes.length; i++) bytes[i] = await uniformInt(reader, 256)
const noise = probitBytes(bytes, { source: 'exploration' })   // exactly N(0, 1) under H0

const trials: LstTimedTrial[] = []
for (let i = 0; i < ${params.trials}; i++) {
  const lab = labs[await uniformInt(reader, labs.length)]
  const day = await uniformInt(reader, ${params.spanDays})
  const localMinutes = ${params.dayStartHour} * 60 + (await uniformInt(reader, ${(params.dayEndHour - params.dayStartHour) * 60}))
  const utcMinutes = day * 1440 + localMinutes - (lab.lon / 15) * 60
  const time = new Date(Date.UTC(2024, 0, 1) + Math.round(utcMinutes * 60_000))
  const hours = lst(julianDay(time), lab.lon)
  const inside = Math.abs(((hours - plant.centerHours + 36) % 24) - 12) < plant.halfWidthHours
  trials.push({ time, longitudeEastDeg: lab.lon, effect: noise[i] + (inside ? plant.shift : 0), stratum: lab.id })
}
await reader.close()`,
)
</script>

<template>
  <DemoSection
    id="lab"
    title="6 · The lab — two simulated data sets"
    description="Three laboratories at widely separated longitudes run daytime sessions over a recruitment period. Every effect is exactly N(0, 1) under the null (one byte through the probit map), plus an optional planted shift inside one LST window — the positive control that shows the tests below have power. Two sets are drawn: one to explore, one to confirm."
    :api="['lst', 'julianDay', 'LstTimedTrial', 'probitBytes', 'byteReader', 'uniformInt']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Draw 2 × ${params.trials} trials`"
        busy-label="Drawing…"
        icon="i-lucide-flask-conical"
        :hint="`≈ ${fmtBytes(bytes)} from ${params.byteSource === 'local' ? 'the browser CSPRNG' : 'the selected source'} · ${labCount} ${labCount === 1 ? 'lab' : 'labs'}`"
        @run="run"
        @cancel="task.cancel()"
      >
        <UButton variant="soft" color="neutral" :disabled="task.busy.value" @click="reset">
          Reset parameters
        </UButton>
      </RunControls>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UFormField label="Trials per data set" size="sm">
          <USelect v-model="params.trials" :items="TRIALS" class="w-full" />
        </UFormField>
        <UFormField label="Recruitment span" size="sm">
          <USelect v-model="params.spanDays" :items="SPANS" class="w-full" />
        </UFormField>
        <UFormField label="Planted shift (SD)" size="sm" description="0 = a pure null data set">
          <UInput v-model.number="params.shift" type="number" step="0.1" min="0" max="2" class="w-full" />
        </UFormField>
        <UFormField label="Bytes from" size="sm">
          <USelect v-model="params.byteSource" :items="SOURCES" class="w-full" />
        </UFormField>
        <UFormField label="Planted LST centre (h)" size="sm">
          <UInput v-model.number="params.centerHours" type="number" step="0.5" min="0" max="23.9" class="w-full" />
        </UFormField>
        <UFormField label="Planted half width (h)" size="sm">
          <UInput v-model.number="params.halfWidthHours" type="number" step="0.25" min="0.25" max="6" class="w-full" />
        </UFormField>
        <UFormField label="Sessions start after (local h)" size="sm">
          <UInput v-model.number="params.dayStartHour" type="number" step="1" min="0" max="22" class="w-full" />
        </UFormField>
        <UFormField label="…and before (local h)" size="sm">
          <UInput v-model.number="params.dayEndHour" type="number" step="1" min="1" max="24" class="w-full" />
        </UFormField>
      </div>

      <fieldset class="rounded-md border border-default p-3">
        <legend class="px-1 text-xs uppercase tracking-wide text-muted">Laboratories</legend>
        <div class="flex flex-wrap gap-4">
          <UCheckbox
            v-for="lab in LABS"
            :key="lab.id"
            :model-value="params.labIds.includes(lab.id)"
            :label="`${lab.name} (λ = ${lab.lon}°)`"
            @update:model-value="(v) => toggleLab(lab.id, v === true)"
          />
        </div>
      </fieldset>

      <UAlert
        v-if="slowSource"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="`${sourceLabel()} cannot serve ${fmtBytes(bytes)} quickly`"
        :description="`A beacon delivers 32 bytes a round and the timing-jitter source takes milliseconds a byte, so this draw would need hundreds of requests. It will still run — the fallback to the local CSPRNG covers a blocked beacon, and Cancel stops it — but “the browser CSPRNG” is the setting that finishes in one frame.`"
      />

      <UAlert
        v-if="params.byteSource === 'local'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="These bytes come from the browser CSPRNG, not the header source"
        :description="`A beacon serves 32 bytes a round and the timing-jitter source is slow, so ${fmtBytes(bytes)} would take minutes. Switch “Bytes from” back to the selected source when it is the local CSPRNG or the seeded DRBG — with the DRBG the same seed label reproduces both data sets exactly.`"
      />

      <template v-if="pair">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Trials drawn" :value="pair.exploration.columns.effect.length * 2" :digits="0" size="sm" note="exploration + confirmation, disjoint bytes" />
          <StatTile
            label="Planted trials (exploration)"
            :value="pair.exploration.plantedCount"
            :digits="0"
            size="sm"
            :tone="pair.params.shift > 0 ? 'warning' : 'neutral'"
            :note="pair.params.shift > 0 ? `+${fmtNum(pair.params.shift, { digits: 2 })} SD inside ${fmtNum(pair.params.centerHours, { digits: 2 })} h ± ${fmtNum(pair.params.halfWidthHours, { digits: 2 })} h` : 'no shift — a pure null set'"
          />
          <StatTile label="Planted trials (confirmation)" :value="pair.confirmation.plantedCount" :digits="0" size="sm" note="the same window, fresh data" />
          <StatTile label="Drawn in" :value="fmtDuration(pair.elapsedMs)" size="sm" :note="`data set #${pair.serial} in this tab`" />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <AccountingBadge
            :bytes-consumed="pair.accounting.bytesConsumed"
            :bytes-fetched="pair.accounting.bytesFetched"
            :source="pair.source.providerName"
          />
          <UBadge v-if="pair.source.deterministic" color="primary" variant="subtle" size="sm">
            reproducible — seed “{{ pair.source.seedLabel }}”
          </UBadge>
          <UBadge v-for="row in labBreakdown" :key="row.name" color="neutral" variant="outline" size="sm">
            {{ row.name }}: {{ row.n }}
          </UBadge>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div>
            <h4 class="mb-1 text-sm font-semibold text-highlighted">
              Where the exploration trials landed in sidereal time
            </h4>
            <Histogram
              :values="pair.exploration.columns.lstHours"
              :bins="24"
              :domain="[0, 24]"
              :color="1"
              x-label="local sidereal time (hours)"
              y-label="trials"
              :height="220"
              aria-label="Distribution of the simulated trials over local sidereal time"
            />
          </div>
          <div>
            <h4 class="mb-1 text-sm font-semibold text-highlighted">
              The effects themselves, against the N(0, 1) they are drawn from
            </h4>
            <Histogram
              :values="pair.exploration.columns.effect"
              :bins="40"
              density
              :reference="normal"
              reference-label="N(0, 1) — the exact null"
              :color="2"
              x-label="effect size"
              y-label="density"
              :height="220"
              aria-label="Distribution of the simulated effect sizes against the standard normal"
            />
          </div>
        </div>

        <HonestNote variant="caveat" title="A simulation is a power check, not evidence">
          The effects here are manufactured: N(0, 1) noise plus a shift this page put inside a
          window it chose. Finding that shift shows the tests below can find an effect of that size
          in a data set of that shape. It says nothing whatever about whether real free-response
          data behave that way — and with the shift set to 0, every rejection you see is a false
          positive by construction, which is the more useful setting to spend time in.
        </HonestNote>

        <CodeSnippet :code="snippet" title="what the lab ran" />
      </template>

      <p v-else class="text-sm text-muted">
        Draw a pair of data sets to switch on the four analyses below.
      </p>
    </div>

    <template #footer>
      Sessions are booked by the local clock, so the UT of a trial depends on the lab's longitude
      and its LST on both. With a seeded DRBG as the source, the same seed label and the same
      parameters reproduce both data sets byte for byte.
    </template>
  </DemoSection>
</template>
