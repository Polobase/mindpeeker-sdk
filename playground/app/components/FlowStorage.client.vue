<script setup lang="ts">
/** Section 5 — what a stream remembers about itself, and the exact identity behind it. */
import {
  activeInformationStorage,
  blockEntropy,
  entropyRate,
  localActiveInformationStorage,
  localTransferEntropy,
  predictiveInformation,
  shannonEntropy,
} from '@mindpeeker/flow'
import { provider, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { bytesForBits, memoryChain } from '~/lib/flow/series'
import { num } from '~/lib/flow/types'
import type { LabSeries } from '~/lib/flow/types'

const props = defineProps<{ series?: LabSeries }>()

const SIZES = [4000, 8000, 16000].map((n) => ({ label: `${fmtNum(n, { digits: 0 })} symbols`, value: n }))
const MAX_K = 8
const LOCALS = 300

const n = ref(6000)
const memory = ref(2)
const persistence = ref(90)
const detailK = ref(2)
const kFuture = ref(2)

interface Chain {
  chain: Uint8Array
  n: number
  memory: number
  persistence: number
  bytes: number
  providerName: string
}

const task = useTask<Chain>()
const data = computed(() => task.result.value)
const summary = sourceSummary()

function run(): void {
  void task.run(async (signal, setProgress) => {
    setProgress(null)
    restartSource()
    const size = num(n.value, 6000)
    const bytes = bytesForBits(size)
    const drawn = await provider.getBytes(bytes, { signal })
    return {
      chain: memoryChain(drawn.bytes, {
        n: size,
        memory: num(memory.value, 1),
        persistence: num(persistence.value, 90),
      }),
      n: size,
      memory: num(memory.value, 1),
      persistence: num(persistence.value, 90),
      bytes,
      providerName: provider.name,
    }
  })
}

interface SweepRow {
  k: number
  ais: number
  rate: number
  sum: number
  h: number
  residual: number
  block: number
  predictive: number
}

const sweep = computed<SweepRow[]>(() => {
  const d = data.value
  if (!d) return []
  const rows: SweepRow[] = []
  for (let k = 1; k <= MAX_K; k++) {
    const ais = activeInformationStorage(d.chain, { k, alphabet: 2 })
    const rate = entropyRate(d.chain, { k, alphabet: 2 })
    // Over the same predicted samples, A_X(k) + h_μ(k) = H(X_{t+1}) exactly.
    const h = shannonEntropy(d.chain.subarray(k), { alphabet: 2 })
    rows.push({
      k,
      ais,
      rate,
      sum: ais + rate,
      h,
      residual: ais + rate - h,
      block: blockEntropy(d.chain, k, { alphabet: 2 }),
      predictive: predictiveInformation(d.chain, { k, kFuture: num(kFuture.value, 1), alphabet: 2 }),
    })
  }
  return rows
})

const detail = computed(() => sweep.value.find((row) => row.k === num(detailK.value, 1)))

const storageSeries = computed(() => {
  const rows = sweep.value
  if (rows.length === 0) return []
  return [
    { name: 'active information storage A(k)', points: rows.map((r) => [r.k, r.ais] as [number, number]) },
    { name: 'entropy rate h(k)', points: rows.map((r) => [r.k, r.rate] as [number, number]), color: 2 },
    {
      name: 'A(k) + h(k)',
      points: rows.map((r) => [r.k, r.sum] as [number, number]),
      color: 4,
      dashed: true,
    },
  ]
})

const blockSeries = computed(() => {
  const rows = sweep.value
  if (rows.length === 0) return []
  return [
    { name: 'block entropy H(k)', points: rows.map((r) => [r.k, r.block] as [number, number]), color: 3 },
    {
      name: `predictive information (kFuture ${kFuture.value})`,
      points: rows.map((r) => [r.k, r.predictive] as [number, number]),
      color: 5,
    },
  ]
})

const localAis = computed(() => {
  const d = data.value
  if (!d) return undefined
  const local = localActiveInformationStorage(d.chain, { k: num(detailK.value, 1), alphabet: 2 })
  const values = Array.from(local.values.slice(local.start, local.start + LOCALS))
  const x = values.map((_, i) => local.start + i)
  const negatives = Array.from(local.values.slice(local.start)).filter((v) => v < 0).length
  return { values, x, mean: local.mean, count: local.count, negatives }
})

const localTe = computed(() => {
  const s = props.series
  if (!s) return undefined
  const local = localTransferEntropy(s.x, s.y, {
    k: s.params.k,
    l: s.params.l,
    lag: s.params.lag,
    alphabet: 2,
  })
  const values = Array.from(local.values.slice(local.start, local.start + LOCALS))
  const x = values.map((_, i) => local.start + i)
  const negatives = Array.from(local.values.slice(local.start)).filter((v) => v < 0).length
  return { values, x, mean: local.mean, count: local.count, negatives }
})

const snippet = computed(
  () => `import {
  activeInformationStorage, blockEntropy, entropyRate,
  localActiveInformationStorage, predictiveInformation, shannonEntropy,
} from '@mindpeeker/flow'

const k = ${detailK.value}
const ais = activeInformationStorage(chain, { k, alphabet: 2 })   // I(Xₜᵏ ; Xₜ₊₁)
const rate = entropyRate(chain, { k, alphabet: 2 })               // H(Xₜ₊₁ | Xₜᵏ)

// Over the same predicted samples the two add up exactly:
const h = shannonEntropy(chain.subarray(k), { alphabet: 2 })
ais + rate - h // 0, to the last bit of the float

blockEntropy(chain, k, { alphabet: 2 })                           // H of length-k blocks
predictiveInformation(chain, { k, kFuture: ${kFuture.value}, alphabet: 2 })       // finite excess entropy
localActiveInformationStorage(chain, { k, alphabet: 2 }).values   // pointwise, can go negative`,
)
</script>

<template>
  <DemoSection
    id="storage"
    title="5 · Information storage"
    :api="[
      'activeInformationStorage',
      'entropyRate',
      'blockEntropy',
      'predictiveInformation',
      'localActiveInformationStorage',
      'localTransferEntropy',
    ]"
  >
    <template #description>
      Before asking what one stream tells you about another, ask what a stream tells you about
      itself. This chain repeats the symbol <em>m</em> steps back with the persistence you set, and
      takes a fresh source bit otherwise — so its memory sits at exactly one lag. Active information
      storage should stay at zero until the history reaches it.
    </template>

    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Draw a chain"
        busy-label="Drawing…"
        icon="i-lucide-repeat"
        :hint="`${fmtBytes(bytesForBits(num(n, 0)))} from ${summary.label}`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <UFormField label="Samples" size="sm">
        <USelect v-model="n" :items="SIZES" class="w-full" />
      </UFormField>
      <UFormField label="Memory m" :hint="`lag ${memory}`" size="sm">
        <USlider v-model="memory" :min="1" :max="4" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="Persistence" :hint="`${persistence}%`" size="sm">
        <USlider v-model="persistence" :min="50" :max="100" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="k for the detail" :hint="String(detailK)" size="sm">
        <USlider v-model="detailK" :min="1" :max="MAX_K" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="kFuture" :hint="String(kFuture)" size="sm">
        <USlider v-model="kFuture" :min="1" :max="4" :step="1" class="mt-2" />
      </UFormField>
    </div>

    <div v-if="data && detail" class="mt-4 flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          :label="`A(k=${detail.k})`"
          :value="detail.ais"
          :digits="5"
          :tone="detail.k >= data.memory ? 'primary' : 'neutral'"
          note="bits the past stores about the next symbol"
        />
        <StatTile :label="`h(k=${detail.k})`" :value="detail.rate" :digits="5" note="bits still unpredictable" />
        <StatTile
          label="A + h"
          :value="detail.sum"
          :digits="9"
          note="must equal H(Xₜ₊₁) over the same samples"
        />
        <StatTile
          label="residual (A + h − H)"
          :value="fmtNum(detail.residual, { exponential: true, digits: 1 })"
          tone="success"
          :note="`H(Xₜ₊₁) = ${fmtNum(detail.h, { digits: 9 })} — the identity holds to the last float bit`"
        />
        <StatTile
          :label="`block entropy H(${detail.k})`"
          :value="detail.block"
          :digits="4"
          note="bits per length-k block"
        />
        <StatTile
          label="predictive information"
          :value="detail.predictive"
          :digits="4"
          :note="`I(Xₜᵏ ; Xₜ₊₁^${kFuture}) — with kFuture 1 this is exactly A(k)`"
        />
        <StatTile
          label="planted memory"
          :value="data.memory"
          :digits="0"
          :note="`the chain copies x[t−${data.memory}] ${data.persistence}% of the time`"
        />
        <StatTile
          label="local AIS below zero"
          :value="localAis ? `${localAis.negatives} / ${localAis.count}` : '—'"
          note="samples the past actively mispredicted"
        />
      </div>

      <div>
        <h3 class="text-sm font-medium text-highlighted">
          Storage and entropy rate as the history grows
        </h3>
        <p class="mt-1 text-xs text-muted">
          A(k) steps up exactly when k reaches the planted memory ({{ data.memory }}), and the dashed
          sum lies on H(Xₜ₊₁) for every k — that is the identity, drawn.
        </p>
        <LineChart
          class="mt-2"
          :series="storageSeries"
          :hlines="[{ value: detail.h, label: 'H(Xₜ₊₁)', color: 'muted' }]"
          :vlines="[{ value: data.memory, label: `planted memory ${data.memory}`, color: 'success' }]"
          x-label="destination history k"
          y-label="bits"
          :height="260"
          aria-label="Active information storage and entropy rate against the history length k"
          :format="(v: number) => fmtNum(v, { digits: 5 })"
        />
      </div>

      <div>
        <h3 class="text-sm font-medium text-highlighted">Block entropy and predictive information</h3>
        <LineChart
          class="mt-2"
          :series="blockSeries"
          x-label="k"
          y-label="bits"
          :height="220"
          aria-label="Block entropy and predictive information against k"
          :format="(v: number) => fmtNum(v, { digits: 4 })"
        />
      </div>

      <div v-if="localAis">
        <h3 class="text-sm font-medium text-highlighted">
          Local active information storage, first {{ localAis.values.length }} samples
        </h3>
        <p class="mt-1 text-xs text-muted">
          Pointwise terms whose mean is A(k) = {{ fmtNum(localAis.mean, { digits: 5 }) }} bits.
          Negative values are the moments the chain's own past pointed the wrong way.
        </p>
        <LineChart
          class="mt-2"
          :series="[{ name: 'local AIS', y: localAis.values, x: localAis.x }]"
          :hlines="[
            { value: localAis.mean, label: 'mean = A(k)', color: 'primary' },
            { value: 0, label: '0', color: 'muted', dashed: false },
          ]"
          x-label="t"
          y-label="bits"
          :height="200"
          aria-label="Local active information storage over time"
          :format="(v: number) => fmtNum(v, { digits: 3 })"
        />
      </div>

      <div v-if="localTe">
        <h3 class="text-sm font-medium text-highlighted">
          Local transfer entropy of the section 1 pair
        </h3>
        <p class="mt-1 text-xs text-muted">
          The same decomposition for X→Y: mean {{ fmtNum(localTe.mean, { digits: 5 }) }} bits, with
          {{ localTe.negatives }} of {{ localTe.count }} samples negative — the source
          <em>misinformed</em> those predictions. Locals are what make transfer entropy a temporal
          filter rather than one number.
        </p>
        <LineChart
          class="mt-2"
          :series="[{ name: 'local TE X→Y', y: localTe.values, x: localTe.x, color: 2 }]"
          :hlines="[
            { value: localTe.mean, label: 'mean = TE', color: 'primary' },
            { value: 0, label: '0', color: 'muted', dashed: false },
          ]"
          x-label="t"
          y-label="bits"
          :height="200"
          aria-label="Local transfer entropy over time for the pair drawn in section 1"
          :format="(v: number) => fmtNum(v, { digits: 3 })"
        />
      </div>
      <p v-else class="text-xs text-muted">
        Draw the pair in section 1 to see its local transfer entropy here.
      </p>

      <AccountingBadge :bytes-consumed="data.bytes" :bits-used="data.n" :source="data.providerName" />

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <p v-else-if="!task.busy.value" class="mt-4 text-sm text-muted">
      Draw a chain to measure what it stores about itself.
    </p>

    <template #footer>
      A(k) + h(k) = H(Xₜ₊₁) is an identity, not a fit: it holds for any series at any k, and the
      residual above is float rounding. Everything else here is an estimate — raising k splits the
      same data over 2ᵏ⁺¹ cells, which is why A(k) keeps drifting upward past the planted memory.
    </template>
  </DemoSection>
</template>
