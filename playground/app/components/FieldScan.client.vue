<script setup lang="ts">
/**
 * Section 6 — Kulldorff's circular scan statistic: the most likely cluster
 * anywhere in the window, with the Monte-Carlo p of its likelihood ratio.
 */
import type { ScanResult } from '~/lib/field/jobs'
import { useFieldLab } from '~/lib/field/lab'
import { nullBytesNeeded } from '~/lib/field/types'
import { runFieldJob } from '~/lib/field/worker-client'
import { fmtBytes, fmtDuration, fmtNum } from '~/lib/format'

const { field, drawNullBytes, setOverlay } = useFieldLab()
const task = useTask<ScanResult>()

const RUNS = [99, 199, 499, 999].map((r) => ({ label: `${r} runs`, value: r }))
const FRACTIONS = [
  { label: '50 % of the window (SaTScan default)', value: 0.5 },
  { label: '25 % of the window', value: 0.25 },
  { label: '10 % of the window', value: 0.1 },
]

const runs = ref(99)
const maxFraction = ref(0.5)

const stamp = computed(() => {
  const f = field.value
  return f ? `${f.serial}:${runs.value}:${maxFraction.value}` : ''
})
const measured = ref('')
const fresh = computed(() => task.result.value !== undefined && measured.value === stamp.value)
const scan = computed(() => (fresh.value ? task.result.value : undefined))

const bytes = computed(() => nullBytesNeeded(runs.value, field.value?.points.length ?? 0))
const n = computed(() => field.value?.points.length ?? 0)
/**
 * O(runs · n² log n). The constant comes from measuring this build: a 150-point
 * field at 99 runs takes about 0.3 s, so ≈ 8 million (n² · runs) units a second.
 */
const estimateSeconds = computed(() => (n.value * n.value * runs.value) / 8_000_000)
const heavy = computed(() => estimateSeconds.value > 1.2)

watchEffect(() => {
  const s = scan.value
  if (!s?.cluster) {
    setOverlay('scan', undefined)
    return
  }
  setOverlay('scan', [
    {
      kind: 'circle',
      x: s.cluster.center.x,
      y: s.cluster.center.y,
      r: s.cluster.radius,
      color: 2,
      label: 'most likely cluster',
    },
  ])
})

onUnmounted(() => setOverlay('scan', undefined))

async function run(): Promise<void> {
  const f = field.value
  if (!f) return
  const at = stamp.value
  await task.run(async (signal, setProgress) => {
    setProgress(0)
    const nulls = await drawNullBytes(runs.value, f.points.length, signal)
    const out = await runFieldJob(
      'scan',
      {
        points: f.points,
        region: f.region,
        runs: runs.value,
        maxFraction: maxFraction.value,
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
  () => `import { scanStatistic } from '@mindpeeker/field'

// Null fields from the entropy source you are testing …
const scan = await scanStatistic(points, region, {
  runs: ${runs.value},
  maxFraction: ${maxFraction.value},
  source: reader,
})
// … or, with no source, from a seeded PRNG so the result is reproducible:
// await scanStatistic(points, region, { runs: ${runs.value}, seed: 0n })

scan.cluster   // { center, radius, count, expected, llr, relativeRisk }
scan.llr       // max over circles of c·ln(c/E) + (n−c)·ln((n−c)/(n−E)), for c > E
scan.pValue    // (1 + #{simulated max LLR ≥ observed}) / (runs + 1)`,
)
</script>

<template>
  <DemoSection
    id="scan"
    title="6 · Scan statistic — is there a cluster anywhere?"
    description="Circles centred on every point, radii stepping through its neighbours, window area capped: maximise the Poisson log-likelihood ratio with area as the population at risk. It answers “anywhere” without choosing a radius in advance — and pays for that with a Monte-Carlo p."
    :api="['scanStatistic', 'ScanCluster']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!field"
        :label="`Scan + ${runs} CSR fields`"
        busy-label="Scanning…"
        icon="i-lucide-radar"
        :hint="`${fmtBytes(bytes)} of null-field bytes · O(runs · n² log n) ≈ ${fmtNum(estimateSeconds, { digits: 1 })} s in the worker${heavy ? ' — long enough that the Cancel button matters' : ''}`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="Simulated CSR fields" size="sm">
        <USelect v-model="runs" :items="RUNS" class="w-full" />
      </UFormField>
      <UFormField label="Largest window" size="sm" description="SaTScan: at most half the population at risk">
        <USelect v-model="maxFraction" :items="FRACTIONS" class="w-full" />
      </UFormField>
      <StatTile
        label="Smallest reachable p"
        :value="1 / (runs + 1)"
        :digits="4"
        size="sm"
        note="1/(runs + 1) — the Monte-Carlo resolution floor"
      />
      <StatTile
        label="Windows examined"
        :value="n * n"
        :digits="0"
        size="sm"
        note="one per (centre, neighbour) pair, before the area cap"
      />
    </div>

    <div v-if="scan" class="mt-4 flex flex-col gap-4">
      <div v-if="scan.cluster" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Cluster centre"
          size="sm"
          :value="`(${fmtNum(scan.cluster.center.x, { digits: 1 })}, ${fmtNum(scan.cluster.center.y, { digits: 1 })})`"
          tone="primary"
          :note="`radius ${fmtNum(scan.cluster.radius, { digits: 2 })} — marked on the canvas`"
        />
        <StatTile
          label="Points inside c"
          :value="scan.cluster.count"
          :digits="0"
          size="sm"
          :note="`expected E = ${fmtNum(scan.cluster.expected, { digits: 3 })} = n·|B ∩ W|/A`"
        />
        <StatTile
          label="Log-likelihood ratio"
          :value="scan.llr"
          :digits="3"
          size="sm"
          note="the scan statistic itself — not a p"
        />
        <StatTile
          label="Relative risk"
          :value="scan.cluster.relativeRisk"
          :digits="1"
          size="sm"
          tone="warning"
          note="(c/E)/((n−c)/(n−E)) — huge for a tiny window, and meaningless on its own"
        />
        <StatTile label="Monte-Carlo p" size="sm" :tone="scan.pValue < 0.05 ? 'primary' : 'neutral'">
          <template #value><PValue :p="scan.pValue" kind="exact" label="p" /></template>
          <template #note>rank {{ scan.rank }} of {{ scan.runs + 1 }} maxima</template>
        </StatTile>
        <StatTile
          label="Run"
          size="sm"
          :value="fmtDuration(scan.elapsedMs)"
          :note="`${scan.runs} simulated fields in a Web Worker`"
        />
        <AccountingBadge
          :bytes-consumed="scan.accounting.bytesConsumed"
          :bits-used="scan.accounting.bitsUsed"
          :source="`${scan.runs} simulated fields`"
        />
      </div>

      <UAlert
        v-else
        color="neutral"
        variant="subtle"
        icon="i-lucide-circle-dot"
        title="No window holds more points than its area expects"
        :description="`Every candidate circle had c ≤ E, so the statistic is 0 and p = ${fmtNum(scan.pValue, { digits: 4 })}. That happens on very sparse fields.`"
      />
    </div>

    <UAlert
      v-if="task.result.value && !fresh"
      color="neutral"
      variant="subtle"
      icon="i-lucide-refresh-cw"
      title="That scan belongs to an earlier field or window cap"
      description="Run it again for the field on the canvas."
      class="mt-4"
    />

    <HonestNote variant="caveat" title="Relative risk is not the finding; the p is">
      With area as the population at risk, two points a hair apart form a circle whose expectation is
      almost zero, so the relative risk can run into the hundreds on a perfectly random field — you
      will see that on the canvas as a pinprick circle. The likelihood ratio of such a window is
      small, and the Monte-Carlo rank prices it correctly, because the simulated fields contain the
      same kind of accident. Read the p, not the risk ratio.
    </HonestNote>

    <CodeSnippet class="mt-4" :code="snippet" title="what this section ran" />

    <template #footer>
      Without a <code class="font-mono">source</code> the null fields come from a seeded xoshiro128**
      PRNG (<code class="font-mono">seed</code>, default 0), so a scan is reproducible offline;
      passing both <code class="font-mono">source</code> and <code class="font-mono">seed</code>
      throws <code class="font-mono">invalid_config</code>. This page passes the null-field bytes you
      chose in the lab above.
    </template>
  </DemoSection>
</template>
