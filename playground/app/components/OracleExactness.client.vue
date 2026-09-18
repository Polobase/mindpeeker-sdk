<script setup lang="ts">
/**
 * Where the bias would be — `byte % n` against rejection-sampled
 * `uniformInt(n)`, both fed the very same bytes.
 */
import { byteReader, OracleError, uniformInt } from '@mindpeeker/oracle'
import { createYielder } from '~/lib/async'
import { fmtNum } from '~/lib/format'
import {
  acceptance,
  attemptBytes,
  clampInt,
  expectedUniformBytes,
  naiveBiasRatio,
  naiveFavoured,
  naiveModuloProbs,
} from '~/lib/oracle/exact'
import { bulkChunkBytes, drawBytes } from '~/lib/oracle/loops'
import {
  defaultSampleSource,
  isNetworkSample,
  type SampleSourceId,
  sampleHint,
  sampleProvider,
  sampleSourceName,
  sampleSourceOptions,
} from '~/lib/oracle/sources'
import { goodnessOfFit, toFrequencies } from '~/lib/oracle/stats'

interface Run {
  readonly n: number
  readonly naive: readonly number[]
  readonly exact: readonly number[]
  readonly bytes: number
  readonly exactDraws: number
  readonly source: string
}

const PRESETS = [
  { value: 100, label: 'n = 100 — 56 residues favoured 3:2' },
  { value: 129, label: 'n = 129 — 127 residues favoured 2:1' },
  { value: 78, label: 'n = 78 — the tarot deal' },
  { value: 64, label: 'n = 64 — divides 256, no bias at all' },
  { value: 6, label: 'n = 6 — one die' },
]

const n = ref<number>(100)
/** A cleared number input must never reach the maths. */
const modulus = computed(() => clampInt(n.value, 2, 256, 100))
const bytes = ref(8192)
const sample = ref<SampleSourceId>(defaultSampleSource())
const sourceItems = sampleSourceOptions()
const task = useTask<Run>()
const run = computed(() => task.result.value)

const byteChoices = computed(() =>
  isNetworkSample(sample.value)
    ? [
        { value: 256, label: '256 bytes' },
        { value: 512, label: '512 bytes' },
      ]
    : [
        { value: 2048, label: '2 048 bytes' },
        { value: 8192, label: '8 192 bytes' },
        { value: 32768, label: '32 768 bytes' },
      ],
)

watch(sample, () => {
  const allowed = byteChoices.value.map((c) => c.value)
  if (!allowed.includes(bytes.value)) bytes.value = allowed[allowed.length - 1] as number
})

const naiveProbs = computed(() => naiveModuloProbs(modulus.value))
const uniformProbs = computed(() => new Array<number>(modulus.value).fill(1 / modulus.value))
const categories = computed(() => Array.from({ length: modulus.value }, (_, i) => String(i)))

function go(): void {
  void task.run(async (signal, setProgress) => {
    const chosen = modulus.value
    const pool = await drawBytes(bytes.value, {
      signal,
      setProgress,
      source: sampleProvider(sample.value),
      chunkBytes: bulkChunkBytes(isNetworkSample(sample.value)),
    })

    // 1. The naive mapping: one residue per byte, no rejection, no bytes wasted.
    const naive = new Array<number>(chosen).fill(0)
    for (const byte of pool) naive[byte % chosen] = (naive[byte % chosen] as number) + 1

    // 2. The exact mapping: the same bytes through uniformInt, which rejects.
    const exact = new Array<number>(chosen).fill(0)
    const reader = byteReader(pool)
    const tick = createYielder(8, signal)
    let draws = 0
    try {
      for (;;) {
        const value = await uniformInt(reader, chosen)
        exact[value] = (exact[value] as number) + 1
        draws++
        if ((draws & 255) === 0) await tick()
      }
    } catch (error) {
      if (!(error instanceof OracleError) || error.code !== 'insufficient_entropy') throw error
    } finally {
      await reader.close()
    }

    return {
      n: chosen,
      naive,
      exact,
      bytes: pool.length,
      exactDraws: draws,
      source: sampleSourceName(sample.value),
    }
  })
}

const naiveFreq = computed(() => (run.value ? toFrequencies(run.value.naive) : []))
const exactFreq = computed(() => (run.value ? toFrequencies(run.value.exact) : []))
const naiveFit = computed(() =>
  run.value
    ? goodnessOfFit(run.value.naive, new Array(run.value.n).fill(1 / run.value.n))
    : undefined,
)
const exactFit = computed(() =>
  run.value
    ? goodnessOfFit(run.value.exact, new Array(run.value.n).fill(1 / run.value.n))
    : undefined,
)
const runNaiveProbs = computed(() => (run.value ? naiveModuloProbs(run.value.n) : []))
const runUniformProbs = computed(() =>
  run.value ? new Array<number>(run.value.n).fill(1 / run.value.n) : [],
)
const runCategories = computed(() =>
  run.value ? Array.from({ length: run.value.n }, (_, i) => String(i)) : [],
)

const code = computed(
  () => `import { byteReader, uniformInt } from '@mindpeeker/oracle'

// Naive — biased whenever n does not divide 256ᵏ:
const residue = byte % ${modulus.value}

// Exact — reject the ragged tail, then reduce (von Neumann 1951):
const reader = byteReader(bytes)
const value = await uniformInt(reader, ${modulus.value})
// k = ${attemptBytes(modulus.value)} byte(s) per attempt, accepted with probability
// α = ⌊256^k/n⌋·n / 256^k = ${fmtNum(acceptance(modulus.value), { digits: 6 })},
// so the expected cost is ${fmtNum(expectedUniformBytes(modulus.value), { digits: 4 })} bytes per draw.`,
)
</script>

<template>
  <DemoSection
    id="exactness-modulo"
    title="Modulo bias vs rejection sampling"
    :api="['uniformInt', 'byteReader', 'OracleError']"
    description="The naive byte % n mapping over-weights the small residues by up to one part in ⌊256ᵏ/n⌋ — a fixed, structural error that no sample size cures. uniformInt rejects the ragged tail instead, so every residue is hit by exactly ⌊256ᵏ/n⌋ byte values. Both mappings below are fed the identical bytes."
  >
    <template #controls>
      <UFormField label="Modulus n" size="sm" class="w-28">
        <UInputNumber v-model="n" :min="2" :max="256" class="w-full" />
      </UFormField>
      <UFormField label="Try" size="sm" class="w-full sm:w-72">
        <USelect v-model="n" :items="PRESETS" placeholder="custom n" class="w-full" />
      </UFormField>
      <UFormField label="Bytes" size="sm" class="w-full sm:w-44">
        <USelect v-model="bytes" :items="byteChoices" class="w-full" :disabled="task.busy.value" />
      </UFormField>
      <UFormField label="Sample from" size="sm" class="w-full sm:w-72">
        <USelect v-model="sample" :items="sourceItems" class="w-full" :disabled="task.busy.value" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Draw and compare"
        icon="i-lucide-sigma"
        :hint="sampleHint(sample, bytes)"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The run failed" @dismiss="task.reset()" />

    <div class="grid gap-3 sm:grid-cols-4">
      <StatTile
        label="Naive bias, exactly"
        :value="`${fmtNum(naiveBiasRatio(modulus), { digits: 3 })}×`"
        :tone="naiveBiasRatio(modulus) > 1 ? 'error' : 'success'"
        :note="
          naiveBiasRatio(modulus) > 1
            ? `${naiveFavoured(modulus)} of ${modulus} residues are that much likelier`
            : 'n divides 256 — the naive mapping happens to be fair'
        "
        size="sm"
      />
      <StatTile
        label="Acceptance α"
        :value="acceptance(modulus)"
        :digits="5"
        note="always > 1/2, whatever n is"
        size="sm"
      />
      <StatTile
        label="Expected bytes / draw"
        :value="expectedUniformBytes(modulus)"
        :digits="4"
        :note="`k/α with k = ${attemptBytes(modulus)}`"
        size="sm"
      />
      <StatTile
        label="Rejected byte values"
        :value="256 ** attemptBytes(modulus) - Math.floor(256 ** attemptBytes(modulus) / modulus) * modulus"
        :note="`of ${fmtNum(256 ** attemptBytes(modulus))} — the ragged tail`"
        size="sm"
      />
    </div>

    <div v-if="!run" class="mt-4">
      <p class="text-sm text-muted">
        The overlay on the left chart below is not a fit — it is the exact naive distribution
        computed from n alone. Press <strong>Draw and compare</strong> to put observed bars against
        it.
      </p>
      <BarChart
        class="mt-3"
        :categories="categories"
        :values="naiveProbs"
        :expected="uniformProbs"
        expected-label="uniform 1/n"
        x-label="residue"
        y-label="exact P(residue) under byte % n"
        :height="230"
        :format="(v) => fmtNum(v, { digits: 5 })"
        aria-label="the exact probability of each residue under the naive modulo mapping"
      />
    </div>

    <div v-else class="mt-4 flex flex-col gap-5">
      <div class="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 class="text-sm font-semibold text-error">byte % n — biased</h3>
          <BarChart
            class="mt-2"
            :categories="runCategories"
            :values="naiveFreq"
            :expected="runNaiveProbs"
            expected-label="exact naive P — note the step"
            color="error"
            x-label="residue"
            y-label="frequency"
            :height="240"
            :format="(v) => fmtNum(v, { digits: 5 })"
            aria-label="observed residue frequencies under the naive modulo mapping"
          />
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <PValue :p="naiveFit?.p" kind="pointwise" label="χ² p vs uniform" />
            <span class="text-xs text-muted">χ² = {{ fmtNum(naiveFit?.chi2) }}</span>
          </div>
        </div>
        <div>
          <h3 class="text-sm font-semibold text-success">uniformInt(n) — exact</h3>
          <BarChart
            class="mt-2"
            :categories="runCategories"
            :values="exactFreq"
            :expected="runUniformProbs"
            expected-label="uniform 1/n — flat"
            color="success"
            x-label="value"
            y-label="frequency"
            :height="240"
            :format="(v) => fmtNum(v, { digits: 5 })"
            aria-label="observed value frequencies under rejection-sampled uniformInt"
          />
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <PValue :p="exactFit?.p" kind="pointwise" label="χ² p vs uniform" />
            <span class="text-xs text-muted">χ² = {{ fmtNum(exactFit?.chi2) }}</span>
          </div>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Bytes drawn" :value="run.bytes" :note="`from ${run.source}`" />
        <StatTile label="Naive draws" :value="run.bytes" note="one per byte — nothing rejected" />
        <StatTile
          label="Exact draws"
          :value="run.exactDraws"
          :note="`same bytes, ${fmtNum(run.bytes / Math.max(1, run.exactDraws), { digits: 3 })} bytes each`"
        />
        <StatTile
          label="Price of exactness"
          :value="`${fmtNum(100 * (1 - run.exactDraws / run.bytes), { digits: 1 })}%`"
          note="fewer draws from the same bytes"
        />
      </div>

      <HonestNote variant="exact" title="Read the left chart carefully">
        The step in the overlay is exact and permanent: it is what <code>byte % n</code> does, not
        what this sample did. A small p on the left is the bias becoming visible at this sample size;
        a large p on the right means no deviation from uniform was detected — which is the most a
        finite sample can ever say. PEAR-scale anomalies are parts in 10⁴, so a
        {{ fmtNum(100 * (naiveBiasRatio(modulus) - 1), { digits: 0 }) }}% plumbing bias would swamp any
        effect a study could hope to measure.
      </HonestNote>

      <CodeSnippet :code="code" title="the two mappings" />
    </div>

    <template #footer>
      Rejection costs bytes and nothing else: <code>uniformInt</code> discards the tail values
      instead of folding them onto small residues, and the discarded bytes still appear in
      <code>bytesConsumed</code>, because rejection <em>spends</em> entropy. Try n = 64: it divides
      256, so the naive mapping is accidentally fair and both charts agree.
    </template>
  </DemoSection>
</template>
