<script setup lang="ts">
/** Section 4 — a hidden driver looks exactly like a cause until you condition on it. */
import { collectiveTransferEntropy, conditionalTransferEntropy, transferEntropy } from '@mindpeeker/flow'
import { provider, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { bytesForBits, coupledPair, DRIVER_LAG_X, DRIVER_LAG_Y } from '~/lib/flow/series'
import { biasFloor, degreesOfFreedom, tupleCount } from '~/lib/flow/theory'
import { num } from '~/lib/flow/types'
import type { LabParams } from '~/lib/flow/types'

const SIZES = [2000, 4000, 8000].map((n) => ({ label: `${fmtNum(n, { digits: 0 })} symbols`, value: n }))
const CONDS = [1, 2, 3].map((v) => ({ label: String(v), value: v }))

const n = ref(4000)
const driver = ref(85)
const condLag = ref(DRIVER_LAG_Y)
const condK = ref(1)

interface Triple {
  x: Uint8Array
  y: Uint8Array
  z: Uint8Array
  n: number
  driver: number
  bytes: number
  providerName: string
}

const task = useTask<Triple>()
const data = computed(() => task.result.value)
const summary = sourceSummary()

function run(): void {
  void task.run(async (signal, setProgress) => {
    setProgress(null)
    restartSource()
    const params: LabParams = {
      n: num(n.value, 4000),
      lag: 1,
      coupling: 0,
      noise: 0,
      driver: num(driver.value, 0),
      k: 1,
      l: 1,
      millerMadow: false,
    }
    const bytes = bytesForBits(params.n)
    const drawn = await provider.getBytes(bytes, { signal })
    const built = coupledPair(drawn.bytes, params)
    return {
      x: built.x,
      y: built.y,
      z: built.z,
      n: params.n,
      driver: driver.value,
      bytes,
      providerName: provider.name,
    }
  })
}

const stats = computed(() => {
  const d = data.value
  if (!d) return undefined
  const base = { k: 1, l: 1, lag: 1, alphabet: 2 }
  const spurious = transferEntropy(d.x, d.y, base)
  const conditioned = conditionalTransferEntropy(d.x, d.y, [d.z], {
    ...base,
    condK: num(condK.value, 1),
    condLag: num(condLag.value, 1),
  })
  const tuples = tupleCount(d.n, 1, 1, 1)
  const floor = biasFloor(degreesOfFreedom(2, 2, 1, 1), tuples)
  return {
    spurious,
    conditioned,
    backward: transferEntropy(d.y, d.x, base),
    driverToY: transferEntropy(d.z, d.y, { ...base, lag: DRIVER_LAG_Y }),
    driverToX: transferEntropy(d.z, d.x, { ...base, lag: DRIVER_LAG_X }),
    collective: collectiveTransferEntropy([d.x, d.z], d.y, base),
    floor,
    tuples,
    removed: conditioned < 10 * floor,
    fraction: spurious > 0 ? conditioned / spurious : Number.NaN,
  }
})

const snippet = computed(
  () => `import { collectiveTransferEntropy, conditionalTransferEntropy, transferEntropy } from '@mindpeeker/flow'

// Z enters X at lag ${DRIVER_LAG_X} and Y at lag ${DRIVER_LAG_Y}: x[t] carries z[t−1], and so does y[t+1].
const spurious = transferEntropy(x, y, { k: 1, l: 1, lag: 1, alphabet: 2 })

// condK symbols ending at w[t − condLag + 1] (PyInform's convention):
// the common cause of y[t+1] is z[t−1], i.e. condLag ${DRIVER_LAG_Y}, condK 1.
const conditioned = conditionalTransferEntropy(x, y, [z], {
  k: 1, l: 1, lag: 1, alphabet: 2, condK: ${condK.value}, condLag: ${condLag.value},
})

// How much the two sources together bring, synergy included:
const collective = collectiveTransferEntropy([x, z], y, { k: 1, l: 1, lag: 1, alphabet: 2 })`,
)
</script>

<template>
  <DemoSection
    id="confounding"
    title="4 · Confounding"
    :api="['conditionalTransferEntropy', 'collectiveTransferEntropy', 'transferEntropy']"
  >
    <template #description>
      Here nothing flows from X to Y. A hidden bit stream Z feeds X at lag {{ DRIVER_LAG_X }} and Y at
      lag {{ DRIVER_LAG_Y }}, so X's current symbol carries exactly the bit Y is about to copy. The
      unconditioned transfer entropy is large and wrong.
      <code>conditionalTransferEntropy</code> removes the flow explained by the third stream — but
      only if you condition at the lag through which it actually enters.
    </template>

    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Draw a confounded triple"
        busy-label="Drawing…"
        icon="i-lucide-git-fork"
        :hint="`${fmtBytes(bytesForBits(num(n, 0)))} from ${summary.label}`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="Samples" size="sm">
        <USelect v-model="n" :items="SIZES" class="w-full" />
      </UFormField>
      <UFormField label="Driver strength" :hint="`${driver}%`" size="sm">
        <USlider v-model="driver" :min="0" :max="100" :step="5" class="mt-2" />
      </UFormField>
      <UFormField label="condLag" size="sm" description="condition ends at wₜ₋condLag₊₁">
        <USelect v-model="condLag" :items="CONDS" class="w-full" />
      </UFormField>
      <UFormField label="condK" size="sm" description="symbols of Z conditioned on">
        <USelect v-model="condK" :items="CONDS.slice(0, 2)" class="w-full" />
      </UFormField>
    </div>

    <div v-if="stats && data" class="mt-4 flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="TE X→Y (unconditioned)"
          :value="stats.spurious"
          :digits="4"
          tone="error"
          note="entirely spurious — nothing flows from X to Y"
        />
        <StatTile
          label="TE X→Y | Z"
          :value="stats.conditioned"
          :digits="5"
          :tone="stats.removed ? 'success' : 'warning'"
          :note="
            stats.removed
              ? 'back to the bias floor: the flow was Z all along'
              : 'still large — this conditioning misses the lag Z enters through'
          "
        />
        <StatTile
          label="bias floor df/(2N ln2)"
          :value="stats.floor"
          :digits="5"
          note="what an honest zero looks like here"
        />
        <StatTile label="TE Z→Y (lag 2)" :value="stats.driverToY" :digits="4" note="the real flow" />
        <StatTile label="TE Z→X (lag 1)" :value="stats.driverToX" :digits="4" note="the other real flow" />
        <StatTile
          label="collective TE [X,Z]→Y"
          :value="stats.collective"
          :digits="4"
          note="both sources at lag 1 — Z's own flow arrives a step later, so joining it here adds nothing"
        />
      </div>

      <BarChart
        :categories="[
          'TE X→Y (lag 1)',
          'TE X→Y | Z',
          'TE Z→Y (lag 2)',
          'TE Y→X (lag 1)',
          'collective [X,Z]→Y (lag 1)',
        ]"
        :values="[stats.spurious, stats.conditioned, stats.driverToY, stats.backward, stats.collective]"
        :expected="stats.floor"
        expected-label="bias floor"
        :highlight="[1]"
        y-label="transfer entropy (bits)"
        :height="240"
        aria-label="Transfer entropy before and after conditioning on the common driver"
        :format="(v: number) => fmtNum(v, { digits: 5 })"
      />

      <UAlert
        :color="stats.removed ? 'success' : 'warning'"
        variant="subtle"
        :icon="stats.removed ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
        :title="
          stats.removed
            ? `Conditioning removed ${fmtNum((1 - stats.fraction) * 100, { digits: 1 })}% of the apparent flow`
            : `Conditioning left ${fmtNum(stats.fraction * 100, { digits: 1 })}% of the apparent flow in place`
        "
        :description="`Z reaches Y through z[t−1]. That symbol is inside the condition when condLag = ${DRIVER_LAG_Y} with condK = 1, or condLag = 1 with condK = 2 — try condLag = 1, condK = 1 and the spurious flow comes straight back, because the condition is then z[t], the wrong bit.`"
      />

      <AccountingBadge :bytes-consumed="data.bytes" :bits-used="data.n" :source="data.providerName" />

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <p v-else-if="!task.busy.value" class="mt-4 text-sm text-muted">
      Draw a triple to see a confound priced as flow.
    </p>

    <template #footer>
      This is the honest limit of the measure: conditioning only removes what you can observe, at the
      lag you guess right. An unobserved driver leaves a transfer entropy that is large, significant
      against every surrogate null, and still not a cause.
    </template>
  </DemoSection>
</template>
