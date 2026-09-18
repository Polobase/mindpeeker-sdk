<script setup lang="ts">
/**
 * The numbers behind the two trial panels, read out of the same
 * `NetvarMonitor` that produced their frames — exact functions of the Stouffer
 * Z series, computed in O(1) per step.
 */
import { ANYTIME_ALPHA } from '@viz/src/demo/monitor'
import type { DriverSnapshot } from '~/lib/visualizer/driver'
import { BITS_PER_TRIAL } from '~/lib/visualizer/driver'
import { fmtNum } from '~/lib/format'

const props = defineProps<{ snapshot?: DriverSnapshot }>()

const point = computed(() => props.snapshot?.point)

/** Exact per-step variance of Z² − 1 for a Stouffer Z over n fair bits. */
const stepVariance = computed(() => 2 - 2 / BITS_PER_TRIAL)

const aboveBand = computed(() => {
  const p = point.value
  return p !== undefined && p.deviation > p.pointwise[1]
})
const belowBand = computed(() => {
  const p = point.value
  return p !== undefined && p.deviation < p.pointwise[0]
})
const aboveBoundary = computed(() => {
  const p = point.value
  return p !== undefined && p.deviation >= p.anytime.upper
})

const deviationTone = computed(() =>
  aboveBoundary.value ? 'error' : aboveBand.value || belowBand.value ? 'warning' : 'neutral',
)

const pointwiseText = computed(() => {
  const p = point.value
  if (!p) return '—'
  return `${fmtNum(p.pointwise[0], { digits: 1 })} … ${fmtNum(p.pointwise[1], { digits: 1 })}`
})

const snippet = `import { parseRecordLine, recordSession } from '@mindpeeker/psi'
import { decodeFrame, encodeSeriesFrame } from '@mindpeeker/visualizer'
import {
  anytimeNote, cumdevSample, NetvarMonitor, netvarSample,
} from '@mindpeeker/visualizer/src/demo/monitor'

const monitor = new NetvarMonitor(200)              // fair bits behind each Stouffer Z

for await (const line of recordSession([source], {
  bitsPerTrial: 200, chunkBytes: 25, chain: true,   // psi JSONL v2, hash-chained
})) {
  const record = parseRecordLine(line)
  if (record.v !== 2 || 'kind' in record) continue   // the session header
  const z = (record.sum - 100) / Math.sqrt(50)       // Binomial(200, ½) under H0
  const point = monitor.add(z)                       // D(t), both envelopes, ln M, anytime p

  dash.pushFrame(decodeFrame(encodeSeriesFrame(2, [cumdevSample(point)])))  // kind 4: two bands
  dash.pushFrame(decodeFrame(encodeSeriesFrame(3, [netvarSample(point)])))  // kind 4: one band
  netvarChannel.note = anytimeNote(point)            // 'anytime p = 0.41'
}`
</script>

<template>
  <DemoSection
    title="The statistics behind the two trial panels"
    :api="['NetvarMonitor', 'cumdevSample', 'netvarSample', 'anytimeNote', 'chi2Isf', 'netvarBoundary', 'netvarLogM', 'anytimeP']"
    description="Every 200 bits the source delivers become one trial, Binomial(200, ½) under H₀, so
      z = (S − 100)/√50. The monitor accumulates D(t) = Σ(Z² − 1) with the same Neumaier-compensated
      sum negentropy's batch cumulativeDeviation uses, and evaluates both envelopes, the test
      martingale and the anytime-valid p at each step."
  >
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="trials t"
        :value="point?.t ?? 0"
        :digits="0"
        note="every trial the feed delivers is plotted"
      />
      <StatTile
        label="this step's Stouffer Z"
        :value="point?.z"
        :digits="3"
        note="one source ⇒ the round's Z is its own z"
      />
      <StatTile
        label="D(t) = Σ(Z² − 1)"
        :value="point?.deviation"
        :digits="2"
        :tone="deviationTone"
        :note="
          aboveBoundary
            ? 'at or above the anytime-valid boundary'
            : aboveBand
              ? 'outside the pointwise band (upper)'
              : belowBand
                ? 'outside the pointwise band (lower)'
                : 'inside both envelopes'
        "
      />
      <StatTile label="Var[D(t)] ≈ 2t" :value="point ? 2 * point.t : undefined" :digits="0" note="flat in expectation under H₀" />

      <StatTile label="two-sided 90% pointwise band">
        <template #value>
          <span class="font-mono tabular-nums text-lg">{{ pointwiseText }}</span>
        </template>
        <template #note>chi2Isf(0.95, t) − t … chi2Isf(0.05, t) − t</template>
      </StatTile>
      <StatTile
        label="anytime-valid boundary (α = 0.05)"
        :value="point?.anytime.upper"
        :digits="1"
        tone="warning"
        note="netvarBoundary(t, 0.05, { a: 1, b: 1, sided: 'upper' }) — one-sided, no lower edge"
      />
      <StatTile
        label="netvar Z = D / √(v·t)"
        :value="point?.netvarZ"
        :digits="3"
        :note="`v = 2 − 2/${BITS_PER_TRIAL} = ${fmtNum(stepVariance, { digits: 3 })}, so mean 0 and variance 1 under H₀ exactly`"
      />
      <StatTile label="anytime-valid p">
        <template #value>
          <PValue :p="point?.anytimeP" kind="anytime" label="p" :alpha="ANYTIME_ALPHA" />
        </template>
        <template #note>
          min(1, 1/max M) over the ln M path — non-increasing, valid however often you look
        </template>
      </StatTile>
    </div>

    <div class="mt-4 grid gap-3 lg:grid-cols-2">
      <div class="flex min-w-0 flex-col gap-3">
        <StatTile
          label="ln M (Gamma(1,1) test martingale)"
          :value="point?.logM"
          :digits="3"
          size="sm"
          note="D ≥ boundary ⇔ M ≥ 1/α; by Ville's inequality that happens under H₀ with probability ≤ α, ever"
        />
        <StatTile
          label="trial lines written"
          :value="snapshot?.totalLines"
          :digits="0"
          size="sm"
          note="one hash-chained psi JSONL v2 line per trial, plus the session header"
        />
      </div>
      <CodeSnippet :code="snippet" title="what produced these numbers" />
    </div>

    <HonestNote variant="exact" class="mt-4">
      D(t), both envelopes, ln M and the anytime p are exact, deterministic functions of the Z
      series: the same bytes always give the same curve, live or replayed from the recording. They
      say how unusual a path is <em>under H₀</em> — independent fair bits. They say nothing about why
      a path looks the way it does.
    </HonestNote>

    <HonestNote variant="caveat" class="mt-3">
      A crossing here is not a finding. In descending order of prior probability, a deviation means:
      hardware bias or drift, environmental coupling, analysis flexibility, ordinary sampling
      fluctuation under multiplicity — and only then anything exotic. A clean pass implies nothing
      about physical unpredictability either.
    </HonestNote>

    <template #footer>
      The panel captions show the latest point and, on a second line, the channel's note — which is
      where the CLI puts <code class="font-mono">anytime p = …</code>. The server coalesces note
      updates to at most one per 100 ms; this page rewrites it at most every 250 ms.
    </template>
  </DemoSection>
</template>
