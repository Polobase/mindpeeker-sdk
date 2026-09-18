<script setup lang="ts">
/**
 * Section 5 — what T means in seconds, on this machine and against someone
 * else's. `calibrate` measures through the same code path `evaluate` uses and
 * reports the median of several windows; `suggestT` turns a wall-clock target
 * into a T, with an explicit margin for faster hardware.
 */
import { fmtDuration, fmtNum } from '~/lib/format'
import type { CalibrateResult, ModulusId } from '~/lib/vdf/jobs'
import { MODULUS_META } from '~/lib/vdf/jobs'
import { runVdfJob } from '~/lib/vdf/worker-client'

const sampleMs = ref(200)
const samples = ref(5)
const modulusId = ref<ModulusId>('rsa2048')
const phase = ref<string>()

const task = useTask<CalibrateResult>()

const WALL_MS = [1000, 10_000, 60_000, 3_600_000]
const SPEEDUPS = [1, 10, 1000]

const SAMPLE_MS_ITEMS = [
  { label: '100 ms — quick and noisy', value: 100 },
  { label: '200 ms — the package default', value: 200 },
  { label: '500 ms', value: 500 },
  { label: '1000 ms — steadiest', value: 1000 },
]
const SAMPLES_ITEMS = [
  { label: '3 windows', value: 3 },
  { label: '5 windows — the default', value: 5 },
  { label: '9 windows', value: 9 },
]
const MODULUS_ITEMS = Object.values(MODULUS_META).map((m) => ({ label: m.label, value: m.id }))

/** The README's reference rates, for choosing an adversarySpeedup. */
const HARDWARE = [
  {
    what: 'this package (Bun, Apple Silicon dev machine, unloaded)',
    modulus: '2048-bit',
    rate: '≈ 5 × 10⁴ /s',
    source: 'bun scripts/bench.ts',
  },
  {
    what: 'optimized CPU implementations',
    modulus: '2048-bit',
    rate: '0.48 – 0.85 × 10⁶ /s',
    source: 'arXiv 2308.01280',
  },
  {
    what: 'FPGA (VDF Alliance competition, round 1)',
    modulus: '1024-bit',
    rate: '≈ 4 × 10⁷ /s (25.2 ns per squaring)',
    source: 'Jane Street · supranational/vdf-fpga-round1-results',
  },
]

const result = computed(() => task.result.value)

const grid = computed(() => {
  const r = result.value
  if (!r) return undefined
  return WALL_MS.map((wallMs) => ({
    wallMs,
    cells: SPEEDUPS.map((speedup) => r.rows.find((row) => row.wallMs === wallMs && row.speedup === speedup)),
  }))
})

const relativeToReference = computed(() => {
  const r = result.value
  if (!r || modulusId.value !== 'rsa2048') return undefined
  return r.squaringsPerSecond / 5e4
})

const code = computed(
  () => `import { calibrate } from '@mindpeeker/vdf'

const cal = await calibrate(${sampleMs.value}, { samples: ${samples.value} })
cal.squaringsPerSecond                          // median of ${samples.value} timing windows
cal.samples                                     // every window, in measurement order

cal.suggestT(60_000)                            // 60 s on THIS machine
cal.suggestT(60_000, { adversarySpeedup: 1000 })// ≥ 60 s even for FPGA-class hardware`,
)

async function run(): Promise<void> {
  await task.run(async (signal, setProgress) => {
    setProgress(null)
    return await runVdfJob(
      'calibrate',
      {
        sampleMs: sampleMs.value,
        samples: samples.value,
        modulusId: modulusId.value,
        wallMs: WALL_MS,
        speedups: SPEEDUPS,
      },
      {
        signal,
        onProgress: (label, fraction) => {
          phase.value = label
          setProgress(fraction)
        },
      },
    )
  })
  phase.value = undefined
}
</script>

<template>
  <DemoSection
    id="calibration"
    title="Calibration — T is a deployment parameter"
    description="T is not a duration. It becomes one only through a squaring rate, and the rate that matters belongs to the fastest hardware anyone owns, not to this browser."
    :api="['calibrate', 'suggestT', 'MAX_T']"
  >
    <template #controls>
      <UFormField label="Measurement budget" size="sm" class="w-full sm:w-64">
        <USelect v-model="sampleMs" :items="SAMPLE_MS_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Timing windows" size="sm" class="w-full sm:w-48">
        <USelect v-model="samples" :items="SAMPLES_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Modulus" size="sm" class="w-full sm:w-64">
        <USelect v-model="modulusId" :items="MODULUS_ITEMS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Measure this machine"
        busy-label="Timing…"
        icon="i-lucide-gauge"
        :hint="task.busy.value ? phase : `${sampleMs} ms of squaring in the worker, split into ${samples} windows`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div v-if="!result" class="rounded-md border border-dashed border-default px-3 py-6 text-center text-sm text-muted">
        Not measured yet. Nothing on this page may be read as a wall-clock guarantee until it is —
        and not even then, for anyone else's hardware.
      </div>

      <template v-else>
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="median squarings / s"
            :value="result.squaringsPerSecond"
            :digits="0"
            tone="primary"
            :note="`${MODULUS_META[result.modulusId].short}, in a Web Worker on this machine`"
          />
          <StatTile
            label="window spread"
            :value="`${fmtNum(result.spread * 100, { digits: 1 })} %`"
            :tone="result.spread > 0.25 ? 'warning' : 'neutral'"
            note="max − min over the median; the median is what resists a noisy window"
          />
          <StatTile
            label="1 s of local delay"
            :value="fmtNum(result.rows.find((r) => r.wallMs === 1000 && r.speedup === 1)?.T ?? 0, { digits: 0 })"
            note="T for one second on THIS machine — never ship this number"
          />
          <StatTile
            label="vs the README's reference"
            :value="relativeToReference ? `${fmtNum(relativeToReference, { digits: 2 })}×` : '—'"
            note="the package's dev machine does ≈ 5 × 10⁴ 2048-bit squarings/s"
          />
        </div>

        <BarChart
          :categories="result.samples.map((_, i) => `w${i + 1}`)"
          :values="result.samples"
          :expected="result.squaringsPerSecond"
          expected-label="reported median"
          x-label="timing window"
          y-label="squarings / s"
          aria-label="per-window squaring rate against the reported median"
          :format="(v) => fmtNum(v, { digits: 0 })"
          :height="200"
        />

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              suggestT for three adversary speed-ups
            </caption>
            <thead class="text-xs uppercase tracking-wide text-muted">
              <tr class="border-b border-default">
                <th scope="col" class="py-1.5 text-left font-medium">Guarded delay</th>
                <th v-for="s in SPEEDUPS" :key="s" scope="col" class="py-1.5 text-right font-medium">
                  adversarySpeedup {{ s }}×
                </th>
              </tr>
            </thead>
            <tbody class="tabular-nums">
              <tr v-for="row in grid" :key="row.wallMs" class="border-b border-default/60">
                <th scope="row" class="py-1.5 text-left font-normal text-highlighted">
                  {{ fmtDuration(row.wallMs) }}
                </th>
                <td v-for="(cell, i) in row.cells" :key="i" class="py-1.5 text-right">
                  <template v-if="cell">
                    <span class="font-mono" :class="cell.T >= result.maxT ? 'text-warning' : 'text-highlighted'">
                      T = {{ fmtNum(cell.T, { digits: 0 }) }}
                    </span>
                    <span class="block text-[11px] text-dimmed">
                      <template v-if="cell.T >= result.maxT">clamped to MAX_T (2³² − 1)</template>
                      <template v-else>{{ fmtDuration(cell.localMs) }} to evaluate here</template>
                    </span>
                  </template>
                  <span v-else class="text-dimmed">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="text-xs text-muted">
          An adversary <em>k</em>× faster than this machine still needs the guarded delay; evaluating
          that T locally costs about <em>k</em> × the delay. That is the whole trade: a one-minute
          guarantee against FPGA-class hardware costs this browser roughly {{ fmtDuration(
            result.rows.find((r) => r.wallMs === 60000 && r.speedup === 1000)?.localMs ?? 0,
          ) }} of squaring.
        </p>
      </template>

      <div class="rounded-md border border-default bg-elevated/30 p-3">
        <p class="text-xs uppercase tracking-wide text-muted">Reference squaring rates (the README's table)</p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Published squaring rates, for choosing an adversarySpeedup
            </caption>
            <thead class="text-xs uppercase tracking-wide text-muted">
              <tr class="border-b border-default">
                <th scope="col" class="py-1.5 text-left font-medium">Hardware</th>
                <th scope="col" class="py-1.5 text-left font-medium">Modulus</th>
                <th scope="col" class="py-1.5 text-right font-medium">Squarings / s</th>
                <th scope="col" class="py-1.5 text-left font-medium ps-3">Source</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in HARDWARE" :key="row.what" class="border-b border-default/60">
                <td class="py-1.5 text-xs text-highlighted">{{ row.what }}</td>
                <td class="py-1.5 font-mono text-xs text-muted">{{ row.modulus }}</td>
                <td class="py-1.5 text-right font-mono text-xs">{{ row.rate }}</td>
                <td class="py-1.5 ps-3 text-xs text-dimmed">{{ row.source }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-xs text-muted">
          Optimized CPU code alone is 10–17× faster than this package; dedicated hardware is hundreds
          of times faster, and the FPGA figure is for 1024-bit squarings, so 2048-bit hardware is
          slower only by a small factor. A prudent margin against hardware adversaries is about
          <strong class="text-highlighted">1000</strong>.
        </p>
      </div>

      <CodeSnippet :code="code" title="what the Measure button ran" />

      <HonestNote variant="caveat" title="Never ship a hardcoded T">
        Native-bigint squaring speed varies by an order of magnitude across CPUs, browsers and
        runtimes — a T that means ten seconds here can mean one second elsewhere, and a hundredth of
        that on an FPGA. Calibrate on the deployment machine, choose an
        <code class="text-primary">adversarySpeedup</code> you can defend, and write down which one
        you chose. T ≤ 2³² − 1 is a wire-format limit, not a safety margin.
      </HonestNote>
    </div>

    <template #footer>
      <code class="text-primary">calibrate</code> measures through
      <code class="text-primary">sequentialSquare</code> including its abort checks and cooperative
      yields, so the rate it reports is the rate <code class="text-primary">evaluate</code> actually
      achieves — not a tight loop that never yields.
    </template>
  </DemoSection>
</template>
