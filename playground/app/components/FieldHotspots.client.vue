<script setup lang="ts">
/**
 * Section 1 — attractors and voids: the single-point tail next to the
 * calibrated whole-field Monte-Carlo p, which is the number to report.
 */
import { attractors, type FieldResult } from '@mindpeeker/field'
import { errorLine } from '~/lib/errors'
import { useFieldLab } from '~/lib/field/lab'
import type { SignificanceResult } from '~/lib/field/jobs'
import { countShape, interiorProbability, neighbourCounts } from '~/lib/field/stats'
import { nullBytesNeeded } from '~/lib/field/types'
import { runFieldJob } from '~/lib/field/worker-client'
import { fmtBytes, fmtDuration, fmtNum } from '~/lib/format'

const { field, drawNullBytes, setOverlay } = useFieldLab()
const task = useTask<SignificanceResult>()

const RUNS = [99, 199, 499, 999].map((r) => ({ label: `${r} runs`, value: r }))

const runs = ref(99)
const fixRadius = ref(false)
const expectedNeighbours = ref(4)
const radius = ref(8)

/** The radius options exactly as the SDK takes them (never both at once). */
const radiusOpts = computed(() =>
  fixRadius.value ? { radius: radius.value } : { expectedNeighbours: expectedNeighbours.value },
)

const result = computed<{ ok?: FieldResult; error?: unknown }>(() => {
  const f = field.value
  if (!f) return {}
  try {
    return { ok: attractors(f.points, f.region, radiusOpts.value) }
  } catch (error) {
    return { error }
  }
})

const counts = computed(() => {
  const f = field.value
  const r = result.value.ok
  if (!f || !r) return undefined
  return neighbourCounts(f.points, r.radius)
})

const shape = computed(() => {
  const f = field.value
  const r = result.value.ok
  const c = counts.value
  if (!f || !r || !c) return undefined
  return countShape(c, f.points.length, interiorProbability(r.radius, f.region))
})

const highlight = computed(() => {
  const r = result.value.ok
  const s = shape.value
  if (!r || !s) return []
  return [r.attractor.neighbours, r.void.neighbours].filter((k) => k <= s.max)
})

/** The whole-field p belongs to one field and one radius; say so when it drifts. */
const stamp = computed(() => {
  const f = field.value
  const r = result.value.ok
  return f && r ? `${f.serial}:${r.radius.toFixed(6)}` : ''
})
const measured = ref('')
const fresh = computed(() => task.result.value !== undefined && measured.value === stamp.value)

const bytes = computed(() => nullBytesNeeded(runs.value, field.value?.points.length ?? 0))

watchEffect(() => {
  const r = result.value.ok
  if (!r) {
    setOverlay('hotspots', undefined)
    return
  }
  setOverlay('hotspots', [
    { kind: 'circle', x: r.attractor.point.x, y: r.attractor.point.y, r: r.radius, color: 3, label: 'attractor disk' },
    { kind: 'circle', x: r.void.point.x, y: r.void.point.y, r: r.radius, color: 4, label: 'void disk', dashed: true },
  ])
})

onUnmounted(() => setOverlay('hotspots', undefined))

async function run(): Promise<void> {
  const f = field.value
  if (!f) return
  const at = stamp.value
  await task.run(async (signal, setProgress) => {
    setProgress(0)
    const nulls = await drawNullBytes(runs.value, f.points.length, signal)
    const out = await runFieldJob(
      'significance',
      { points: f.points, region: f.region, runs: runs.value, bytes: nulls.bytes, ...radiusOpts.value },
      signal,
      setProgress,
    )
    measured.value = at
    return out
  })
}

const snippet = computed(
  () => `import { attractors, fieldSignificance } from '@mindpeeker/field'

const { attractor, void: empty, radius } = attractors(points, region, ${
    fixRadius.value ? `{ radius: ${radius.value} }` : `{ expectedNeighbours: ${expectedNeighbours.value} }`
  })
attractor.neighbours          // k, the densest count
attractor.expected            // µ = (n−1)·|B(p, r) ∩ W| / A — the disk clipped by W
attractor.pSingle             // exact Binomial(n−1, |B ∩ W|/A) tail, P(X ≥ k)

// The honest number: how extreme is the MAXIMUM of n dependent counts?
const whole = await fieldSignificance(reader, points, region, { runs: ${runs.value} })
whole.attractor.p             // (1 + #{simulated ≥ observed}) / (runs + 1)`,
)
</script>

<template>
  <DemoSection
    id="hotspots"
    title="1 · Hotspots — attractor and void"
    description="Every point is scored by how many others lie within the neighbourhood radius; the maximum is the attractor, the minimum the void. Both carry an exact single-point tail — and neither is a test of the field."
    :api="['attractors', 'fieldSignificance', 'binomialPmf']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!field"
        :label="`Run ${runs} CSR fields`"
        busy-label="Simulating…"
        icon="i-lucide-crosshair"
        :hint="`${fmtBytes(bytes)} of null-field bytes · smallest reachable p = ${fmtNum(1 / (runs + 1), { digits: 4 })}`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
    <UAlert
      v-if="result.error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="attractors rejected these options"
      :description="errorLine(result.error)"
      class="mb-4"
    />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="Simulated CSR fields" size="sm">
        <USelect v-model="runs" :items="RUNS" class="w-full" />
      </UFormField>
      <UFormField
        v-if="!fixRadius"
        label="Target neighbours µ"
        :hint="`${expectedNeighbours}`"
        size="sm"
        description="radius solves (n−1)πr²/A = µ"
      >
        <USlider v-model="expectedNeighbours" :min="1" :max="12" :step="1" class="mt-2" />
      </UFormField>
      <UFormField v-else label="Radius r" :hint="`${radius} units`" size="sm">
        <USlider v-model="radius" :min="1" :max="30" :step="1" class="mt-2" />
      </UFormField>
      <div class="flex items-end pb-2">
        <USwitch v-model="fixRadius" label="Set the radius directly" />
      </div>
      <StatTile
        v-if="result.ok"
        label="Radius in use"
        :value="result.ok.radius"
        size="sm"
        :note="`interior expectation (n−1)πr²/A = ${fmtNum(result.ok.expectedNeighbours, { digits: 2 })}`"
      />
    </div>

    <div v-if="result.ok" class="mt-4 grid gap-4 lg:grid-cols-2">
      <div class="rounded-md border border-default p-3">
        <h3 class="text-sm font-semibold text-highlighted">Attractor — densest neighbourhood</h3>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <StatTile label="Neighbours k" :value="result.ok.attractor.neighbours" :digits="0" size="sm" tone="success" />
          <StatTile label="Expected µ (edge-corrected)" :value="result.ok.attractor.expected" :digits="2" size="sm" />
          <StatTile label="Power k/µ" :value="result.ok.attractor.power" :digits="2" size="sm" />
          <StatTile label="z = (k−µ)/√µ" :value="result.ok.attractor.z" :digits="2" size="sm" />
          <StatTile label="pSingle — one pre-chosen point" size="sm">
            <template #value><PValue :p="result.ok.attractor.pSingle" kind="exact" label="p" /></template>
            <template #note>exact Binomial(n−1, |B ∩ W|/A) upper tail</template>
          </StatTile>
          <StatTile label="Whole-field p (attractor)" size="sm" :tone="fresh ? 'primary' : 'neutral'">
            <template #value>
              <PValue v-if="fresh" :p="task.result.value?.attractor.p" kind="exact" label="p" />
              <span v-else class="text-dimmed text-base">run the simulation</span>
            </template>
            <template #note>
              <span v-if="fresh">rank {{ task.result.value?.attractor.rank }} of {{ (task.result.value?.runs ?? 0) + 1 }} — Besag &amp; Diggle Monte-Carlo</span>
              <span v-else>a per-point tail cannot answer this</span>
            </template>
          </StatTile>
        </div>
      </div>

      <div class="rounded-md border border-default p-3">
        <h3 class="text-sm font-semibold text-highlighted">Void — sparsest neighbourhood</h3>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <StatTile label="Neighbours k" :value="result.ok.void.neighbours" :digits="0" size="sm" tone="warning" />
          <StatTile label="Expected µ (edge-corrected)" :value="result.ok.void.expected" :digits="2" size="sm" />
          <StatTile label="Power k/µ" :value="result.ok.void.power" :digits="2" size="sm" />
          <StatTile label="z = (k−µ)/√µ" :value="result.ok.void.z" :digits="2" size="sm" />
          <StatTile label="pSingle — one pre-chosen point" size="sm">
            <template #value><PValue :p="result.ok.void.pSingle" kind="exact" label="p" /></template>
            <template #note>exact lower tail P(X ≤ k)</template>
          </StatTile>
          <StatTile label="Whole-field p (void)" size="sm">
            <template #value>
              <PValue v-if="fresh" :p="task.result.value?.void.p" kind="exact" label="p" />
              <span v-else class="text-dimmed text-base">run the simulation</span>
            </template>
            <template #note>
              <span v-if="fresh">rank {{ task.result.value?.void.rank }} of {{ (task.result.value?.runs ?? 0) + 1 }} — usually near 1</span>
              <span v-else>the sparsest point of a random field almost always has 0 neighbours</span>
            </template>
          </StatTile>
        </div>
      </div>
    </div>

    <UAlert
      v-if="task.result.value && !fresh"
      color="neutral"
      variant="subtle"
      icon="i-lucide-refresh-cw"
      title="That p belongs to an earlier field or radius"
      description="The Monte-Carlo test is registered against one field and one radius. Run it again for the field on the canvas."
      class="mt-4"
    />

    <div v-if="shape" class="mt-4">
      <BarChart
        :categories="shape.categories"
        :values="shape.observed"
        :expected="shape.expected"
        expected-label="exact interior Binomial(n−1, πr²/A)"
        :highlight="highlight"
        x-label="neighbours within r"
        y-label="points"
        :height="240"
        aria-label="Neighbour-count distribution against its exact binomial reference"
      />
      <p class="mt-2 text-xs text-muted">
        The reference is the <em>interior</em> binomial (no edge clipping), so it sits a little above
        the observed counts near the boundary; the per-point statistics above use the clipped area
        |B(p, r) ∩ W| instead. Highlighted bars are the attractor's and the void's counts.
      </p>
    </div>

    <div v-if="fresh && task.result.value" class="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
      <AccountingBadge
        :bytes-consumed="task.result.value.accounting.bytesConsumed"
        :bits-used="task.result.value.accounting.bitsUsed"
        :source="`${task.result.value.runs} simulated fields`"
      />
      <span>{{ fmtDuration(task.result.value.elapsedMs) }} in a Web Worker</span>
    </div>

    <HonestNote variant="contested" title="A per-point tail is not a field-level test">
      <code class="font-mono">pSingle</code> is exact for a neighbourhood chosen <strong>before</strong>
      looking. The attractor is the largest of n dependent counts, chosen after looking: in the
      package's CSR simulations (rect 100 × 80, default radius) the attractor's
      <code class="font-mono">pSingle</code> was ≤ 0.05 in 58 % of fields at n = 60 and in
      <strong>100 %</strong> of fields at n = 300. The whole-field Monte-Carlo p is calibrated —
      under CSR it was ≤ 0.05 in 4.0 % of fields at n = 60 and 4.7 % at n = 300. Randonautica-style
      engines report the first number; this one reports both and says which is which.
    </HonestNote>

    <CodeSnippet class="mt-4" :code="snippet" title="what this section ran" />

    <template #footer>
      Register the statistic, the radius and the run count before the field is drawn. A small
      whole-field p says the pattern is unlikely under CSR from <em>this</em> source — a source
      defect, a sampling bug and a hypothesised intention effect all qualify, and hardware bias is
      the first suspect.
    </template>
  </DemoSection>
</template>
