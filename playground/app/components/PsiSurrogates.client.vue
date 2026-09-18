<script setup lang="ts">
/**
 * Section 3a — what a null ensemble has to do to be a null: an H0 calibration
 * of the label-shuffle surrogates over many simulated null datasets, with the
 * 0.1.x rotation defect reconstructed next to the 0.2.0 permutation null.
 */
import {
  DEFAULT_SURROGATES,
  describeLabelShuffle,
  labelShuffleSurrogates,
  permutationP,
  type Stimulus,
} from '@mindpeeker/psi'
import { createYielder } from '~/lib/async'
import { fmtBytes, fmtNum } from '~/lib/format'
import { bytesFor, type SimSource, simBytes, sumsFromBytes, zScores } from '~/lib/psi/synthetic'

const BITS = 200
const ALPHA = 0.05

const datasets = ref(120)
const epochs = ref(16)
const surrogates = ref(99)
const seed = ref(20260917)
const simSource = ref<SimSource>('drbg')

const SIM_SOURCES: { label: string; value: SimSource }[] = [
  { label: 'seeded DRBG — same figures every run', value: 'drbg' },
  { label: 'browser CSPRNG — a fresh null every run', value: 'crypto' },
]

const budget = computed(() => bytesFor(datasets.value * epochs.value, BITS))

/** The alternating target/control design the 0.1.x null was degenerate on. */
function alternating(n: number): Stimulus[] {
  return Array.from({ length: n }, (_, i): Stimulus => (i % 2 === 0 ? 'target' : 'control'))
}

/** (Z_target − Z_control)/√2 — analyzePresentiment's pre-window statistic. */
function deltaZ(values: Float64Array, labels: readonly Stimulus[]): number {
  let st = 0
  let nt = 0
  let sc = 0
  let nc = 0
  for (let i = 0; i < values.length; i++) {
    if (labels[i] === 'target') {
      st += values[i] as number
      nt++
    } else {
      sc += values[i] as number
      nc++
    }
  }
  if (nt === 0 || nc === 0) return Number.NaN
  return (st / Math.sqrt(nt) - sc / Math.sqrt(nc)) / Math.SQRT2
}

interface Calibration {
  permutation: number[]
  rotation: number[]
  legacy: number[]
  describePermutation: ReturnType<typeof describeLabelShuffle>
  describeRotation: ReturnType<typeof describeLabelShuffle>
  legacySurrogates: number
}

const task = useTask<Calibration>()
const result = computed(() => task.result.value)

function go(): void {
  void task.run(async (signal, setProgress) => {
    const n = epochs.value
    const labels = alternating(n)
    const m = surrogates.value
    const tick = createYielder(8, signal)
    const bytes = await simBytes(
      budget.value,
      simSource.value,
      `psi surrogate calibration / ${seed.value}`,
      signal,
    )
    const sums = sumsFromBytes(bytes, BITS)
    const out: Calibration = {
      permutation: [],
      rotation: [],
      legacy: [],
      describePermutation: describeLabelShuffle(labels, { surrogates: m, seed: seed.value }),
      describeRotation: describeLabelShuffle(labels, { method: 'rotation' }),
      legacySurrogates: m,
    }
    for (let d = 0; d < datasets.value; d++) {
      const values = zScores(sums.subarray(d * n, (d + 1) * n), BITS)
      const observed = deltaZ(values, labels)

      // 0.2.0 default: seeded uniform, count-preserving relabelings.
      const permNulls: number[] = []
      for (const relabeled of labelShuffleSurrogates(labels, {
        surrogates: m,
        seed: seed.value + d,
      })) {
        permNulls.push(deltaZ(values, relabeled))
      }
      out.permutation.push(permutationP(observed, permNulls))

      // 0.2.0 opt-in: the cyclic group, identity copies included.
      const rotNulls: number[] = []
      const nonIdentity: number[] = []
      for (const relabeled of labelShuffleSurrogates(labels, { method: 'rotation' })) {
        const statistic = deltaZ(values, relabeled)
        rotNulls.push(statistic)
        if (relabeled.some((label, i) => label !== labels[i])) nonIdentity.push(statistic)
      }
      out.rotation.push(permutationP(observed, rotNulls))

      // 0.1.x: `count` rotations with the ones reproducing the labeling skipped —
      // for an alternating design that is m copies of the complement.
      const legacyNulls: number[] = []
      for (let i = 0; i < m && nonIdentity.length; i++) {
        legacyNulls.push(nonIdentity[i % nonIdentity.length] as number)
      }
      out.legacy.push(permutationP(observed, legacyNulls))

      setProgress((d + 1) / datasets.value)
      await tick()
    }
    return out
  })
}

const rate = (values: number[]) => (values.length ? values.filter((p) => p <= ALPHA).length : 0)

const arms = computed(() => {
  const r = result.value
  if (!r) return []
  return [
    {
      key: 'permutation',
      title: '0.2.0 default — seeded permutations',
      values: r.permutation,
      describe: r.describePermutation,
      tone: 'success' as const,
      note: 'uniform p under H0: about 5 % of null datasets fall below 0.05, by construction',
    },
    {
      key: 'rotation',
      title: "0.2.0 opt-in — method: 'rotation'",
      values: r.rotation,
      describe: r.describeRotation,
      tone: 'neutral' as const,
      note: 'exact but nearly powerless here: an alternating vector has only two distinct rotations',
    },
    {
      key: 'legacy',
      title: '0.1.x reconstruction — rotations, identity skipped',
      values: r.legacy,
      describe: undefined,
      tone: 'error' as const,
      note: 'm copies of the complement: p hits its floor whenever Δz > 0 — about half the time',
    },
  ]
})

const snippet = computed(
  () => `import { describeLabelShuffle, labelShuffleSurrogates, permutationP } from '@mindpeeker/psi'

const labels = ['target', 'control', 'target', 'control', /* … */]
const nulls = []
for (const relabeled of labelShuffleSurrogates(labels, {
  surrogates: ${surrogates.value}, seed: ${seed.value},   // both belong in the registration
})) nulls.push(deltaZ(values, relabeled))

const p = permutationP(observed, nulls)              // (1 + #{s ≥ s_obs}) / (1 + m)
console.log(describeLabelShuffle(labels, { surrogates: ${surrogates.value} }))
// { method: 'random', surrogates: ${surrogates.value}, distinctLabelings: …, resolution: ${fmtNum(1 / (surrogates.value + 1), { digits: 4 })} }`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="surrogates-calibration"
      title="1 · H₀ calibration of the label-shuffle null"
      description="Simulate many datasets in which nothing is happening, run each through the permutation test, and look at the distribution of p. A valid null gives uniform p and rejects at exactly α; the 0.1.x rotation null did not."
      :api="[
        'labelShuffleSurrogates',
        'permutationP',
        'describeLabelShuffle',
        'DEFAULT_SURROGATES',
      ]"
    >
      <template #controls>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          :label="`Calibrate on ${datasets} null datasets`"
          busy-label="Simulating…"
          :hint="`${fmtBytes(budget)} of simulation bytes, ${datasets * epochs} trials — nothing here touches a network source`"
          @run="go"
          @cancel="task.cancel()"
        />
        <UFormField label="Null datasets">
          <UInputNumber v-model="datasets" :min="20" :max="500" :step="20" class="w-32" />
        </UFormField>
        <UFormField label="Epochs per dataset" help="alternating target / control">
          <UInputNumber v-model="epochs" :min="4" :max="64" :step="2" class="w-32" />
        </UFormField>
        <UFormField label="Surrogates m">
          <UInputNumber v-model="surrogates" :min="9" :max="999" :step="10" class="w-32" />
        </UFormField>
        <UFormField label="Seed">
          <UInputNumber v-model="seed" :min="0" :step="1" class="w-40" />
        </UFormField>
        <UFormField label="Simulation bytes" class="min-w-64">
          <USelect v-model="simSource" :items="SIM_SOURCES" class="w-full" />
        </UFormField>
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div v-if="result" class="flex flex-col gap-5">
        <div class="grid gap-4 lg:grid-cols-3">
          <div v-for="arm in arms" :key="arm.key" class="flex flex-col gap-2">
            <h3 class="text-sm font-medium text-highlighted">{{ arm.title }}</h3>
            <StatTile
              label="null datasets with p ≤ 0.05"
              :value="`${rate(arm.values)} / ${arm.values.length}`"
              :tone="arm.tone"
              size="sm"
              :note="`${fmtNum((100 * rate(arm.values)) / Math.max(1, arm.values.length), { digits: 1 })} % — the honest target is 5 %`"
            />
            <Histogram
              :values="arm.values"
              :bins="20"
              :domain="[0, 1]"
              :markers="[{ value: ALPHA, label: 'α = 0.05', color: 'error' }]"
              x-label="permutation p"
              y-label="null datasets"
              :height="200"
              :aria-label="`distribution of the permutation p over null datasets, ${arm.title}`"
            />
            <p class="text-xs text-muted">{{ arm.note }}</p>
            <p v-if="arm.describe" class="text-xs text-dimmed font-mono">
              method {{ arm.describe.method }} · m {{ arm.describe.surrogates }} · distinct
              {{ fmtNum(arm.describe.distinctLabelings, { digits: 0 }) }} · resolution
              {{ fmtNum(arm.describe.resolution, { digits: 4 }) }}
            </p>
            <p v-else class="text-xs text-dimmed font-mono">
              method rotation (0.1.x) · m {{ result.legacySurrogates }} · resolution
              {{ fmtNum(1 / (result.legacySurrogates + 1), { digits: 4 }) }}
            </p>
          </div>
        </div>

        <CodeSnippet :code="snippet" title="the 0.2.0 null, as the calibration ran it" />
      </div>
      <p v-else-if="!task.busy.value" class="text-sm text-muted">
        Nothing has been simulated yet. Each dataset is {{ epochs }} independent 200-bit trials
        labelled target / control alternately — by construction there is no effect in any of them.
      </p>

      <HonestNote variant="fixed-in-0.2">
        In 0.1 the label-shuffle null used circular rotations and skipped the ones that reproduced
        the observed labeling. For the alternating target/control design that leaves m copies of the
        complement, so p hits its floor whenever the observed Δz is positive — about half of all
        null datasets came out "significant" at α = 0.05. 0.2.0 draws seeded uniform permutations
        (or enumerates every distinct relabeling when few exist); rotations are opt-in and count
        their identity elements.
      </HonestNote>

      <template #footer>
        The resolution of a permutation p is 1/(m+1): the default
        <code class="font-mono">DEFAULT_SURROGATES = {{ DEFAULT_SURROGATES }}</code> cannot support
        a claim below 0.0099. Raise <code class="font-mono">surrogates</code> — and register it —
        before looking at the data.
      </template>
    </DemoSection>

    <PsiOffsets />
  </div>
</template>
