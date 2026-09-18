<script setup lang="ts">
/**
 * §1b — `windowedNegentropy`: the rolling "when did order appear?" view.
 * The stream's emissions are exactly the batch estimator on the same slice,
 * which the panel checks rather than claims.
 */
import {
  negentropyExp,
  negentropyKurtosis,
  negentropyLogcosh,
  negentropyVasicek,
  probitBytes,
  type WindowedEstimator,
  windowedNegentropy,
} from '@mindpeeker/negentropy'
import { nextMacrotask } from '~/lib/async'
import { getBytes } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'

const TOTALS = [
  { label: '2 000 samples', value: 2000 },
  { label: '3 000 samples', value: 3000 },
  { label: '6 000 samples', value: 6000 },
]
const WINDOWS = [128, 256, 512].map((n) => ({ label: `${n} samples`, value: n }))
const HOPS = [32, 64, 128].map((n) => ({ label: `${n} samples`, value: n }))
const ESTIMATORS = [
  { label: 'logcosh (robust default)', value: 'logcosh' },
  { label: 'exp (peaked shapes)', value: 'exp' },
  { label: 'kurtosis (moment)', value: 'kurtosis' },
  { label: 'vasicek (m-spacings)', value: 'vasicek' },
]

const total = ref(3000)
const windowSize = ref(256)
const hopSize = ref(64)
const estimator = ref<WindowedEstimator>('logcosh')
const exponent = ref(0.6)
const eventStart = ref(1200)
const eventLength = ref(600)

interface Result {
  x: Float64Array
  j: Float64Array
  eventFrom: number
  eventTo: number
  baseline: number
  inside: number
  check: { stream: number; batch: number; equal: boolean; startSample: number }
  emissions: number
}

const task = useTask<Result>()
const result = computed(() => task.result.value)

function batchEstimate(window: Float64Array, which: WindowedEstimator): number {
  if (which === 'kurtosis') return negentropyKurtosis(window).j
  if (which === 'exp') return negentropyExp(window).j
  if (which === 'vasicek') return negentropyVasicek(window)
  return negentropyLogcosh(window).j
}

function run(): void {
  void task.run(async (signal, setProgress) => {
    const samples = total.value
    const from = Math.min(eventStart.value, samples - 1)
    const to = Math.min(from + eventLength.value, samples)
    const power = exponent.value
    setProgress(0)

    const bytes = await getBytes(samples, { signal })
    // One dither label per chunk: probitBytes restarts its dither stream on
    // every call, so re-using one label would repeat the same noise per chunk.
    const values = new Float64Array(samples)
    const CHUNK = 250
    for (let offset = 0, chunk = 0; offset < samples; offset += CHUNK, chunk++) {
      const slice = bytes.subarray(offset, Math.min(offset + CHUNK, samples))
      const probit = probitBytes(slice, { source: `windowed/chunk-${chunk}` })
      for (let i = 0; i < probit.length; i++) {
        const raw = probit[i] as number
        const index = offset + i
        // Inside the event window the samples are reshaped by x ↦ sign(x)·|x|^p:
        // p < 1 flattens them (sub-Gaussian), p > 1 makes them heavy-tailed.
        values[index] =
          index >= from && index < to ? Math.sign(raw) * Math.abs(raw) ** power : raw
      }
    }

    async function* feed(): AsyncGenerator<number> {
      for (let i = 0; i < samples; i++) {
        if ((i & 255) === 0) await nextMacrotask()
        yield values[i] as number
      }
    }

    const expected = Math.max(1, Math.floor((samples - windowSize.value) / hopSize.value) + 1)
    const starts: number[] = []
    const js: number[] = []
    for await (const point of windowedNegentropy(feed(), {
      windowSize: windowSize.value,
      hopSize: hopSize.value,
      estimator: estimator.value,
      signal,
    })) {
      starts.push(point.startSample)
      js.push(point.j)
      setProgress(Math.min(1, js.length / expected))
    }

    let baselineSum = 0
    let baselineCount = 0
    let insideSum = 0
    let insideCount = 0
    for (let i = 0; i < js.length; i++) {
      const start = starts[i] as number
      const end = start + windowSize.value
      const value = js[i] as number
      if (!Number.isFinite(value)) continue
      if (end <= from || start >= to) {
        baselineSum += value
        baselineCount++
      } else if (start >= from && end <= to) {
        insideSum += value
        insideCount++
      }
    }

    // The documented invariant: a stream emission equals the batch estimator on
    // exactly that slice. Checked on the last emission.
    const lastIndex = js.length - 1
    const startSample = (starts[lastIndex] ?? 0) as number
    const slice = values.subarray(startSample, startSample + windowSize.value)
    const batch = batchEstimate(slice, estimator.value)
    const stream = (js[lastIndex] ?? Number.NaN) as number

    return {
      x: Float64Array.from(starts),
      j: Float64Array.from(js),
      eventFrom: from,
      eventTo: to,
      baseline: baselineCount > 0 ? baselineSum / baselineCount : Number.NaN,
      inside: insideCount > 0 ? insideSum / insideCount : Number.NaN,
      check: { stream, batch, equal: Object.is(stream, batch), startSample },
      emissions: js.length,
    }
  })
}

const snippet = computed(
  () => `import { probitBytes, windowedNegentropy } from '@mindpeeker/negentropy'

// a lazy, pull-based sample stream (bytes → exactly N(0,1) under H0)
async function* samples() { for (const x of probitBytes(bytes, { source: 'egg-1' })) yield x }

for await (const point of windowedNegentropy(samples(), {
  windowSize: ${windowSize.value},
  hopSize: ${hopSize.value},
  estimator: '${estimator.value}',
  signal,                       // a blocked input cannot delay the abort
})) {
  console.log(point.index, point.startSample, point.j)
}`,
)
</script>

<template>
  <DemoSection
    id="windowed"
    title="When did the order appear?"
    description="A rolling negentropy over a lazy sample stream. Every emission recomputes the batch estimator on the current window, so the streamed values are exactly the batch values — and the structure is injected in one stretch of the stream, which the curve has to find."
    :api="['windowedNegentropy', 'probitBytes', 'negentropyLogcosh', 'negentropyVasicek']"
  >
    <template #controls>
      <UFormField label="Stream" size="sm" class="w-44">
        <USelect v-model="total" :items="TOTALS" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Window" size="sm" class="w-36">
        <USelect v-model="windowSize" :items="WINDOWS" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Hop" size="sm" class="w-36">
        <USelect v-model="hopSize" :items="HOPS" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Estimator" size="sm" class="w-52">
        <USelect v-model="estimator" :items="ESTIMATORS" size="sm" class="w-full" />
      </UFormField>
      <UFormField
        :label="`Event shape exponent p = ${exponent.toFixed(2)}`"
        size="sm"
        class="w-52"
      >
        <USlider
          v-model="exponent"
          :min="0.4"
          :max="2"
          :step="0.05"
          aria-label="Event shape exponent"
        />
      </UFormField>
      <UFormField label="Event start (sample)" size="sm" class="w-36">
        <UInputNumber
          v-model="eventStart"
          :min="0"
          :max="total - 100"
          :step="100"
          size="sm"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Event length" size="sm" class="w-36">
        <UInputNumber
          v-model="eventLength"
          :min="100"
          :max="total"
          :step="100"
          size="sm"
          class="w-full"
        />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Stream it"
        icon="i-lucide-waves"
        :hint="`${fmtBytes(total)} from the selected source · event on samples ${eventStart}–${eventStart + eventLength}`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div v-if="result" class="flex flex-col gap-4">
      <LineChart
        :series="[{ name: `J (${estimator})`, y: result.j, x: result.x }]"
        :vlines="[
          { value: result.eventFrom, label: 'event start' },
          { value: result.eventTo, label: 'event end' },
        ]"
        :hlines="[{ value: result.baseline, label: 'baseline mean J', color: 2 }]"
        x-label="first sample of the window"
        y-label="negentropy J"
        :height="260"
        aria-label="Rolling negentropy by window start sample, with the injected event marked"
      />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Emissions" :value="result.emissions" :digits="0" note="windows scored" />
        <StatTile
          label="Baseline mean J"
          :value="result.baseline"
          :digits="5"
          note="windows entirely outside the event"
        />
        <StatTile
          label="Event mean J"
          :value="result.inside"
          :digits="5"
          :tone="result.inside > result.baseline ? 'warning' : 'neutral'"
          note="windows entirely inside the event"
        />
        <StatTile
          label="Stream = batch"
          :value="result.check.equal ? 'exact' : 'differs'"
          :tone="result.check.equal ? 'success' : 'error'"
          :note="`emission at sample ${result.check.startSample}: ${fmtNum(result.check.stream, { digits: 6 })} vs ${fmtNum(result.check.batch, { digits: 6 })}`"
        />
      </div>

      <CodeSnippet :code="snippet" title="what “Stream it” ran" />
    </div>
    <p v-else class="text-sm text-muted">
      Press “Stream it”. With p = 1.00 the event window is untouched and the curve stays flat —
      that is what “no order” looks like.
    </p>

    <template #footer>
      <HonestNote variant="caveat">
        The injected event is a deliberate reshaping of the samples, not a discovery: p ≠ 1 bends
        the probit values into a non-Gaussian shape inside one stretch of the stream. A rise in J
        there shows that the estimator can see a shape change of that size — it is a sensitivity
        demonstration, not evidence about any real stream.
      </HonestNote>
    </template>
  </DemoSection>
</template>
