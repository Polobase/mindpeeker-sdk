<script setup lang="ts">
/**
 * What the two envelopes on the cumulative-deviation panel mean, and what each
 * level actually buys when you watch the whole path instead of one
 * pre-registered look.
 */
import type { EntropyProvider } from '@mindpeeker/entropy'
import { BAND_LABELS } from '@viz/src/demo/monitor'
import { drbgSource, localBytes, localProvider } from '~/lib/entropy'
import { fmtBytes, fmtDuration, fmtNum } from '~/lib/format'
import {
  ANYTIME_ALPHA,
  type CrossingReport,
  type EnvelopeCurve,
  envelopeAt,
  envelopeCurve,
  simulateCrossings,
} from '~/lib/visualizer/envelopes'
import { currentSeedLabel } from '~/utils/sources'

const HORIZONS = [
  { label: 't ≤ 1 000', value: 1000 },
  { label: 't ≤ 3 000', value: 3000 },
  { label: 't ≤ 10 000', value: 10000 },
]
const PATH_COUNTS = [
  { label: '20 paths', value: 20 },
  { label: '40 paths', value: 40 },
  { label: '100 paths', value: 100 },
]
const STEP_COUNTS = [
  { label: '500 steps', value: 500 },
  { label: '1 000 steps', value: 1000 },
  { label: '3 000 steps', value: 3000 },
]
const TABLE_STEPS = [10, 100, 1000, 3000, 10000]

const SOURCES = [
  { label: 'browser CSPRNG (fast)', value: 'crypto' },
  { label: 'seeded DRBG (reproducible, slower)', value: 'drbg' },
]

const horizon = ref(3000)
const paths = ref(40)
const steps = ref(1000)
const h0Source = ref('crypto')

const rows = computed(() => TABLE_STEPS.map((t) => envelopeAt(t)))
const atThousand = computed(() => envelopeAt(1000))

/**
 * The envelope grid is ~100 ms of χ² inversions, so it runs as a chunked task
 * rather than a computed — a horizon change never blocks the frame.
 */
const curveTask = useTask<EnvelopeCurve>()
const curve = computed(() => curveTask.result.value)

watch(
  horizon,
  (maxT) => {
    void curveTask.run((signal) => envelopeCurve(maxT, 200, signal))
  },
  { immediate: true },
)

const task = useTask<CrossingReport>()
const report = computed(() => task.result.value)
const runMs = ref(0)

async function drawBytes(
  source: EntropyProvider,
  n: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const out = new Uint8Array(n)
  let offset = 0
  while (offset < n) {
    const take = Math.min(16384, n - offset)
    const result = await source.getBytes(take, { signal })
    out.set(result.bytes, offset)
    offset += take
  }
  return out
}

function run(): void {
  void task.run(async (signal, setProgress) => {
    setProgress(0)
    const started = performance.now()
    const seedLabel = `${currentSeedLabel()} / visualizer H0 paths`
    const seeded = h0Source.value === 'drbg'
    const source = seeded ? drbgSource(seedLabel) : undefined
    const crossings = await simulateCrossings({
      paths: paths.value,
      steps: steps.value,
      sourceName: seeded ? `${source?.name} · seed “${seedLabel}”` : localProvider.name,
      signal,
      bytes: (n) =>
        source ? drawBytes(source, n, signal) : localBytes(n, { signal }),
      onProgress: setProgress,
    })
    runMs.value = performance.now() - started
    return crossings
  })
}

const pct = (count: number, total: number): string =>
  total > 0 ? `${fmtNum((100 * count) / total, { digits: 1 })} %` : '—'

const snippet = `import { anytimeP, netvarBoundary, netvarLogM } from '@mindpeeker/negentropy'
import { chi2Isf } from '@mindpeeker/negentropy/numerics'

// shaded: the two-sided 90% pointwise χ² band — bit-identical to
// negentropy's significanceEnvelope(T, 0.95) / (T, 0.05) at step t
const pointwise = [chi2Isf(0.95, t) - t, chi2Isf(0.05, t) - t]

// the line above it: the time-uniform boundary of a Gamma(1, 1) mixture
// test supermartingale over the variance excess (upper side only)
const { upper } = netvarBoundary(t, 0.05, { a: 1, b: 1, sided: 'upper' })

// D(t) ≥ upper  ⇔  M_t ≥ 1/α, so Ville's inequality caps the chance of
// EVER touching it under H0 at α — however often you look, whenever you stop
const p = anytimeP([netvarLogM(t, deviation, { a: 1, b: 1, sided: 'upper' })])`
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      title="Two envelopes, two different promises"
      :api="['chi2Isf', 'significanceEnvelope', 'netvarBoundary', 'netvarLogM', 'anytimeP']"
      description="The cumulative-deviation panel draws D(t) = Σ(Z² − 1) against a shaded band and a
        line. They look alike and mean different things: one is the right yardstick for a single
        pre-registered look at a fixed t, the other keeps its level along the whole path."
    >
      <template #controls>
        <UFormField label="Horizon" size="sm" class="w-44">
          <USelect v-model="horizon" :items="HORIZONS" size="sm" class="w-full" />
        </UFormField>
      </template>

      <LineChart
        v-if="curve"
        :x="curve.t"
        :series="[{ name: BAND_LABELS.anytime, y: curve.anytime, color: 2 }]"
        :bands="[{ lo: curve.lo, hi: curve.hi, label: BAND_LABELS.pointwise, color: 1 }]"
        :hlines="[{ value: 0, label: 'flat in expectation under H₀' }]"
        x-label="trials t"
        y-label="D(t) = Σ(Z² − 1)"
        :height="300"
        aria-label="The pointwise chi-squared band and the anytime-valid boundary as functions of t"
      />
      <div
        v-else
        class="h-[300px] rounded-md border border-default bg-elevated/30 grid place-items-center text-sm text-muted"
        role="status"
        aria-live="polite"
      >
        evaluating chi2Isf and netvarBoundary on the grid…
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-4">
        <StatTile
          label="pointwise upper edge at t = 1000"
          :value="atThousand.pointwiseHi"
          :digits="1"
          size="sm"
          note="chi2Isf(0.05, 1000) − 1000"
        />
        <StatTile
          label="anytime-valid boundary at t = 1000"
          :value="atThousand.anytimeUpper"
          :digits="1"
          size="sm"
          tone="warning"
          note="netvarBoundary(1000, 0.05, { a: 1, b: 1, sided: 'upper' })"
        />
        <StatTile
          label="price of looking whenever you like"
          :value="atThousand.ratio"
          :digits="2"
          size="sm"
          note="× wider at t = 1000 — that is the whole cost"
        />
        <StatTile
          label="lower boundary"
          value="none"
          :mono="false"
          size="sm"
          note="the mixture covers variance excess only — the GCP hypothesis"
        />
      </div>

      <div class="mt-4 overflow-x-auto rounded-md border border-default">
        <table class="w-full text-sm">
          <caption class="sr-only">
            Both envelopes at selected steps
          </caption>
          <thead class="text-muted text-xs uppercase bg-elevated/50">
            <tr>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">t</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">pointwise lower</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">pointwise upper</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">anytime-valid upper</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">ratio</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">√(2t)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.t" class="border-t border-default text-xs font-mono tabular-nums">
              <td class="py-1.5 px-3">{{ fmtNum(row.t, { digits: 0 }) }}</td>
              <td class="py-1.5 px-3 text-right">{{ fmtNum(row.pointwiseLo, { digits: 2 }) }}</td>
              <td class="py-1.5 px-3 text-right">{{ fmtNum(row.pointwiseHi, { digits: 2 }) }}</td>
              <td class="py-1.5 px-3 text-right text-warning">
                {{ fmtNum(row.anytimeUpper, { digits: 2 }) }}
              </td>
              <td class="py-1.5 px-3 text-right">{{ fmtNum(row.ratio, { digits: 2 }) }}×</td>
              <td class="py-1.5 px-3 text-right text-dimmed">
                {{ fmtNum(Math.sqrt(2 * row.t), { digits: 2 }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-4 grid gap-3 lg:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-3 text-sm text-muted">
          <p>
            <strong class="text-highlighted">{{ BAND_LABELS.pointwise }}</strong> — the shaded band,
            <code class="font-mono text-xs">[chi2Isf(0.95, t) − t, chi2Isf(0.05, t) − t]</code>,
            recomputed at every step. It answers one question: <em>at this fixed t</em>, chosen before
            the data, how far out is this value? Under H₀ a path sits inside it 90 % of the time
            <em>at any single step you name in advance</em>. The last column shows why it grows like
            √(2t): Var[D(t)] ≈ 2t.
          </p>
          <p>
            <strong class="text-highlighted">{{ BAND_LABELS.anytime }}</strong> — the line, from a
            Gamma(1, 1) mixture test supermartingale over the variance excess. D(t) at or above it is
            exactly M<sub>t</sub> ≥ 1/α, so by Ville's inequality an H₀ path touches it
            <em>anywhere, ever</em> with probability at most {{ ANYTIME_ALPHA }} — however often you
            look and whenever you decide to stop. It costs about
            {{ fmtNum(atThousand.ratio, { digits: 1 }) }}× the width at t = 1000, and that is the
            entire price of the freedom to watch.
          </p>
        </div>
        <CodeSnippet :code="snippet" title="both envelopes, exactly as the panel computes them" />
      </div>

      <template #footer>
        The panel's shaded band is bit-identical to negentropy's
        <code class="font-mono text-xs">significanceEnvelope</code> because it calls the same
        <code class="font-mono text-xs">chi2Isf</code>; the boundary is negentropy's
        <code class="font-mono text-xs">netvarBoundary</code>, O(1) per step. The visualizer adds no
        statistics of its own — it draws what negentropy computes.
      </template>
    </DemoSection>

    <DemoSection
      title="What each level buys, checked on H₀ paths"
      :api="['chi2Isf', 'netvarBoundary', 'drbgProvider', 'POPCOUNT']"
      description="Simulate independent H₀ paths — every step an exact Binomial(200, ½) trial from a
        seeded DRBG — and count how many touch each boundary at any point along the way. This is the
        difference between a level held at one step and a level held along a path."
    >
      <template #controls>
        <UFormField label="Paths" size="sm" class="w-36">
          <USelect v-model="paths" :items="PATH_COUNTS" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Steps per path" size="sm" class="w-40">
          <USelect v-model="steps" :items="STEP_COUNTS" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="H₀ bits from" size="sm" class="w-64">
          <USelect v-model="h0Source" :items="SOURCES" size="sm" class="w-full" />
        </UFormField>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          label="Run the H₀ check"
          busy-label="Walking paths…"
          :hint="`≈ ${fmtBytes(paths * steps * 25)}, no network — the seeded DRBG is reproducible but generates in JS, so it is several seconds at the large settings`"
          @run="run"
          @cancel="task.cancel()"
        />
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div v-if="report" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="left the pointwise band"
          :value="pct(report.pointwise, report.paths)"
          :mono="false"
          tone="warning"
          :note="`${report.pointwise} of ${report.paths} H₀ paths, somewhere in ${fmtNum(report.steps, { digits: 0 })} steps`"
        />
        <StatTile
          label="crossed its upper edge"
          :value="pct(report.pointwiseUpper, report.paths)"
          :mono="false"
          tone="warning"
          note="the one-sided comparison, against the 5 % a fixed look would suggest"
        />
        <StatTile
          label="touched the anytime-valid boundary"
          :value="pct(report.anytime, report.paths)"
          :mono="false"
          tone="success"
          :note="`Ville's inequality caps this at ${fmtNum(ANYTIME_ALPHA * 100, { digits: 0 })} % for any horizon`"
        />
        <StatTile
          label="entropy consumed"
          :value="fmtBytes(report.bytesUsed)"
          :mono="false"
          size="md"
          :note="`${fmtNum(report.paths * report.steps, { digits: 0 })} trials × ${report.bitsPerStep} bits`"
        />
      </div>

      <p v-if="report" class="mt-3 text-sm text-muted">
        {{ fmtNum(report.paths * report.steps, { digits: 0 }) }} trials from
        <code class="font-mono text-xs">{{ report.sourceName }}</code> in
        {{ fmtDuration(runMs) }}. A seeded run gives the same counts on every machine; a CSPRNG run
        does not, which is exactly what makes it a fresh sample. With
        {{ fmtNum(report.paths, { digits: 0 }) }} paths the sampling error on these percentages is
        roughly ±{{ fmtNum((100 * Math.sqrt(0.25 / report.paths)), { digits: 0 }) }} points, so read
        them as orders of magnitude, not as estimates. negentropy's own seeded study puts the
        pointwise upper crossing near 46 % over 3 000 steps and every time-uniform boundary at
        0.9–3.2 %.
      </p>

      <HonestNote variant="caveat" class="mt-4">
        A pointwise band that a path leaves half the time is not broken — it is answering a different
        question than the one a live chart tempts you to ask. Watching a curve and stopping when it
        looks significant is optional stopping: by the law of the iterated logarithm, a fixed-n test
        repeated at every n eventually rejects with probability one. The time-uniform boundary is
        what makes continuous watching legitimate, and it is wider for exactly that reason.
      </HonestNote>

      <HonestNote variant="contested" class="mt-3">
        This dashboard shows six windows at once and never stops. Watching them is exploration, not a
        test. A claim needs the hypothesis, the statistic, the stopping rule and the level fixed
        <em>before</em> the data — a registration (negentropy's
        <code class="font-mono text-xs">registerExperiment</code>, psi's tripolar plans) or an
        anytime-valid boundary chosen in advance. Nothing you notice on a live panel becomes evidence
        by having been noticed; that a deviation reflects intention, attention or any other
        mind–matter hypothesis is a contested claim these bands cannot settle either way.
      </HonestNote>

      <template #footer>
        The simulation evaluates both envelopes once per step and shares them across paths — they
        depend only on t, not on the data. Long loops yield to the event loop every 8 ms, so the page
        stays responsive and Cancel takes effect immediately.
      </template>
    </DemoSection>
  </div>
</template>
