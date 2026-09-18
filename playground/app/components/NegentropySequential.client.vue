<script setup lang="ts">
/**
 * §3 — cumulative deviation, the pointwise χ² envelope, the anytime-valid
 * boundary, and the simulation that shows why the difference matters
 * (cookbook recipe 1).
 */
import {
  anytimeEnvelope,
  anytimeP,
  cumulativeDeviation,
  driftBoundary,
  driftMartingale,
  netvarBoundary,
  netvarMartingale,
  probitBytes,
  significanceEnvelope,
  villeCrossing,
} from '@mindpeeker/negentropy'
import { drbgSource, getBytes, localBytes } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { simulateStopping, type StoppingResult } from '~/lib/negentropy/stopping'

const STEPS = [300, 600, 1000, 3000].map((n) => ({ label: `${n} steps`, value: n }))
const ALPHAS = [
  { label: 'α = 0.05 (1/α = 20)', value: 0.05 },
  { label: 'α = 0.01 (1/α = 100)', value: 0.01 },
]
const LAMBDAS = [10, 100, 1000].map((n) => ({ label: `λ = ${n}`, value: n }))
const PATHS = [50, 150, 300].map((n) => ({ label: `${n} paths`, value: n }))
const NULL_SOURCES = [
  { label: 'reproducible DRBG control', value: 'drbg' },
  { label: 'browser CSPRNG (fastest)', value: 'crypto' },
]

const steps = ref(600)
const alpha = ref(0.05)
const excess = ref(0)
const lambda = ref(100)
const paths = ref(150)
const nullSource = ref('drbg')

interface Walk {
  steps: number
  alpha: number
  excess: number
  cumdev: Float64Array
  pointwise: Float64Array
  anytime: Float64Array
  logM: Float64Array
  anytimeP: Float64Array
  ville: number
  pointwiseCross: number
  drift: Float64Array
  driftWalk: Float64Array
  driftBand: Float64Array
  driftCross: number
  lambda: number
  reference: { t: number; pointwise: number; anytimeUpper: number; twoSided: number }[]
}

const walk = useTask<Walk>()
const path = computed(() => walk.result.value)
const simulation = useTask<StoppingResult>()
const sim = computed(() => simulation.result.value)

function runWalk(): void {
  void walk.run(async (signal, setProgress) => {
    const n = steps.value
    const a = alpha.value
    const scale = Math.sqrt(1 + excess.value)
    setProgress(0.1)
    const bytes = await getBytes(n, { signal })
    // probitBytes is EXACTLY N(0, 1) per byte under H0 — the honest null for a
    // sequential demo (a 200-bit trial's Z is only the lattice approximation).
    const zs = probitBytes(bytes, { source: 'sequential/walk' })
    if (scale !== 1) for (let i = 0; i < zs.length; i++) zs[i] = (zs[i] as number) * scale

    setProgress(0.4)
    const cumdev = cumulativeDeviation(zs)
    const pointwise = significanceEnvelope(n, a)
    const anytime = anytimeEnvelope(n, a, { sided: 'upper' }).upper
    const logM = netvarMartingale(zs, { sided: 'upper' })
    const running = anytimeP(logM)
    const ville = villeCrossing(logM, a)
    let pointwiseCross = -1
    for (let t = 0; t < n; t++) {
      if ((cumdev[t] as number) > (pointwise[t] as number)) {
        pointwiseCross = t
        break
      }
    }

    setProgress(0.7)
    const lam = lambda.value
    const drift = driftMartingale(zs, { lambda: lam })
    const driftWalk = new Float64Array(n)
    const driftBand = new Float64Array(n)
    let sum = 0
    let driftCross = -1
    for (let t = 0; t < n; t++) {
      sum += zs[t] as number
      driftWalk[t] = sum
      driftBand[t] = driftBoundary(t + 1, a, lam)
      if (driftCross < 0 && Math.abs(sum) >= (driftBand[t] as number)) driftCross = t
    }

    const reference = [10, 100, 1000]
      .filter((t) => t <= n)
      .map((t) => ({
        t,
        pointwise: (significanceEnvelope(t, a)[t - 1] as number),
        anytimeUpper: netvarBoundary(t, a, { sided: 'upper' }).upper,
        twoSided: netvarBoundary(t, a).upper,
      }))

    setProgress(1)
    return {
      steps: n,
      alpha: a,
      excess: excess.value,
      cumdev,
      pointwise,
      anytime,
      logM,
      anytimeP: running,
      ville,
      pointwiseCross,
      drift,
      driftWalk,
      driftBand,
      driftCross,
      lambda: lam,
      reference,
    }
  })
}

function runSimulation(): void {
  void simulation.run(async (signal, setProgress) => {
    const control = nullSource.value === 'drbg' ? drbgSource(`${currentSeedLabel()} / null-paths`) : undefined
    const draw = control
      ? async (n: number, opts: { signal: AbortSignal }) => (await control.getBytes(n, opts)).bytes
      : (n: number, opts: { signal: AbortSignal }) => localBytes(n, opts)
    return await simulateStopping({
      paths: paths.value,
      steps: steps.value,
      alpha: alpha.value,
      draw,
      label: `stopping/${nullSource.value}`,
      signal,
      setProgress,
    })
  })
}

const negDriftBand = computed(() =>
  path.value ? Float64Array.from(path.value.driftBand, (v) => -v) : new Float64Array(0),
)
const lnThreshold = computed(() => Math.log(1 / alpha.value))
const finalRatio = computed(() => {
  const p = path.value
  if (!p) return Number.NaN
  const last = p.steps - 1
  return (p.anytime[last] as number) / (p.pointwise[last] as number)
})
const simFractions = computed(() => {
  const s = sim.value
  if (!s) return [0, 0]
  return [s.pointwiseCrossings / s.paths, s.anytimeCrossings / s.paths]
})
const pointwiseRate = computed(() => 100 * (simFractions.value[0] ?? 0))
const anytimeRate = computed(() => 100 * (simFractions.value[1] ?? 0))
const medianFirstCrossing = computed(() => {
  const values = sim.value?.firstPointwise
  if (!values || values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? null
})
const simStandardError = computed(() => 100 * Math.sqrt((0.45 * 0.55) / paths.value))
const simBytes = computed(() => paths.value * steps.value)

const walkSnippet = computed(
  () => `import {
  anytimeEnvelope, anytimeP, cumulativeDeviation, netvarMartingale,
  probitBytes, significanceEnvelope, villeCrossing,
} from '@mindpeeker/negentropy'

const zs = probitBytes(bytes, { source: 'egg-1' })     // exactly N(0,1) under H0
const curve = cumulativeDeviation(zs)                   // D_t = Σ(Z² − 1)
const pointwise = significanceEnvelope(${steps.value}, ${alpha.value})   // χ²isf(p, t) − t — ONE fixed look
const anytime = anytimeEnvelope(${steps.value}, ${alpha.value}, { sided: 'upper' }).upper

const logM = netvarMartingale(zs, { sided: 'upper' })   // Gamma(1,1) mixture over 1/Var Z
const p = anytimeP(logM)                                // running anytime-valid p
const stopAt = villeCrossing(logM, ${alpha.value})                   // first t with M_t ≥ 1/α, or −1
// D_t ≥ anytime[t−1]  ⟺  M_t ≥ 1/α — the same event, two views`,
)

const simSnippet = computed(
  () => `// why the pointwise envelope may not be watched: simulate H0 paths
let pointwise = 0, anytime = 0
for (let p = 0; p < ${paths.value}; p++) {
  const zs = probitBytes(await control.getBytes(${steps.value}).then((r) => r.bytes), { source: \`path-\${p}\` })
  const curve = cumulativeDeviation(zs)
  if (curve.some((d, t) => d > band[t])) pointwise++
  if (curve.some((d, t) => d >= anytimeBand[t])) anytime++
}
// expect ≈ 46% of 3000-step paths over the pointwise envelope, ≤ ${alpha.value * 100}% over the boundary`,
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      id="cumdev"
      title="Cumulative deviation, two bands"
      description="D(t) = Σ(Z² − 1) is the classic GCP plot. The χ² envelope is a valid criterion at ONE step fixed in advance; the time-uniform boundary may be watched after every step. The variance-excess slider scales every z by √(1 + ε), which is what a real variance excess would do."
      :api="['cumulativeDeviation', 'significanceEnvelope', 'anytimeEnvelope', 'netvarMartingale', 'anytimeP', 'villeCrossing', 'netvarBoundary']"
    >
      <template #controls>
        <UFormField label="Steps" size="sm" class="w-36">
          <USelect v-model="steps" :items="STEPS" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Level" size="sm" class="w-48">
          <USelect v-model="alpha" :items="ALPHAS" size="sm" class="w-full" />
        </UFormField>
        <UFormField :label="`Variance excess ε = ${excess.toFixed(2)}`" size="sm" class="w-52">
          <USlider v-model="excess" :min="0" :max="0.3" :step="0.01" aria-label="Variance excess" />
        </UFormField>
        <UFormField label="Drift prior" size="sm" class="w-36">
          <USelect v-model="lambda" :items="LAMBDAS" size="sm" class="w-full" />
        </UFormField>
        <RunControls
          :busy="walk.busy.value"
          :progress="walk.progress.value"
          label="Draw a path"
          icon="i-lucide-activity"
          :hint="`${fmtBytes(steps)} from the selected source — one byte per step`"
          @run="runWalk"
          @cancel="walk.cancel()"
        />
      </template>

      <ErrorAlert :err="walk.error.value" @dismiss="walk.reset()" />

      <div v-if="path" class="flex flex-col gap-4">
        <LineChart
          :series="[
            { name: 'D(t) = Σ(Z² − 1)', y: path.cumdev },
            { name: `pointwise χ² envelope (α = ${path.alpha})`, y: path.pointwise, color: 2, dashed: true },
            { name: `anytime-valid boundary (α = ${path.alpha})`, y: path.anytime, color: 3, dashed: true },
          ]"
          :hlines="[{ value: 0, label: 'chance', dashed: false }]"
          x-label="step"
          y-label="cumulative deviation"
          :height="280"
          aria-label="Cumulative deviation with the pointwise envelope and the anytime-valid boundary"
        />

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Final D(t)"
            :value="path.cumdev[path.steps - 1]"
            :digits="2"
            :note="`E[D] = 0, Var[D] = 2t = ${fmtNum(2 * path.steps, { digits: 0 })}`"
          />
          <StatTile
            label="Final e-value M_t"
            :value="Math.exp(path.logM[path.steps - 1] ?? Number.NaN)"
            :digits="3"
            :tone="Math.exp(path.logM[path.steps - 1] ?? 0) >= 1 / path.alpha ? 'warning' : 'neutral'"
            :note="`ln M = ${fmtNum(path.logM[path.steps - 1], { digits: 3 })} · threshold ln(1/α) = ${fmtNum(lnThreshold, { digits: 3 })}`"
          />
          <StatTile label="Anytime-valid p">
            <template #value>
              <PValue
                :p="path.anytimeP[path.steps - 1]"
                kind="anytime"
                :alpha="path.alpha"
                label="p"
                :show-kind="false"
              />
            </template>
            <template #note>
              p_t = 1/max_{s≤t} M_s — valid however often you look
            </template>
          </StatTile>
          <StatTile
            label="Crossings"
            :value="path.pointwiseCross >= 0 ? `step ${path.pointwiseCross + 1}` : 'none'"
            :tone="path.pointwiseCross >= 0 ? 'warning' : 'success'"
            :note="`pointwise envelope · anytime boundary: ${path.ville >= 0 ? `step ${path.ville + 1}` : 'none'}`"
          />
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold text-highlighted mb-2">
              The martingale path (log scale, base e)
            </h3>
            <LineChart
              :series="[{ name: 'ln M_t (variance channel)', y: path.logM }]"
              :hlines="[
                { value: lnThreshold, label: `ln(1/α) = ${fmtNum(lnThreshold, { digits: 2 })}` },
                { value: 0, label: 'M = 1 (no evidence)', dashed: false },
              ]"
              x-label="step"
              y-label="ln M_t"
              :height="240"
              aria-label="Log e-value path of the variance-excess test martingale"
            />
            <p class="mt-2 text-xs text-muted">
              Everything is computed in log space: no overflow on long streams, no cancellation at
              t ≈ 10⁶. Crossing ln(1/α) is exactly the moment D(t) touches the boundary above.
            </p>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-highlighted mb-2">
              The mean-shift channel (Robbins–Siegmund)
            </h3>
            <LineChart
              :series="[
                { name: 'S_t = Σz', y: path.driftWalk },
                { name: `+boundary (λ = ${path.lambda})`, y: path.driftBand, color: 2, dashed: true },
                { name: '−boundary', y: negDriftBand, color: 2, dashed: true },
              ]"
              :hlines="[{ value: 0, label: 'chance', dashed: false }]"
              x-label="step"
              y-label="Σz"
              :height="240"
              aria-label="Stouffer walk against its time-uniform drift boundary"
            />
            <p class="mt-2 text-xs text-muted">
              Final drift e-value M_t = {{ fmtNum(Math.exp(path.drift[path.steps - 1] ?? Number.NaN), { digits: 3 }) }}.
              |S_t| ≥ √((t + λ)·ln((t + λ)/(λα²))) ⇔ driftMartingale ≥ 1/α. Crossing:
              {{ path.driftCross >= 0 ? `step ${path.driftCross + 1}` : 'none' }}. The boundary is
              tightest relative to √t near t ≈ 8.2·λ — λ is part of the pre-registration, not a knob
              to tune afterwards.
            </p>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-muted text-xs uppercase">
              <tr>
                <th class="text-left py-1.5 pr-3 font-medium">t</th>
                <th class="text-right py-1.5 px-3 font-medium">pointwise χ² envelope</th>
                <th class="text-right py-1.5 px-3 font-medium">anytime boundary (upper)</th>
                <th class="text-right py-1.5 px-3 font-medium">anytime boundary (two-sided)</th>
                <th class="text-right py-1.5 pl-3 font-medium">price</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in path.reference"
                :key="row.t"
                class="border-t border-default font-mono tabular-nums text-xs"
              >
                <td class="py-1.5 pr-3">{{ row.t }}</td>
                <td class="py-1.5 px-3 text-right">{{ fmtNum(row.pointwise, { digits: 3 }) }}</td>
                <td class="py-1.5 px-3 text-right">{{ fmtNum(row.anytimeUpper, { digits: 3 }) }}</td>
                <td class="py-1.5 px-3 text-right">{{ fmtNum(row.twoSided, { digits: 3 }) }}</td>
                <td class="py-1.5 pl-3 text-right">
                  ×{{ fmtNum(row.anytimeUpper / row.pointwise, { digits: 2 }) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-muted">
          Reference values at α = 0.05, a = b = 1, two-sided: 19.498 (t = 10), 52.308 (t = 100),
          165.798 (t = 1000), against a pointwise envelope of 74.68 at t = 1000. At this run's
          horizon the price is ×{{ fmtNum(finalRatio, { digits: 2 }) }}.
        </p>

        <CodeSnippet :code="walkSnippet" title="what “Draw a path” ran" />
      </div>

      <template #footer>
        <HonestNote variant="exact">
          For Gaussian Z every variant here is a martingale with E[M_t] = 1, checked by numerical
          integration; for independent fair-bit trials the upper-sided netvar and both drift
          variants stay test <em>super</em>martingales. What voids them is not a bad p-value but a
          broken model: empirical calibration, drifting hardware, serial correlation or misaligned
          steps.
        </HonestNote>
      </template>
    </DemoSection>

    <DemoSection
      id="optional-stopping"
      title="Optional stopping, simulated"
      description="Independent null paths, each watched at every step. How often does a path with nothing in it cross the pointwise envelope somewhere? And how often does it cross the time-uniform boundary, whose guarantee holds however long you look?"
      :api="['probitBytes', 'cumulativeDeviation', 'significanceEnvelope', 'anytimeEnvelope']"
    >
      <template #controls>
        <UFormField label="Null paths" size="sm" class="w-36">
          <USelect v-model="paths" :items="PATHS" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Null source" size="sm" class="w-56">
          <USelect v-model="nullSource" :items="NULL_SOURCES" size="sm" class="w-full" />
        </UFormField>
        <RunControls
          :busy="simulation.busy.value"
          :progress="simulation.progress.value"
          label="Simulate"
          icon="i-lucide-shuffle"
          :hint="`${paths} × ${steps} steps = ${fmtBytes(simBytes)} from a control arm, chunked per path`"
          @run="runSimulation"
          @cancel="simulation.cancel()"
        />
      </template>

      <ErrorAlert :err="simulation.error.value" @dismiss="simulation.reset()" />

      <div v-if="sim" class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Crossed the pointwise envelope"
            :value="`${sim.pointwiseCrossings}/${sim.paths}`"
            tone="warning"
            :note="`${fmtNum(pointwiseRate, { digits: 1 })}% — the nominal level was ${sim.alpha * 100}%`"
          />
          <StatTile
            label="Crossed the anytime boundary"
            :value="`${sim.anytimeCrossings}/${sim.paths}`"
            tone="success"
            :note="`${fmtNum(anytimeRate, { digits: 1 })}% — Ville's inequality caps it at ${sim.alpha * 100}%`"
          />
          <StatTile
            label="Median first crossing"
            :value="medianFirstCrossing"
            :digits="0"
            note="step at which a null path first looked significant"
          />
          <StatTile
            label="Horizon"
            :value="`${sim.steps} steps`"
            :note="`bands at t = ${sim.steps}: ${fmtNum(sim.pointwiseBand[sim.steps - 1], { digits: 1 })} vs ${fmtNum(sim.anytimeBand[sim.steps - 1], { digits: 1 })}`"
          />
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold text-highlighted mb-2">Crossing rate vs the level</h3>
            <BarChart
              :categories="['pointwise χ² envelope', 'anytime-valid boundary']"
              :values="simFractions"
              :expected="sim.alpha"
              :expected-label="`α = ${sim.alpha}`"
              y-label="fraction of null paths"
              :height="220"
              aria-label="Fraction of null paths crossing each band, against the nominal level"
            />
          </div>
          <div>
            <h3 class="text-sm font-semibold text-highlighted mb-2">
              When a null path first “looked significant”
            </h3>
            <Histogram
              v-if="sim.firstPointwise.length > 1"
              :values="sim.firstPointwise"
              :bins="30"
              x-label="first pointwise crossing (step)"
              y-label="paths"
              :height="220"
              aria-label="Histogram of the step at which each crossing null path first crossed the pointwise envelope"
            />
            <p v-else class="text-sm text-muted">
              No path crossed — rerun with more paths or a longer horizon.
            </p>
          </div>
        </div>

        <CodeSnippet :code="simSnippet" title="the simulation" />
      </div>

      <template #footer>
        <HonestNote variant="caveat">
          The package's own seeded tests run 1000 H0 paths of 3000 steps: the pointwise χ² envelope
          is crossed by 46% of them and every time-uniform boundary by 0.9–3.2%. Fewer paths and a
          shorter horizon here give a noisier, smaller number — with {{ paths }} paths the standard
          error on a 45% rate is about
          {{ fmtNum(simStandardError, { digits: 1 }) }} points. The lesson
          survives the noise: a fixed-n criterion watched continuously is not a 5% test.
        </HonestNote>
      </template>
    </DemoSection>
  </div>
</template>
