<script setup lang="ts">
/**
 * §5b — how much the last revealer's abort is worth, empirically, against the
 * exact 1 − 2^−(k+1) it is worth in theory.
 */
import { fmtNum } from '~/lib/format'
import { type AbortSimulation, simulateAbort } from '~/lib/ledger/coin'

const trials = ref(2000)
const restarts = ref(2)

const task = useTask<AbortSimulation>()
const result = computed(() => task.result.value)

function run(): void {
  void task.run(async (signal, setProgress) => {
    setProgress(0)
    const outcome = await simulateAbort(trials.value, restarts.value, {
      signal,
      onProgress: setProgress,
    })
    setProgress(1)
    return outcome
  })
}

const categories = computed(() => [
  'honest protocol',
  `aborting revealer, ${result.value?.restarts ?? restarts.value} restart(s) tolerated`,
])

const values = computed(() => {
  const r = result.value
  if (!r) return [0, 0]
  return [r.honestHeads / r.trials, r.abortHeads / r.trials]
})

const expected = computed(() => {
  const r = result.value
  return r ? [r.honestExpected, r.abortExpected] : [0.5, 0.5]
})

const deviations = computed(() => {
  const r = result.value
  if (!r) return undefined
  return {
    honest: (r.honestHeads / r.trials - r.honestExpected) / r.se,
    abort: (r.abortHeads / r.trials - r.abortExpected) / r.se,
  }
})

const snippet = computed(
  () => `// With k restarts tolerated before the protocol gives up, a party that
// refuses to open whenever the coin is not the face it wants gets its way
// with probability exactly 1 − 2^−(k+1):
//   k = 0 → 0.5      k = 1 → 0.75     k = 2 → 0.875
//   k = 3 → 0.9375   k = 4 → 0.96875
// Observed here over ${result.value?.trials ?? trials.value} rounds at k = ${
    result.value?.restarts ?? restarts.value
  }: ${fmtNum(values.value[1], { digits: 4 })} (exact ${fmtNum(expected.value[1], { digits: 5 })}).
//
// The honest arm uses the same bits and stays at ½. No property of
// combineReveals changes either number — the fix is procedural: record the
// missing reveal, and bind the seed to a beacon round published after the
// deadline so silence buys nothing.`,
)
</script>

<template>
  <DemoSection
    id="abort-bias"
    title="What an aborting revealer is worth"
    description="Every round here is fair: the honest party's share is uniform, so the coin is uniform. The bias comes from the protocol's recovery, not its cryptography — a party that walks away whenever it dislikes the outcome forces a restart, and restarts are free."
    :api="['combineReveals']"
    :level="2"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Simulate rounds"
        icon="i-lucide-dices"
        :hint="`${trials} rounds, both arms from the same byte stream — finishes in well under a second`"
        @run="run"
        @cancel="task.cancel()"
      />
      <UFormField label="Rounds" size="sm" class="w-32">
        <UInputNumber v-model="trials" :min="100" :max="200000" :step="500" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Restarts tolerated (k)" size="sm" class="w-40">
        <UInputNumber v-model="restarts" :min="0" :max="6" size="sm" class="w-full" />
      </UFormField>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div v-if="result" class="flex flex-col gap-4">
      <BarChart
        :categories="categories"
        :values="values"
        :expected="expected"
        expected-label="exact probability"
        y-label="share of rounds landing on the aborter's preferred face"
        :height="220"
        aria-label="Empirical share of preferred outcomes with and without an aborting last revealer, against the exact probabilities"
        :format="(v: number) => v.toFixed(4)"
      />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Honest protocol"
          :value="values[0]"
          :digits="4"
          :note="`exact ½ · ${result.honestHeads} of ${result.trials}`"
        />
        <StatTile
          label="With an aborting revealer"
          :value="values[1]"
          :digits="4"
          tone="warning"
          :note="`exact 1 − 2^−${result.restarts + 1} = ${fmtNum(result.abortExpected, { digits: 5 })}`"
        />
        <StatTile
          label="Honest arm, in SEs"
          :value="deviations?.honest"
          :digits="2"
          :note="`SE = √(¼/n) = ${fmtNum(result.se, { digits: 4 })}`"
        />
        <StatTile
          label="Abort arm, in SEs"
          :value="deviations?.abort"
          :digits="2"
          note="distance from its own exact probability, not from ½"
        />
      </div>

      <CodeSnippet :code="snippet" title="the exact numbers behind the bars" />
    </div>
    <p v-else class="text-sm text-muted">
      Press <strong class="text-highlighted">Simulate rounds</strong> to compare the two arms.
    </p>

    <template #footer>
      <HonestNote variant="exact">
        Both reference values are exact: ½ for a fair coin, 1 − 2<sup>−(k+1)</sup> for a party that
        may force k restarts. The empirical numbers are a finite sample of them, and the “in SEs”
        tiles compare each arm to <em>its own</em> expectation — a large number there would mean the
        simulation is wrong, never that an effect was found.
      </HonestNote>
    </template>
  </DemoSection>
</template>
