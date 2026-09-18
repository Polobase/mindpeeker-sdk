<script setup lang="ts">
/**
 * The information-flow page. Sections 1–3 and 5 share one draw — the
 * "coupled processes lab" — so the significance test, the lag scan and the
 * local-TE chart all describe the same two series; sections 4, 6 and 7 draw
 * their own data.
 */
import { provider, restartSource, sourceSummary } from '~/lib/entropy'
import { bytesForBits, coupledPair } from '~/lib/flow/series'
import { num } from '~/lib/flow/types'
import type { LabParams, LabSeries } from '~/lib/flow/types'
import { closeFlowWorkers } from '~/lib/flow/worker-client'

const params = reactive<LabParams>({
  n: 4000,
  lag: 2,
  coupling: 60,
  noise: 5,
  driver: 0,
  k: 1,
  l: 1,
  millerMadow: false,
})

const series = shallowRef<LabSeries | undefined>()
const task = useTask<LabSeries>()
const summary = sourceSummary()

async function draw(): Promise<void> {
  const result = await task.run(async (signal, setProgress) => {
    setProgress(null)
    // A deterministic source rewinds first, so the same seed really does give
    // the same pair on every run.
    restartSource()
    const snapshot: LabParams = {
      n: num(params.n, 4000),
      lag: num(params.lag, 1),
      coupling: num(params.coupling, 0),
      noise: num(params.noise, 0),
      driver: num(params.driver, 0),
      k: num(params.k, 1),
      l: num(params.l, 1),
      millerMadow: params.millerMadow === true,
    }
    const bytes = bytesForBits(snapshot.n)
    const started = performance.now()
    const draw = await provider.getBytes(bytes, { signal })
    const built = coupledPair(draw.bytes, snapshot)
    return {
      x: built.x,
      y: built.y,
      z: built.z,
      params: snapshot,
      draw: {
        providerName: provider.name,
        sourceId: summary.id,
        sourceLabel: summary.label,
        bytes,
        sourceBits: built.sourceBits,
        seed: built.seed,
        deterministic: summary.deterministic,
        elapsedMs: performance.now() - started,
      },
    } satisfies LabSeries
  })
  if (result) series.value = result
}

onMounted(() => {
  // A beacon would have to serve hundreds of bytes before anything appears:
  // network sources wait for a click, local ones start straight away.
  if (!summary.network) void draw()
})

onUnmounted(() => closeFlowWorkers())
</script>

<template>
  <div class="flex flex-col gap-6">
    <HonestNote variant="caveat" title="What these numbers are, and are not">
      Every series on this page is a construction with a known answer: Y is built to copy X, or a
      hidden driver Z is built to feed both. That makes the estimator auditable — you can see it
      recover a planted lag, and see it report flow where there is none. Transfer entropy measures
      predictive information transfer under the embedding you choose; it is
      <strong class="text-highlighted">not</strong> causality, and it is blind to coupling inside one
      sample, because it only looks at lags ≥ 1.
    </HonestNote>

    <FlowCoupled :params="params" :series="series" :task="task" @draw="draw" />
    <FlowSignificance :series="series" />
    <FlowLagScan :series="series" />
    <FlowConfounding />
    <FlowStorage :series="series" />
    <FlowOrdinal />
    <FlowStreaming />
  </div>
</template>
