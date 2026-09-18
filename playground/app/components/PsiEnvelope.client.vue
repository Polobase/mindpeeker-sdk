<script setup lang="ts">
/**
 * Section 4b — the whole curve at once: a global rank envelope (Myllymäki et
 * al. 2017) beside the pointwise χ² envelope, and Westfall–Young maxT over a
 * handful of pre-declared checkpoints.
 */
import {
  cumulativeDeviation,
  probitBytes,
  significanceEnvelope,
} from '@mindpeeker/negentropy'
import {
  type AdjustedPValues,
  type GlobalRankEnvelope,
  globalRankEnvelope,
  holm,
  maxTAdjust,
  permutationP,
} from '@mindpeeker/psi'
import { createYielder } from '~/lib/async'
import { fmtBytes, fmtNum, fmtP } from '~/lib/format'
import { type SimSource, simBytes } from '~/lib/psi/synthetic'

const steps = ref(200)
const simulations = ref(199)
const alpha = ref(0.05)
const drift = ref(0)
const simSource = ref<SimSource>('drbg')

const SIM_SOURCES: { label: string; value: SimSource }[] = [
  { label: 'seeded DRBG — reproducible', value: 'drbg' },
  { label: 'browser CSPRNG — fresh curves every run', value: 'crypto' },
]

const budget = computed(() => (simulations.value + 1) * steps.value)

interface EnvelopeResult {
  observed: Float64Array
  envelope: GlobalRankEnvelope
  pointwise: Float64Array
  checkpoints: number[]
  observedAt: number[]
  marginal: number[]
  maxT: AdjustedPValues
  holmed: AdjustedPValues
  crossedPointwise: number
  crossedGlobal: boolean
}

const task = useTask<EnvelopeResult>()
const result = computed(() => task.result.value)

function go(): void {
  void task.run(async (signal, setProgress) => {
    const T = steps.value
    const s = simulations.value
    const tick = createYielder(8, signal)
    const bytes = await simBytes(budget.value, simSource.value, 'psi global envelope', signal)

    // One N(0,1) per byte (probitBytes), so a 200-step curve costs 200 bytes.
    const observedZ = probitBytes(bytes.subarray(0, T), { source: 'observed' })
    if (drift.value !== 0) {
      for (let t = Math.floor(T / 3); t < Math.floor((2 * T) / 3); t++) {
        observedZ[t] = (observedZ[t] as number) + drift.value
      }
    }
    const observed = cumulativeDeviation(observedZ)
    const simulated: Float64Array[] = []
    for (let i = 0; i < s; i++) {
      const start = (i + 1) * T
      simulated.push(
        cumulativeDeviation(probitBytes(bytes.subarray(start, start + T), { source: `path-${i}` })),
      )
      setProgress((i + 1) / s)
      await tick()
    }

    const envelope = globalRankEnvelope(observed, simulated, { alpha: alpha.value })
    const pointwise = significanceEnvelope(T, alpha.value)
    let crossedPointwise = 0
    for (let t = 0; t < T; t++) {
      if ((observed[t] as number) > (pointwise[t] as number)) crossedPointwise++
    }

    // Five checkpoints, declared by position rather than by where the curve went.
    const checkpoints = [0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.max(1, Math.round(f * T)) - 1)
    const observedAt = checkpoints.map((t) => observed[t] as number)
    const rows = simulated.map((curve) => checkpoints.map((t) => curve[t] as number))
    const marginal = checkpoints.map((t, i) =>
      permutationP(
        observedAt[i] as number,
        rows.map((row) => row[i] as number),
      ),
    )
    return {
      observed,
      envelope,
      pointwise,
      checkpoints,
      observedAt,
      marginal,
      maxT: maxTAdjust(observedAt, rows, { alpha: alpha.value }),
      holmed: holm(marginal, { alpha: alpha.value }),
      crossedPointwise,
      crossedGlobal: envelope.outside,
    }
  })
}

const chart = computed(() => {
  const r = result.value
  if (!r) return undefined
  return {
    series: [
      { name: 'observed cumulative deviation', y: r.observed },
      {
        name: 'pointwise χ² envelope (upper)',
        y: r.pointwise,
        color: 4,
        dashed: true,
      },
    ],
    bands: [
      {
        lo: r.envelope.lower,
        hi: r.envelope.upper,
        label: `${fmtNum(100 * (1 - alpha.value), { digits: 0 })} % global rank envelope`,
      },
    ],
  }
})

const snippet = computed(
  () => `import { globalRankEnvelope, maxTAdjust, permutationP } from '@mindpeeker/psi'

const envelope = globalRankEnvelope(observedCurve, simulatedCurves, { alpha: ${alpha.value} })
console.log(envelope.pInterval, envelope.pErl, envelope.outside)  // outside ⟺ p₊ ≤ α

// many statistics at once, using their dependence
const adjusted = maxTAdjust(observedAt, surrogateRows, { alpha: ${alpha.value} })
console.log(adjusted.method, adjusted.adjusted, adjusted.rejected)`,
)
</script>

<template>
  <DemoSection
    id="multiplicity-envelope"
    title="2 · Global rank envelope and maxT"
    description="A pointwise envelope is a valid test at one step fixed in advance. Simulate the whole curve instead: the observed curve leaves the global envelope exactly when p₊ ≤ α."
    :api="['globalRankEnvelope', 'maxTAdjust', 'permutationP', 'significanceEnvelope']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Simulate ${simulations} curves`"
        busy-label="Simulating…"
        :hint="`${fmtBytes(budget)} of simulation bytes — one N(0,1) per byte via probitBytes`"
        @run="go"
        @cancel="task.cancel()"
      />
      <UFormField label="Steps" help="points per curve">
        <UInputNumber v-model="steps" :min="20" :max="500" :step="20" class="w-32" />
      </UFormField>
      <UFormField label="Simulations s" help="≥ 2499 for a stable envelope at α = 0.05">
        <UInputNumber v-model="simulations" :min="19" :max="2499" :step="20" class="w-32" />
      </UFormField>
      <UFormField label="α">
        <UInputNumber v-model="alpha" :min="0.001" :max="0.5" :step="0.01" class="w-28" />
      </UFormField>
      <UFormField label="Injected drift δ (z per step)" help="synthetic, over the middle third">
        <UInputNumber v-model="drift" :min="0" :max="2" :step="0.1" class="w-32" />
      </UFormField>
      <UFormField label="Simulation bytes" class="min-w-56">
        <USelect v-model="simSource" :items="SIM_SOURCES" class="w-full" />
      </UFormField>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div v-if="result" class="flex flex-col gap-5">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="p-interval [p₋, p₊]"
          :value="`${fmtP(result.envelope.pInterval[0])} … ${fmtP(result.envelope.pInterval[1])}`"
          size="sm"
          :tone="result.envelope.outside ? 'warning' : 'neutral'"
          note="ties make it an interval, not a point"
        />
        <StatTile
          label="pErl (tie-broken)"
          :value="fmtP(result.envelope.pErl)"
          size="sm"
          note="extreme-rank-length p"
        />
        <StatTile
          label="curve leaves the envelope"
          :value="result.crossedGlobal ? 'yes' : 'no'"
          size="sm"
          :tone="result.crossedGlobal ? 'warning' : 'success'"
          :note="`rank ${result.envelope.rank} of ${result.envelope.simulations + 1} · kα ${result.envelope.kAlpha}`"
        />
        <StatTile
          label="steps above the pointwise band"
          :value="`${result.crossedPointwise} / ${steps}`"
          size="sm"
          :tone="result.crossedPointwise ? 'error' : 'neutral'"
          note="a null path crosses it somewhere far more often than α"
        />
      </div>

      <LineChart
        v-if="chart"
        :series="chart.series"
        :bands="chart.bands"
        :hlines="[{ value: 0, label: 'chance', dashed: false }]"
        x-label="step"
        y-label="cumsum(Z² − 1)"
        :height="300"
        :format="(v) => fmtNum(v, { digits: 2 })"
        aria-label="observed cumulative deviation inside the global rank envelope and against the pointwise envelope"
      />

      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse">
          <caption class="text-left text-xs text-muted pb-2">
            Five checkpoints declared by position. maxT uses the dependence between them (they are
            points on one cumulative curve, so they are strongly dependent); Holm assumes nothing
            and pays for it.
          </caption>
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" class="py-1.5 pr-3">step</th>
              <th scope="col" class="py-1.5 pr-3">D(t)</th>
              <th scope="col" class="py-1.5 pr-3">marginal p</th>
              <th scope="col" class="py-1.5 pr-3">maxT adjusted</th>
              <th scope="col" class="py-1.5 pr-3">Holm adjusted</th>
            </tr>
          </thead>
          <tbody class="font-mono tabular-nums">
            <tr v-for="(t, i) in result.checkpoints" :key="t" class="border-t border-default">
              <td class="py-1.5 pr-3">{{ t + 1 }}</td>
              <td class="py-1.5 pr-3">{{ fmtNum(result.observedAt[i], { digits: 2 }) }}</td>
              <td class="py-1.5 pr-3">{{ fmtP(result.marginal[i]) }}</td>
              <td
                class="py-1.5 pr-3"
                :class="result.maxT.rejected[i] ? 'text-warning' : 'text-muted'"
              >
                {{ fmtP(result.maxT.adjusted[i]) }}
              </td>
              <td
                class="py-1.5 pr-3"
                :class="result.holmed.rejected[i] ? 'text-warning' : 'text-muted'"
              >
                {{ fmtP(result.holmed.adjusted[i]) }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="text-xs text-muted mt-1">
          maxT method: <code class="font-mono">{{ result.maxT.method }}</code> · level
          {{ result.maxT.level }}
        </p>
      </div>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>
    <p v-else-if="!task.busy.value" class="text-sm text-muted">
      With δ = 0 every curve is a null path, and the observed one should stay inside the global
      envelope about {{ fmtNum(100 * (1 - alpha), { digits: 0 }) }} % of the time — while still
      poking above the pointwise band somewhere surprisingly often.
    </p>

    <HonestNote variant="caveat">
      The published GCP curves are pointwise. Over 3000 steps roughly 45 % of pure-noise paths cross
      a pointwise 5 % envelope somewhere, so "the curve went outside the band" is not a 5 % event
      unless the step was fixed in advance. The global envelope is the whole-curve test; the
      simulations here are N(0,1) paths, which is the right null for a calibrated network and the
      wrong one for a drifting device.
    </HonestNote>
  </DemoSection>
</template>
