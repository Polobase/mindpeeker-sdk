<script setup lang="ts">
/**
 * §2 — the GCP network statistics over a simulated network: N sources × T
 * lock-step trials from the selected provider, with an optional common-mode
 * coupling that mixes one shared bit stream into every source.
 */
import { createYielder } from '~/lib/async'
import { getBytes, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { type GcpStats, primaryStats, secondaryStats } from '~/lib/negentropy/gcp'
import { buildNetwork, networkBytes, type NetworkSpec } from '~/lib/negentropy/network'

const STEPS = [100, 200, 400, 800].map((n) => ({ label: `${n} steps`, value: n }))
const WIDTHS = [
  { label: '200 bits (GCP convention)', value: 200 },
  { label: '64 bits', value: 64 },
  { label: '32 bits', value: 32 },
]
const BLOCK_TS = [1, 2, 5, 10, 20]

const sources = ref(3)
const steps = ref(200)
const bitsPerTrial = ref(200)
const coupling = ref(0)

const spec = computed<NetworkSpec>(() => ({
  sources: sources.value,
  steps: steps.value,
  bitsPerTrial: bitsPerTrial.value,
  coupling: coupling.value,
  seed: 0x2f6e2b1,
}))
const costBytes = computed(() => networkBytes(spec.value))

interface Report extends GcpStats {
  spec: NetworkSpec
  names: readonly string[]
  stouffer: Float64Array
}

const task = useTask<Report>()
const report = computed(() => task.result.value)

function run(): void {
  void task.run(async (signal, setProgress) => {
    const current = spec.value
    const tick = createYielder(8, signal)
    setProgress(0.05)
    const bytes = await getBytes(networkBytes(current), { signal })
    const net = buildNetwork(bytes, current)
    const { names, stouffer } = net
    await tick()

    setProgress(0.35)
    const primary = primaryStats(net)
    await tick()

    setProgress(0.7)
    const secondary = secondaryStats(net, BLOCK_TS, primary.netvar)
    setProgress(1)

    return { spec: current, names, stouffer, ...primary, ...secondary }
  })
}

const lagIndex = computed(() =>
  report.value ? Float64Array.from(report.value.autocorr.z, (_, i) => i + 1) : new Float64Array(0),
)
const negEnvelope = computed(() =>
  report.value ? Float64Array.from(report.value.autocorr.envelope, (v) => -v) : new Float64Array(0),
)

const snippet = computed(
  () => `import {
  covar, devvar, interSourceCorrelation, netvar, networkCoherence,
  theoreticalCalibration, trialsFromBytes, zScores,
} from '@mindpeeker/negentropy'

const names = ${JSON.stringify(Array.from({ length: sources.value }, (_, i) => `egg-${i + 1}`))}
const zBySource = names.map((name, i) => {
  const series = trialsFromBytes(recordings[i], name, { bitsPerTrial: ${bitsPerTrial.value} })
  return zScores(series, theoreticalCalibration(name, ${bitsPerTrial.value}))
})

netvar(zBySource, names)                  // Σ Stouffer Z² ~ χ²(${steps.value})
devvar(zBySource, names)                  // Σ z² ~ χ²(${steps.value * sources.value})
covar(zBySource, names, { bitsPerTrial: ${bitsPerTrial.value} })  // C2, v = 2 − 2/k
networkCoherence(zBySource, names)        // mean pairwise product + perStep curve
interSourceCorrelation(zBySource, names)  // Σ pairwise products, N(0,1) by the CLT`,
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      id="network"
      title="A network of sources, one trial each per step"
      description="Every source contributes one trial per step — the number of one-bits among its bits, Binomial(k, ½) under the null — z-scored against that exact null. The coupling slider replaces that fraction of every source's bits — the same bit positions in every source — with one shared stream, which is what a common-mode disturbance does: it hits every device at the same instants."
      :api="['trialsFromBytes', 'theoreticalCalibration', 'zScores', 'stoufferZ', 'netvar', 'devvar']"
    >
      <template #controls>
        <UFormField label="Sources" size="sm" class="w-28">
          <UInputNumber v-model="sources" :min="2" :max="8" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Steps" size="sm" class="w-36">
          <USelect v-model="steps" :items="STEPS" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Bits per trial" size="sm" class="w-52">
          <USelect v-model="bitsPerTrial" :items="WIDTHS" size="sm" class="w-full" />
        </UFormField>
        <UFormField
          :label="`Common-mode coupling ρ = ${coupling.toFixed(2)}`"
          size="sm"
          class="w-52"
        >
          <USlider
            v-model="coupling"
            :min="0"
            :max="0.3"
            :step="0.01"
            aria-label="Common-mode coupling"
          />
        </UFormField>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          :disabled="!(sources >= 2 && sources <= 8)"
          label="Run the network"
          icon="i-lucide-network"
          :hint="`${fmtBytes(costBytes)} from the selected source (${sources} sources + one shared common-mode stream)`"
          @run="run"
          @cancel="task.cancel()"
        />
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
      <p v-if="!report && !task.busy.value" class="text-sm text-muted">
        Press “Run the network”. At ρ = 0 every statistic below should look like chance; push ρ up
        and netvar, coherence and the pairwise correlations go first.
      </p>

      <div v-if="report" class="flex flex-col gap-4">
        <AccountingBadge
          :bytes-consumed="networkBytes(report.spec)"
          :source="sourceSummary().providerName"
        />

        <LineChart
          :series="[{ name: 'per-step Stouffer Z', y: report.stouffer }]"
          :hlines="[
            { value: 0, label: 'null mean', dashed: false },
            { value: 1.96, label: '+1.96' },
            { value: -1.96, label: '−1.96' },
          ]"
          x-label="step"
          y-label="Z"
          :height="240"
          aria-label="Per-step Stouffer Z across the network"
        />

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label="netvar (GCP standard)"
            :value="report.netvar.statistic"
            :digits="2"
          >
            <template #note>
              <div class="flex flex-col gap-1">
                <PValue :p="report.netvar.pValue" kind="exact" />
                <span>Σ Stouffer Z² ~ χ²({{ report.netvar.df }})</span>
              </div>
            </template>
          </StatTile>
          <StatTile label="devvar" :value="report.devvar.statistic" :digits="2">
            <template #note>
              <div class="flex flex-col gap-1">
                <PValue :p="report.devvar.pValue" kind="exact" />
                <span>Σ z² ~ χ²({{ report.devvar.df }}) — any source off on its own</span>
              </div>
            </template>
          </StatTile>
          <StatTile label="covar (C2)" :value="report.covar.statistic" :digits="3">
            <template #note>
              <div class="flex flex-col gap-1">
                <PValue :p="report.covar.pValue" kind="pointwise" />
                <span>
                  variances co-moving · v = Var z² = {{ fmtNum(report.covar.zSquaredVariance, { digits: 4 }) }}
                  (exactly 2 − 2/{{ report.spec.bitsPerTrial }})
                </span>
              </div>
            </template>
          </StatTile>
          <StatTile
            label="networkCoherence"
            :value="report.coherence.statistic"
            :digits="3"
          >
            <template #note>
              <div class="flex flex-col gap-1">
                <PValue :p="report.coherence.pValue" kind="pointwise" />
                <span>mean pair product {{ fmtNum(report.coherence.coherence, { digits: 4 }) }}</span>
              </div>
            </template>
          </StatTile>
          <StatTile
            label="interSourceCorrelation"
            :value="report.inter.statistic"
            :digits="3"
          >
            <template #note>
              <div class="flex flex-col gap-1">
                <PValue :p="report.inter.pValue" kind="pointwise" />
                <span>Σ pairwise zᵢzⱼ over {{ report.inter.df }} products</span>
              </div>
            </template>
          </StatTile>
          <StatTile
            label="clusteredNetvar (between)"
            :value="report.clustered.between"
            :digits="2"
          >
            <template #note>
              <div class="flex flex-col gap-1">
                <PValue :p="report.clustered.pValue" kind="exact" />
                <span>
                  within {{ fmtNum(report.clustered.within, { digits: 1 }) }} over
                  {{ report.clustered.clusterCount }} clusters (sources alternate)
                </span>
              </div>
            </template>
          </StatTile>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold text-highlighted mb-2">
              Pairwise: mean product vs Pearson r
            </h3>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="text-muted text-xs uppercase">
                  <tr>
                    <th class="text-left py-1.5 pr-3 font-medium">pair</th>
                    <th class="text-right py-1.5 px-3 font-medium">meanProduct (r)</th>
                    <th class="text-right py-1.5 pl-3 font-medium">pearson</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="pair in report.coherence.pairs"
                    :key="`${pair.a}-${pair.b}`"
                    class="border-t border-default"
                  >
                    <td class="py-1.5 pr-3 font-mono text-xs">{{ pair.a }} · {{ pair.b }}</td>
                    <td class="py-1.5 px-3 text-right font-mono tabular-nums">
                      {{ fmtNum(pair.meanProduct, { digits: 4 }) }}
                    </td>
                    <td class="py-1.5 pl-3 text-right font-mono tabular-nums">
                      {{ fmtNum(pair.pearson, { digits: 4 }) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="mt-2 text-xs text-muted">
              <code class="text-primary">meanProduct</code> is an uncentered co-moment: a common
              mean shift μ on uncorrelated sources reads ≈ μ². Only
              <code class="text-primary">pearson</code> is a correlation. Under H0 both scatter
              around 0 with sd ≈ 1/√{{ report.spec.steps }} =
              {{ fmtNum(1 / Math.sqrt(report.spec.steps), { digits: 3 }) }}.
            </p>
          </div>

          <div>
            <h3 class="text-sm font-semibold text-highlighted mb-2">
              Coherence per step (the “evoked response” curve)
            </h3>
            <LineChart
              :series="[
                { name: 'mean pair product', y: report.coherence.perStep },
                { name: 'covar per step (u = z² − 1)', y: report.covar.perStep, color: 2 },
              ]"
              :hlines="[{ value: 0, label: 'null mean', dashed: false }]"
              x-label="step"
              y-label="per-step statistic"
              :height="220"
              aria-label="Per-step network coherence and covar curves"
            />
            <div class="mt-2 grid grid-cols-2 gap-2">
              <StatTile
                size="sm"
                label="onsiteVsGlobal r"
                :value="report.onsite.r"
                :digits="4"
                :note="`egg-1 vs the Stouffer of the rest · Fisher z = ${fmtNum(report.onsite.statistic, { digits: 3 })}`"
              />
              <StatTile
                v-for="vr in report.varianceRatios"
                :key="vr.q"
                size="sm"
                :label="`varianceRatio q = ${vr.q}`"
                :value="vr.result.ratio"
                :digits="4"
                :note="`z = ${fmtNum(vr.result.statistic, { digits: 2 })} · robust z* = ${fmtNum(vr.result.robust.statistic, { digits: 2 })}`"
              />
            </div>
          </div>
        </div>

        <CodeSnippet :code="snippet" title="what “Run the network” ran" />
      </div>

      <template #footer>
        <HonestNote variant="contested">
          These are published GCP analysis <em>forms</em> computed over bytes you just drew. They do
          not use the GCP database and they presuppose nothing about its hypothesis. GCP 2.0 calls
          netvar “Network Coherence (Phase)” and the standardized device variance “Network Coherence
          (Amplitude)”; this package's <code>networkCoherence</code> is neither, but the pairwise
          product.
        </HonestNote>
      </template>
    </DemoSection>

    <DemoSection
      v-if="report"
      id="blocking"
      title="Blocking and autocorrelation"
      description="Bancel & Nelson's blocked statistics sum the network over T-step blocks. If the per-step Z's are independent, the event z falls as z₀/√T; anything left over lives in temporal structure."
      :api="['blockedNetvar', 'blockedDevvar', 'blockZ', 'blockingDecomposition', 'networkAutocorrelation']"
      :level="2"
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <UBadge
            :color="report.blockedMatchesNetvar ? 'success' : 'error'"
            variant="subtle"
            size="sm"
          >
            blockedNetvar(T = 1) {{ report.blockedMatchesNetvar ? '≡' : '≠' }} netvar
          </UBadge>
          <span class="text-xs text-muted">bit for bit, as the README promises</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-muted text-xs uppercase">
              <tr>
                <th class="text-left py-1.5 pr-3 font-medium">T</th>
                <th class="text-right py-1.5 px-3 font-medium">blocks</th>
                <th class="text-right py-1.5 px-3 font-medium">blockedNetvar χ²</th>
                <th class="text-right py-1.5 px-3 font-medium">p</th>
                <th class="text-right py-1.5 px-3 font-medium">blockedDevvar χ²</th>
                <th class="text-right py-1.5 px-3 font-medium">event z</th>
                <th class="text-right py-1.5 px-3 font-medium">expected z₀/√T</th>
                <th class="text-right py-1.5 px-3 font-medium">autocorr term</th>
                <th class="text-right py-1.5 pl-3 font-medium">residual sd</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(point, i) in report.decomposition.points"
                :key="point.T"
                class="border-t border-default font-mono tabular-nums text-xs"
              >
                <td class="py-1.5 pr-3">{{ point.T }}</td>
                <td class="py-1.5 px-3 text-right">{{ point.blocks }}</td>
                <td class="py-1.5 px-3 text-right">
                  {{ fmtNum(report.blocked[i]?.net.statistic, { digits: 2 }) }}
                </td>
                <td class="py-1.5 px-3 text-right">
                  {{ fmtNum(report.blocked[i]?.net.pValue, { digits: 3 }) }}
                </td>
                <td class="py-1.5 px-3 text-right">
                  {{ fmtNum(report.blocked[i]?.dev.statistic, { digits: 2 }) }}
                </td>
                <td class="py-1.5 px-3 text-right">{{ fmtNum(point.z, { digits: 3 }) }}</td>
                <td class="py-1.5 px-3 text-right">{{ fmtNum(point.expected, { digits: 3 }) }}</td>
                <td class="py-1.5 px-3 text-right">
                  {{ fmtNum(point.autocorrelationTerm, { digits: 3 }) }}
                </td>
                <td class="py-1.5 pl-3 text-right">{{ fmtNum(point.residualSd, { digits: 3 }) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-muted">
          z₀ = {{ fmtNum(report.decomposition.z0, { digits: 3 }) }} over
          {{ report.decomposition.steps }} steps. Compare <em>event z − expected</em> against the
          residual sd √(1 − 1/T); the decomposition linearizes probit z's, so
          <code class="text-primary">predicted</code> only tracks the observed z with many blocks.
        </p>

        <div>
          <h3 class="text-sm font-semibold text-highlighted mb-2">
            Autocorrelation of the netvar increments Z² − 1
          </h3>
          <LineChart
            :series="[
              { name: 'integrated I(L) = Σ z_ℓ', y: report.autocorr.integrated, x: lagIndex },
              { name: 'pointwise envelope', y: report.autocorr.envelope, x: lagIndex, color: 2, dashed: true },
              { name: '−envelope', y: negEnvelope, x: lagIndex, color: 2, dashed: true },
            ]"
            :hlines="[{ value: 0, label: 'no persistence', dashed: false }]"
            x-label="lag L"
            y-label="integrated autocorrelation"
            :height="240"
            aria-label="Integrated autocorrelation of the netvar increments with its pointwise envelope"
          />
          <p class="mt-2 text-xs text-muted">
            Bartlett band on ρ̂: ±{{ fmtNum(report.autocorr.band, { digits: 4 }) }}. Both the band and
            the envelope are <strong>pointwise</strong> — scanning every lag for the first exit is a
            multiple comparison, not a test.
          </p>
        </div>
      </div>

      <template #footer>
        Blocks tile from step 0 and a trailing remainder is dropped
        (<code class="text-primary">droppedSteps</code>). covar's normal tail is a CLT approximation
        over skewed products: expect T·P ≳ a few hundred before reading a small p.
      </template>
    </DemoSection>
  </div>
</template>
