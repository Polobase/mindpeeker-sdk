<script setup lang="ts">
/** Section 6 — continuous signals become symbols by the order of their values. */
import {
  ordinalPatterns,
  permutationEntropy,
  symbolicTransferEntropy,
  weightedPermutationEntropy,
} from '@mindpeeker/flow'
import { provider, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtNum } from '~/lib/format'
import { patternFrequencies, sinePair } from '~/lib/flow/series'
import { num } from '~/lib/flow/types'
import {
  biasFloor,
  cellCount,
  degreesOfFreedom,
  factorial,
  maxPermutationEntropy,
  tupleCount,
} from '~/lib/flow/theory'

const SIZES = [1000, 2000, 4000].map((n) => ({ label: `${fmtNum(n, { digits: 0 })} samples`, value: n }))
const ORDERS = [3, 4, 5].map((value) => ({ label: `m = ${value} (${factorial(value)} patterns)`, value }))
const PREVIEW = 200
const SWEEP_STEPS = 21

const n = ref(2000)
const period = ref(9)
const noise = ref(30)
const order = ref(3)
const delay = ref(1)
const lag = ref(4)
const gain = 80

const task = useTask<{ bytes: Uint8Array; providerName: string }>()
const seedBytes = computed(() => task.result.value?.bytes)
const summary = sourceSummary()

function run(): void {
  void task.run(async (signal, setProgress) => {
    setProgress(null)
    restartSource()
    const drawn = await provider.getBytes(32, { signal })
    return { bytes: drawn.bytes, providerName: provider.name }
  })
}

onMounted(() => {
  if (!summary.network) run()
})

const signals = computed(() => {
  const bytes = seedBytes.value
  if (!bytes) return undefined
  return sinePair(bytes, {
    n: num(n.value, 2000),
    period: num(period.value, 9),
    noise: num(noise.value) / 100,
    lag: num(lag.value, 1),
    gain: gain / 100,
  })
})

const stats = computed(() => {
  const pair = signals.value
  if (!pair) return undefined
  const m = num(order.value, 3)
  const alphabet = factorial(m)
  const opts = { delay: delay.value }
  const patterns = ordinalPatterns(pair.x, m, opts)
  const patternN = patterns.length
  const df = degreesOfFreedom(alphabet, alphabet, 1, 1)
  const tuples = tupleCount(patternN, 1, 1, lag.value)
  return {
    m,
    alphabet,
    max: maxPermutationEntropy(m),
    peX: permutationEntropy(pair.x, m, opts),
    peXNorm: permutationEntropy(pair.x, m, { ...opts, normalize: true }),
    wpeX: weightedPermutationEntropy(pair.x, m, opts),
    wpeXNorm: weightedPermutationEntropy(pair.x, m, { ...opts, normalize: true }),
    peY: permutationEntropy(pair.y, m, opts),
    peYNorm: permutationEntropy(pair.y, m, { ...opts, normalize: true }),
    steForward: symbolicTransferEntropy(pair.x, pair.y, {
      order: m,
      delay: delay.value,
      k: 1,
      l: 1,
      lag: lag.value,
    }),
    steBackward: symbolicTransferEntropy(pair.y, pair.x, {
      order: m,
      delay: delay.value,
      k: 1,
      l: 1,
      lag: lag.value,
    }),
    frequencies: patternFrequencies(patterns, alphabet),
    patternN,
    tuples,
    df,
    floor: biasFloor(df, tuples),
    cells: cellCount(alphabet, alphabet, 1, 1),
    undersampled: tuples < 10 * cellCount(alphabet, alphabet, 1, 1),
  }
})

const preview = computed(() => {
  const pair = signals.value
  if (!pair) return []
  return [
    { name: 'X — driver', y: Array.from(pair.x.slice(0, PREVIEW)) },
    { name: `Y — follows X by ${lag.value}`, y: Array.from(pair.y.slice(0, PREVIEW)), color: 2 },
  ]
})

/** Normalized permutation entropy against the noise amplitude, at this order. */
const sweep = computed(() => {
  const bytes = seedBytes.value
  if (!bytes) return undefined
  const xs: number[] = []
  const pe: number[] = []
  const wpe: number[] = []
  for (let i = 0; i < SWEEP_STEPS; i++) {
    const amount = i / (SWEEP_STEPS - 1)
    const pair = sinePair(bytes, {
      n: Math.min(num(n.value, 2000), 2000),
      period: num(period.value, 9),
      noise: amount,
      lag: num(lag.value, 1),
      gain: gain / 100,
    })
    xs.push(amount)
    pe.push(permutationEntropy(pair.x, order.value, { delay: delay.value, normalize: true }))
    wpe.push(weightedPermutationEntropy(pair.x, order.value, { delay: delay.value, normalize: true }))
  }
  return { xs, pe, wpe }
})

const snippet = computed(
  () => `import {
  ordinalPatterns, permutationEntropy, symbolicTransferEntropy, weightedPermutationEntropy,
} from '@mindpeeker/flow'

const m = ${order.value}, delay = ${delay.value}

// Bandt–Pompe: each window of m values becomes the permutation that sorts it.
const symbols = ordinalPatterns(x, m, { delay })            // values in [0, m!)
const pe = permutationEntropy(x, m, { delay, normalize: true })  // ÷ log2(m!)
const wpe = weightedPermutationEntropy(x, m, { delay, normalize: true })

// Staniek–Lehnertz symbolic TE — the ordinal alphabet is m! = ${factorial(order.value)}
const forward = symbolicTransferEntropy(x, y, { order: m, delay, k: 1, l: 1, lag: ${lag.value} })
const backward = symbolicTransferEntropy(y, x, { order: m, delay, k: 1, l: 1, lag: ${lag.value} })`,
)
</script>

<template>
  <DemoSection
    id="ordinal"
    title="6 · Ordinal patterns"
    :api="['ordinalPatterns', 'permutationEntropy', 'weightedPermutationEntropy', 'symbolicTransferEntropy']"
  >
    <template #description>
      Continuous measurements have no alphabet. Bandt–Pompe symbolization replaces each window of
      <em>m</em> values with the permutation that sorts it, which is robust to any monotone
      distortion of the signal. Here X is a sine plus uniform noise and Y follows it by a few
      samples; raise the noise and the pattern distribution flattens towards log₂(m!).
    </template>

    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Reseed the noise"
        busy-label="Drawing…"
        icon="i-lucide-waves"
        hint="32 bytes from the selected source seed the noise; the sliders reshape the signal instantly"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UFormField label="Samples" size="sm">
        <USelect v-model="n" :items="SIZES" class="w-full" />
      </UFormField>
      <UFormField label="Noise amplitude" :hint="(noise / 100).toFixed(2)" size="sm">
        <USlider v-model="noise" :min="0" :max="100" :step="2" class="mt-2" />
      </UFormField>
      <UFormField label="Pattern order m" size="sm">
        <USelect v-model="order" :items="ORDERS" class="w-full" />
      </UFormField>
      <UFormField label="Embedding delay" :hint="String(delay)" size="sm">
        <USlider v-model="delay" :min="1" :max="4" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="Period (samples per cycle)" :hint="String(period)" size="sm">
        <USlider v-model="period" :min="4" :max="40" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="Y follows X by" :hint="`${lag} samples`" size="sm">
        <USlider v-model="lag" :min="1" :max="8" :step="1" class="mt-2" />
      </UFormField>
    </div>

    <div v-if="stats && sweep" class="mt-4 flex flex-col gap-4">
      <LineChart
        :series="preview"
        x-label="t"
        y-label="value"
        :height="200"
        aria-label="The driver signal and its delayed follower"
        :format="(v: number) => fmtNum(v, { digits: 3 })"
      />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="permutation entropy H(X)"
          :value="stats.peX"
          :digits="4"
          :note="`bits; the maximum is log₂(m!) = log₂(${stats.alphabet}) = ${fmtNum(stats.max, { digits: 4 })}`"
        />
        <StatTile
          label="normalized PE(X)"
          :value="stats.peXNorm"
          :digits="4"
          tone="primary"
          note="1.000 = every ordering equally likely"
        />
        <StatTile
          label="weighted PE(X)"
          :value="stats.wpeXNorm"
          :digits="4"
          note="Fadlallah et al. — patterns weighted by window variance, so flat noise counts less"
        />
        <StatTile label="normalized PE(Y)" :value="stats.peYNorm" :digits="4" note="the follower" />
        <StatTile
          label="symbolic TE X→Y"
          :value="stats.steForward"
          :digits="4"
          :tone="stats.steForward > 10 * stats.floor ? 'primary' : 'neutral'"
          note="Staniek–Lehnertz, on the ordinal symbols"
        />
        <StatTile label="symbolic TE Y→X" :value="stats.steBackward" :digits="4" note="the other direction" />
        <StatTile
          label="bias floor df/(2N ln2)"
          :value="stats.floor"
          :digits="4"
          tone="warning"
          :note="`df ${fmtNum(stats.df, { digits: 0 })} over ${fmtNum(stats.tuples, { digits: 0 })} tuples`"
        />
        <StatTile
          label="joint table"
          :value="fmtNum(stats.cells, { digits: 0 })"
          :tone="stats.undersampled ? 'error' : 'neutral'"
          :note="stats.undersampled ? 'cells — far more than the data can fill' : 'cells, against N tuples'"
        />
      </div>

      <UAlert
        v-if="stats.undersampled"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="This symbolic transfer entropy is dominated by bias"
        :description="`The ordinal alphabet is m! = ${stats.alphabet}, so the joint table has ${fmtNum(stats.cells, { digits: 0 })} cells for ${fmtNum(stats.tuples, { digits: 0 })} tuples. Both directions inflate together; the difference between them is not interpretable. Drop to m = 3, or bring far more data.`"
      />

      <div>
        <h3 class="text-sm font-medium text-highlighted">
          Ordinal pattern frequencies of X ({{ stats.alphabet }} patterns)
        </h3>
        <p class="mt-1 text-xs text-muted">
          Under an iid signal every pattern has probability 1/m! =
          {{ fmtNum(1 / stats.alphabet, { digits: 4 }) }}; a clean sine visits only a few of them.
        </p>
        <BarChart
          class="mt-2"
          :categories="Array.from({ length: stats.alphabet }, (_, i) => String(i))"
          :values="stats.frequencies"
          :expected="1 / stats.alphabet"
          expected-label="1 / m! — the uniform reference"
          y-label="frequency"
          x-label="ordinal pattern index"
          :height="220"
          aria-label="Frequency of each ordinal pattern in the driver signal"
          :format="(v: number) => fmtNum(v, { digits: 4 })"
        />
      </div>

      <div>
        <h3 class="text-sm font-medium text-highlighted">Permutation entropy against noise</h3>
        <LineChart
          class="mt-2"
          :series="[
            { name: 'normalized permutation entropy', y: sweep.pe, x: sweep.xs },
            { name: 'weighted permutation entropy', y: sweep.wpe, x: sweep.xs, color: 3 },
          ]"
          :hlines="[{ value: 1, label: 'log₂(m!) — indistinguishable from noise', color: 'muted' }]"
          :vlines="[{ value: noise / 100, label: 'current noise', color: 'primary' }]"
          x-label="noise amplitude"
          y-label="normalized entropy"
          :y-domain="[0, 1.05]"
          :height="220"
          aria-label="Normalized permutation entropy of the driver as a function of the noise amplitude"
          :format="(v: number) => fmtNum(v, { digits: 4 })"
        />
      </div>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <p v-else-if="!task.busy.value" class="mt-4 text-sm text-muted">
      Draw the noise seed to build the signals.
    </p>

    <template #footer>
      Permutation entropy is exact arithmetic on the ordering of values, and its maximum log₂(m!) is
      a fact, not an estimate. The symbolic transfer entropy above it is an estimate on an alphabet
      of m! symbols — it inherits every sampling caveat of section 2, multiplied. A periodic driver
      also makes <em>both</em> directions predictive: the phase of a sine tells you about its own
      past and future, so read the asymmetry between the two values, never either one alone.
    </template>
  </DemoSection>
</template>
