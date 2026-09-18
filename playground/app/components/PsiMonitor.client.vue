<script setup lang="ts">
/**
 * Section 7b — rolling monitors: a dashboard scale for watching, explicitly
 * not a test. Windows are recomputed from scratch per emission, so a batch
 * recomputation over the same trials reproduces every point exactly.
 */
import {
  type RollingPoint,
  rollingNetvar,
  rollingStouffer,
  type TrialSource,
} from '@mindpeeker/psi'
import { createYielder } from '~/lib/async'
import { drbgSource, provider, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { bytesFor } from '~/lib/psi/synthetic'

const BITS = 200

const monitor = ref<'stouffer' | 'netvar'>('stouffer')
const windowSize = ref(20)
const hopSize = ref(1)
const points = ref(40)
const useSelected = ref(true)

const MONITORS = [
  { label: 'rollingStouffer — the window\'s Stouffer z', value: 'stouffer' },
  { label: 'rollingNetvar — Φ⁻¹(1 − p) of the window χ²', value: 'netvar' },
]

const source = computed(() => sourceSummary())
const trialsNeeded = computed(() => windowSize.value + (points.value - 1) * hopSize.value)
const perSource = computed(() => bytesFor(trialsNeeded.value, BITS))
const hint = computed(() =>
  useSelected.value && source.value.network
    ? `${fmtBytes(perSource.value)} of it from ${source.value.label} — about ${Math.ceil(perSource.value / 32)} beacon rounds. Cancel stops it at once.`
    : `${trialsNeeded.value} rounds × 3 sources ≈ ${fmtBytes(perSource.value * 3)}, all local`,
)

interface MonitorRun {
  points: RollingPoint[]
  kind: 'stouffer' | 'netvar'
  sources: string[]
  crossings: number
}

const task = useTask<MonitorRun>()
const run = computed(() => task.result.value)

function go(): void {
  void task.run(async (signal, setProgress) => {
    restartSource()
    const tick = createYielder(8, signal)
    const sources: TrialSource[] = [
      useSelected.value ? provider : drbgSource(`${currentSeedLabel()} / monitor-A`),
      drbgSource(`${currentSeedLabel()} / monitor-B`),
      drbgSource(`${currentSeedLabel()} / monitor-C`),
    ]
    const options = {
      windowSize: windowSize.value,
      hopSize: hopSize.value,
      bitsPerTrial: BITS,
      signal,
      stepTimeoutMs: 30_000,
    }
    const stream =
      monitor.value === 'stouffer' ? rollingStouffer(sources, options) : rollingNetvar(sources, options)
    const collected: RollingPoint[] = []
    let crossings = 0
    for await (const point of stream) {
      collected.push(point)
      if (Math.abs(point.z) >= 2) crossings++
      setProgress(collected.length / points.value)
      await tick()
      if (collected.length >= points.value) break
    }
    return {
      points: collected,
      kind: monitor.value,
      sources: sources.map((s) => s.name),
      crossings,
    }
  })
}

const chart = computed(() => {
  const r = run.value
  if (!r?.points.length) return undefined
  return {
    series: [
      {
        name: r.kind === 'stouffer' ? 'window Stouffer z' : 'window netvar z',
        y: r.points.map((p) => p.z),
        color: r.kind === 'stouffer' ? 1 : 2,
      },
    ],
    x: r.points.map((_, i) => i + 1),
  }
})

const last = computed(() => run.value?.points.at(-1))
const extremes = computed(() => {
  const zs = run.value?.points.map((p) => p.z) ?? []
  return zs.length ? { min: Math.min(...zs), max: Math.max(...zs) } : undefined
})

const snippet = computed(
  () => `import { ${monitor.value === 'stouffer' ? 'rollingStouffer' : 'rollingNetvar'} } from '@mindpeeker/psi'

for await (const point of ${monitor.value === 'stouffer' ? 'rollingStouffer' : 'rollingNetvar'}(sources, {
  windowSize: ${windowSize.value}, hopSize: ${hopSize.value}, bitsPerTrial: 200,
})) {
  dashboard.push(point.at, point.z, point.n, point.sourceCount)
}`,
)
</script>

<template>
  <DemoSection
    id="presentiment-monitor"
    title="2 · Rolling monitors — for watching, not claiming"
    description="Both monitors emit on one shared N(0,1) dashboard scale: rollingStouffer the window's Stouffer z, rollingNetvar the normal-equivalent of the window χ²'s upper tail."
    :api="['rollingStouffer', 'rollingNetvar', 'RollingPoint.sourceCount']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Watch ${points} windows`"
        busy-label="Watching…"
        :hint="hint"
        @run="go"
        @cancel="task.cancel()"
      />
      <UFormField label="Monitor" class="min-w-72">
        <USelect v-model="monitor" :items="MONITORS" class="w-full" />
      </UFormField>
      <UFormField label="Window (trials)">
        <UInputNumber v-model="windowSize" :min="1" :max="200" class="w-28" />
      </UFormField>
      <UFormField label="Hop (trials)">
        <UInputNumber v-model="hopSize" :min="1" :max="50" class="w-24" />
      </UFormField>
      <UFormField label="Points">
        <UInputNumber v-model="points" :min="5" :max="300" :step="5" class="w-28" />
      </UFormField>
      <USwitch
        v-model="useSelected"
        label="include the header source"
        description="otherwise three seeded DRBGs"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div v-if="run && last" class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="latest z" :value="last.z" :digits="3" :tone="Math.abs(last.z) >= 3 ? 'warning' : 'neutral'" :note="`window of ${last.n} trials`" />
        <StatTile
          label="sources in the newest trial"
          :value="last.sourceCount"
          :digits="0"
          note="a source that ends just drops from the roster"
        />
        <StatTile
          label="range over the run"
          :value="extremes ? `${fmtNum(extremes.min, { digits: 2 })} … ${fmtNum(extremes.max, { digits: 2 })}` : '—'"
          size="sm"
          note="min and max of the window statistic"
        />
        <StatTile
          label="|z| ≥ 2 somewhere"
          :value="`${run.crossings} / ${run.points.length}`"
          :tone="run.crossings ? 'warning' : 'neutral'"
          size="sm"
          note="overlapping windows: expect far more than 5 %"
        />
      </div>

      <LineChart
        v-if="chart"
        :series="chart.series"
        :x="chart.x"
        :hlines="[
          { value: 0, label: 'chance', dashed: false },
          { value: 1.96 },
          { value: -1.96, label: '±1.96 pointwise' },
          { value: 3, label: '±3' },
          { value: -3 },
        ]"
        x-label="window"
        y-label="z"
        :height="260"
        :format="(v) => fmtNum(v, { digits: 3 })"
        aria-label="rolling window statistic over time against the pointwise reference lines"
      />

      <p class="text-xs text-muted font-mono">sources: {{ run.sources.join(' · ') }}</p>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>
    <p v-else-if="!task.busy.value" class="text-sm text-muted">
      Nothing is being watched yet. The monitors pull in lock-step, so a slow network source sets
      the pace for all three — Cancel closes every stream.
    </p>

    <HonestNote variant="caveat">
      A monitor scans many overlapping windows, so crossing z = 3 <em>somewhere</em> is expected
      under H₀ far more often than Φ(−3) suggests. Claims belong to pre-registered windows and to
      the anytime-valid boundary in the Bayes tab; this panel is a dashboard.
      <code class="font-mono">rollingNetvar</code> also never reports below the exact discrete floor
      Φ⁻¹(P_min) of integer trial sums — −1.59 for one 200-bit source and a one-trial window.
    </HonestNote>
  </DemoSection>
</template>
