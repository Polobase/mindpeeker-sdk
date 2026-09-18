<script setup lang="ts">
/**
 * §1 — the quality estimators, run over live bytes from the selected source
 * with a controlled amount of synthetic contamination mixed in, so you can
 * watch each test start to fail and see which one notices first.
 */
import {
  autocorrelation,
  type ContrastNegentropy,
  type MomentNegentropy,
  negentropyExp,
  negentropyKurtosis,
  negentropyLogcosh,
  negentropyVasicek,
  probitBytes,
  spectralEntropy,
  toBits,
  vasicekEntropy,
} from '@mindpeeker/negentropy'
import { createYielder } from '~/lib/async'
import { getBytes, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { type BatteryRow, buildBattery } from '~/lib/negentropy/battery'
import { describeMix, isClean, mixBits, type MixSpec, packBits } from '~/lib/negentropy/synth'

const SIZES = [
  { label: '2 KiB (16 384 bits)', value: 2048 },
  { label: '4 KiB (32 768 bits)', value: 4096 },
  { label: '16 KiB (131 072 bits)', value: 16384 },
  { label: '64 KiB (524 288 bits)', value: 65536 },
]
/** ApEn/SampEn are O(N²) in the record length — they run on a capped prefix. */
const ENTROPY_SAMPLES = 900
const MAX_LAG = 32
const HALF_LN_2PIE = 1.4189385332046727

const size = ref(4096)
const bias = ref(0)
const stickiness = ref(0)

interface Report {
  bytes: number
  mix: string
  rows: BatteryRow[]
  kurtosis: MomentNegentropy
  logcosh: ContrastNegentropy
  exponential: ContrastNegentropy
  vasicekH: number
  vasicekJ: number
  spectralEntropy: number
  probit: Float64Array
  acf: Float64Array
  acfLags: Float64Array
  acfBand: number
  histogram: Float64Array
  subsample: number
}

const task = useTask<Report>()
const report = computed(() => task.result.value)

const spec = computed<MixSpec>(() => ({
  bias: bias.value,
  stickiness: stickiness.value,
  seed: 0x5bf03635,
}))
const mixLabel = computed(() => describeMix(spec.value))

function run(): void {
  void task.run(async (signal, setProgress) => {
    const tick = createYielder(8, signal)
    setProgress(0.05)
    const raw = await getBytes(size.value, { signal })
    const current = spec.value
    const bits = mixBits(toBits(raw), current)
    const bytes = isClean(current) ? raw : packBits(bits)
    await tick()

    setProgress(0.25)
    const probit = probitBytes(bytes, { source: `quality/${sourceSummary().id}` })
    const subsample = Math.min(ENTROPY_SAMPLES, probit.length)
    await tick()

    setProgress(0.55)
    const rows = buildBattery(bytes, bits, probit, subsample)
    await tick()

    setProgress(0.85)
    const acf = autocorrelation(probit, MAX_LAG).slice(1)
    const acfLags = Float64Array.from({ length: MAX_LAG }, (_, i) => i + 1)
    const histogram = new Float64Array(256)
    for (const byte of bytes) histogram[byte] = (histogram[byte] as number) + 1
    await tick()

    setProgress(1)
    return {
      bytes: bytes.length,
      mix: describeMix(current),
      rows,
      kurtosis: negentropyKurtosis(probit),
      logcosh: negentropyLogcosh(probit),
      exponential: negentropyExp(probit),
      vasicekH: vasicekEntropy(probit),
      vasicekJ: negentropyVasicek(probit),
      spectralEntropy: spectralEntropy(probit, { normalize: true }),
      probit,
      acf,
      acfLags,
      acfBand: 1.96 / Math.sqrt(probit.length),
      histogram,
      subsample,
    }
  })
}

const normalPdf = (x: number): number => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)
const contrastTone = (z: number): 'neutral' | 'warning' =>
  Math.abs(z) > 3 ? 'warning' : 'neutral'
const contrastNote = (z: number): string =>
  z > 0 ? 'positive z ⇒ sub-Gaussian (flat, bimodal)' : 'negative z ⇒ super-Gaussian (peaked, heavy tails)'

const snippet = computed(
  () => `import {
  chiSquareBytes, markovMinEntropyPerBit, mcvMinEntropy, monobit,
  normalP, runsTest, serialCorrelation, shannonEntropy, spectralTest, toBits,
} from '@mindpeeker/negentropy'

const bytes = (await provider.getBytes(${size.value})).bytes
const bits = toBits(bytes)                       // MSB-first, the SDK-wide bit order

const chi = chiSquareBytes(bytes)                // { statistic, pValue } — exact 255-df tail
const mono = monobit(bits)                       // { onesFraction, z }
const runs = runsTest(bits)                      // Wald–Wolfowitz z
const dft = spectralTest(bits, { variance: 'kim2004' })
console.log(chi.pValue, normalP(mono.z, 'two'), normalP(runs, 'two'), dft.pValue)
console.log(shannonEntropy(bytes), mcvMinEntropy(bytes), markovMinEntropyPerBit(bits))
console.log(serialCorrelation(bytes))`,
)

const negentropySnippet = `import {
  negentropyExp, negentropyKurtosis, negentropyLogcosh,
  negentropyVasicek, probitBytes, vasicekEntropy,
} from '@mindpeeker/negentropy'

// bytes are lattice-valued: dither them into exactly N(0, 1) samples first
const x = probitBytes(bytes, { source: 'egg-1' })

negentropyKurtosis(x)   // { j, skew, exkurt } — E[J] ≈ 1/n under H0
negentropyLogcosh(x).z  // calibrated N(0, 1) detector; + ⇒ sub-Gaussian
negentropyExp(x).z      // most sensitive to peaked/heavy-tailed shapes
vasicekEntropy(x)       // nats; ½ln(2πe) = 1.4189 for a unit Gaussian
negentropyVasicek(x)    // J = ½ln(2πeσ̂²) − Ĥ ≥ 0 (estimator bias can dip it negative)`

// Auto-run only on a local source: a beacon would fire network requests before
// the visitor asked for anything.
const idleHint = ref('')
onMounted(() => {
  if (!sourceMeta().network) run()
  else idleHint.value = `press “Draw & test” to pull ${fmtBytes(size.value)} from ${sourceLabel()}`
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      id="quality"
      title="Quality battery on live bytes"
      description="Classic randomness checks over the raw bytes and their unpacked bits. They can only fail a source: whitened output passes by construction. The two sliders overwrite part of the real bit stream with a biased or sticky model, so you can watch which estimator notices first."
      :api="[
        'shannonEntropy',
        'mcvMinEntropy',
        'markovMinEntropyPerBit',
        'chiSquareBytes',
        'serialCorrelation',
        'monobit',
        'runsTest',
        'spectralTest',
        'approximateEntropy',
        'sampleEntropy',
      ]"
    >
      <template #controls>
        <UFormField label="Sample" size="sm" class="w-56">
          <USelect v-model="size" :items="SIZES" size="sm" class="w-full" />
        </UFormField>
        <UFormField
          :label="`One-bit excess b = ${bias.toFixed(3)} → P(1) = ${(0.5 + bias).toFixed(3)}`"
          size="sm"
          class="w-56"
        >
          <USlider v-model="bias" :min="0" :max="0.15" :step="0.005" aria-label="One-bit excess" />
        </UFormField>
        <UFormField
          :label="`Lag-1 stickiness = ${stickiness.toFixed(2)}`"
          size="sm"
          class="w-56"
        >
          <USlider
            v-model="stickiness"
            :min="0"
            :max="0.6"
            :step="0.02"
            aria-label="Lag-1 stickiness"
          />
        </UFormField>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          label="Draw & test"
          icon="i-lucide-ruler"
          :hint="`${fmtBytes(size)} from the selected source · ${mixLabel}`"
          @run="run"
          @cancel="task.cancel()"
        />
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
      <p v-if="!report && idleHint" class="text-sm text-muted">{{ idleHint }}</p>

      <div v-if="report" class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
          <AccountingBadge
            :bytes-consumed="report.bytes"
            :source="sourceSummary().providerName"
          />
          <UBadge size="sm" color="neutral" variant="subtle">{{ report.mix }}</UBadge>
        </div>

        <ul class="flex flex-col divide-y divide-default border-y border-default">
          <li
            v-for="row in report.rows"
            :key="row.name"
            class="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <div class="sm:w-64 shrink-0">
              <div class="text-sm font-medium text-highlighted">{{ row.name }}</div>
              <code class="text-[11px] text-primary font-mono break-all">{{ row.api }}</code>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span class="font-mono text-sm text-highlighted tabular-nums">{{ row.value }}</span>
                <PValue v-if="row.p !== undefined" :p="row.p" :kind="row.pKind ?? 'pointwise'" />
                <span class="text-xs text-dimmed">{{ row.reference }}</span>
              </div>
              <p class="mt-0.5 text-xs text-muted">{{ row.note }}</p>
            </div>
          </li>
        </ul>

        <div class="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold text-highlighted mb-2">Byte-value density</h3>
            <HeatmapCanvas
              :data="report.histogram"
              :rows="16"
              :cols="16"
              row-label="high nibble"
              col-label="low nibble"
              aria-label="Byte-value density, high nibble by low nibble"
              :height="220"
            />
            <p class="mt-1 text-xs text-muted">
              Expected {{ fmtNum(report.bytes / 256, { digits: 1 }) }} counts per cell under
              uniformity; the χ² row above turns this picture into a p-value.
            </p>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-highlighted mb-2">
              Autocorrelation of the probit samples
            </h3>
            <LineChart
              :series="[{ name: 'ρ̂(ℓ)', y: report.acf, x: report.acfLags }]"
              :hlines="[
                { value: 0, label: 'no correlation', dashed: false },
                { value: report.acfBand, label: '+1.96/√n' },
                { value: -report.acfBand, label: '−1.96/√n' },
              ]"
              x-label="lag ℓ"
              y-label="ρ̂"
              :height="220"
              aria-label="Sample autocorrelation of the probit samples by lag"
            />
            <p class="mt-1 text-xs text-muted">
              The ±1.96/√n band is <em>pointwise</em>: with {{ MAX_LAG }} lags plotted, one or two
              excursions are what chance looks like.
            </p>
          </div>
        </div>

        <CodeSnippet :code="snippet" title="what “Draw & test” ran" />
      </div>

      <template #footer>
        <HonestNote variant="caveat">
          A battery that passes says only that these particular structures were not found. Any
          CSPRNG — including a counter through AES — passes every test on this page. Statistical
          tests can fail a source; they can never certify one.
        </HonestNote>
      </template>
    </DemoSection>

    <DemoSection
      id="negentropy-estimators"
      title="Negentropy estimators J(x)"
      description="J(x) = H(Gaussian of equal variance) − H(x) ≥ 0, zero exactly when x is Gaussian — “how far from maximally random”. Bytes are lattice-valued, so they are mapped through probitBytes first, which is exactly N(0, 1) under the null."
      :api="[
        'probitBytes',
        'negentropyKurtosis',
        'negentropyLogcosh',
        'negentropyExp',
        'vasicekEntropy',
        'negentropyVasicek',
        'spectralEntropy',
      ]"
    >
      <div v-if="report" class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Moment J (kurtosis)"
            :value="report.kurtosis.j"
            :digits="5"
            :note="`skew ${fmtNum(report.kurtosis.skew, { digits: 3 })} · excess kurtosis ${fmtNum(report.kurtosis.exkurt, { digits: 3 })} · E[J] ≈ 1/n = ${fmtNum(1 / report.probit.length, { digits: 5 })}`"
          />
          <StatTile
            label="log-cosh contrast z"
            :value="report.logcosh.z"
            :tone="contrastTone(report.logcosh.z)"
            :note="contrastNote(report.logcosh.z)"
          />
          <StatTile
            label="exp contrast z"
            :value="report.exponential.z"
            :tone="contrastTone(report.exponential.z)"
            :note="contrastNote(report.exponential.z)"
          />
          <StatTile
            label="Vasicek J (nats)"
            :value="report.vasicekJ"
            :digits="4"
            :note="`Ĥ = ${fmtNum(report.vasicekH, { digits: 4 })} nats vs ½ln(2πe) = ${fmtNum(HALF_LN_2PIE, { digits: 4 })}`"
          />
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold text-highlighted mb-2">
              Probit samples against the exact null
            </h3>
            <Histogram
              :values="report.probit"
              :bins="48"
              density
              :reference="normalPdf"
              reference-label="N(0, 1) — the exact null"
              x-label="Φ⁻¹((byte + U)/256)"
              y-label="density"
              :height="240"
              aria-label="Histogram of probit-transformed bytes against the standard normal density"
            />
          </div>
          <div class="flex flex-col gap-3">
            <StatTile
              label="Normalized spectral entropy"
              :value="report.spectralEntropy"
              :digits="5"
              note="White noise lands near 0.93–0.95, not 1.0 — a noise spectrum is exponentially distributed, not flat. A tone pulls it down hard."
            />
            <HonestNote variant="contested" title="Reading the contrast z">
              The contrast z-scores are honestly calibrated against the delta-method null under
              empirical standardization (≈34× tighter than the naive Var[G] for log-cosh), so |z| &gt; 3
              on clean bytes is genuinely surprising. That still says “these bytes are not Gaussian
              after the probit map” — a claim about the sample, not about its cause.
            </HonestNote>
            <CodeSnippet :code="negentropySnippet" title="the estimator calls" />
          </div>
        </div>
      </div>
      <p v-else class="text-sm text-muted">Run the battery above to fill this section.</p>

      <template #footer>
        Kurtosis-based J is very outlier-sensitive (the y⁴ term); the Hyvärinen contrasts are the
        robust default. Vasicek's m-spacings estimator is negatively biased at small n and is not
        clamped at zero — by honesty.
      </template>
    </DemoSection>
  </div>
</template>
