<script setup lang="ts">
/** Section 4a — the SP 800-90B §4.4 continuous-test cutoffs, computed with
 * the same exact functions the conditioner uses. */
import {
  CUTOFF_REFERENCES,
  CUTOFF_SNIPPET,
  type CutoffCurve,
  cutoffCurve,
  cutoffsAt,
  type WindowSize,
} from '~/lib/entropy/cutoffs'

const PRESETS = [
  { label: 'jitter, browser (0.01)', h: 0.01 },
  { label: 'jitter (1/16)', h: 0.0625 },
  { label: 'sensor (0.25)', h: 0.25 },
  { label: 'camera / SDR (1)', h: 1 },
  { label: 'microphone (2)', h: 2 },
  { label: 'serial / hwRng (7)', h: 7 },
  { label: 'ideal byte (8)', h: 8 },
]

const h = ref(1)
const windowSize = ref<WindowSize>(512)
const windowItems = [
  { label: 'W = 512 (non-binary samples)', value: 512 },
  { label: 'W = 1024 (binary samples)', value: 1024 },
]

/** The slider moves in exact sixteenths of a bit; presets may sit between. */
const sixteenths = computed({
  get: () => Math.min(128, Math.max(1, Math.round(h.value * 16))),
  set: (value: number) => {
    h.value = value / 16
  },
})

const result = computed(() => cutoffsAt(h.value, windowSize.value))

/** False RCT alarms per MiB when the source truly delivers 8 bits per byte. */
const falseAlarmsPerMiB = computed(() => {
  const c = result.value.rct
  if (!Number.isFinite(c)) return Number.NaN
  return 2 ** 20 * 2 ** (-8 * (c - 1))
})

const references = computed(() =>
  CUTOFF_REFERENCES.map((ref) => {
    const live = cutoffsAt(ref.h, ref.windowSize)
    const computedValue = ref.test === 'RCT' ? live.rct : live.apt
    return { ...ref, computed: computedValue, matches: computedValue === ref.documented }
  }),
)
const allMatch = computed(() => references.value.every((r) => r.matches))

const curveTask = useTask<CutoffCurve>()
const curve = computed(() => curveTask.result.value)

const series = computed(() => {
  const data = curve.value
  if (!data) return []
  return [
    {
      name: 'APT cutoff / W — W = 512',
      points: data.h.map((x, i) => [x, data.apt512[i] as number] as [number, number]),
      color: 1 as const,
    },
    {
      name: 'APT cutoff / W — W = 1024',
      points: data.h.map((x, i) => [x, data.apt1024[i] as number] as [number, number]),
      color: 2 as const,
      dashed: true,
    },
  ]
})

const vlines = computed(() => [
  { value: 0.0625, label: 'jitter 1/16' },
  { value: 0.25, label: 'sensor' },
  { value: 1, label: 'camera' },
  { value: 2, label: 'mic' },
  { value: 7, label: 'serial' },
])

onMounted(() => {
  void curveTask.run(async (signal, setProgress) => await cutoffCurve(56, signal, setProgress))
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      title="Health-test cutoffs at any credit"
      :api="['rctCutoff', 'aptCutoff', 'minEntropyPerSample']"
      description="The Repetition Count Test fires on C identical samples in a row; the Adaptive Proportion Test fires when one value fills a W-sample window too often. Both cutoffs are fixed by the credited min-entropy H and the recommended false-positive rate α = 2⁻²⁰ per sample."
    >
      <template #controls>
        <UFormField label="Window size W" size="sm">
          <USelect v-model="windowSize" :items="windowItems" size="sm" class="w-60" />
        </UFormField>
      </template>

      <div class="flex flex-col gap-2">
        <label for="credit-slider" class="text-sm text-muted">
          Credited min-entropy H — <span class="font-mono text-highlighted">{{ h }}</span> bits per
          sample (slider steps in exact sixteenths of a bit)
        </label>
        <USlider
          id="credit-slider"
          v-model="sixteenths"
          :min="1"
          :max="128"
          :step="1"
          aria-label="Credited min-entropy H in sixteenths of a bit per sample"
        />
        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="preset in PRESETS"
            :key="preset.label"
            size="xs"
            color="neutral"
            :variant="h === preset.h ? 'solid' : 'subtle'"
            @click="h = preset.h"
          >
            {{ preset.label }}
          </UButton>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-4">
        <StatTile
          label="RCT cutoff C"
          :value="result.rct"
          :digits="0"
          tone="primary"
          note="1 + ⌈20/H⌉ identical samples in a row"
        />
        <StatTile
          label="APT cutoff"
          :value="result.apt"
          :digits="0"
          :tone="result.aptFires ? 'primary' : 'warning'"
          :note="`of W = ${windowSize} — ${result.aptFires ? 'the test can fire' : 'W + 1: the test cannot fire'}`"
        />
        <StatTile
          label="Expected proportion 2⁻ᴴ"
          :value="result.expectedProportion"
          :digits="4"
          note="how often the most common value should appear"
        />
        <StatTile
          label="False RCT alarms per MiB"
          :value="falseAlarmsPerMiB"
          :digits="4"
          note="if the source is truly uniform (8 b/B)"
        />
      </div>

      <p v-if="result.error" class="mt-3 text-sm text-error font-mono">{{ result.error }}</p>

      <div class="mt-5">
        <div v-if="curveTask.busy.value" class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          computing the exact cutoff curve…
        </div>
        <LineChart
          v-else-if="series.length"
          :series="series"
          :vlines="vlines"
          :hlines="[{ value: 1, label: 'cutoff = W — above it the APT cannot fire', dashed: true }]"
          x-label="credited H (bits per sample)"
          y-label="APT cutoff ÷ W"
          :height="260"
          aria-label="Adaptive Proportion Test cutoff as a share of the window, against the credited min-entropy"
          :format="(v) => v.toFixed(3)"
        />
      </div>

      <HonestNote variant="exact" class="mt-4">
        These are not approximations. <code class="font-mono">rctCutoff</code> is
        1 + ⌈20/H⌉ and <code class="font-mono">aptCutoff</code> is the exact binomial critical value
        1 + CRITBINOM(W, 2⁻ᴴ, 1 − 2⁻²⁰), summed in log space from the upper tail down — which is why
        it stays active at jitter's 1/16-bit credit (509 of 512) instead of underflowing. A cutoff of
        W + 1 is the <em>true</em> answer, not a fallback: below H = 20/W (0.039 at W = 512,
        0.0195 at W = 1024) no window can be extreme enough to alarm.
      </HonestNote>

      <HonestNote variant="caveat" class="mt-3">
        α = 2⁻²⁰ per sample <em>per test</em> means healthy sources alarm on purpose. At a credit of
        7–8 b/B the RCT cutoff is 4, i.e. one false alarm per 2²⁴ samples — about 1/16 alarm per MiB
        of raw samples, so 6.1 % of 1 MiB reads see one. That is exactly why the default is
        <code class="font-mono">onHealthFailure: 'retest'</code> with a budget of 3 alarms rather
        than dying on the first. At the worst case the spec allows (true min-entropy exactly equal
        to the credit) each test may alarm up to once per 2²⁰ samples.
      </HonestNote>

      <CodeSnippet class="mt-4" :code="CUTOFF_SNIPPET" title="the cutoffs, recomputed live" />
    </DemoSection>

    <DemoSection
      title="Reference values, recomputed here"
      :level="3"
      :api="['aptCutoff', 'rctCutoff']"
      description="Every cutoff the packages document, recomputed in your browser by the same functions the conditioner calls. Documented and live must agree."
    >
      <div class="overflow-x-auto rounded-md border border-default">
        <table class="w-full text-sm border-collapse">
          <caption class="sr-only">Documented cutoff values against the values computed here</caption>
          <thead class="bg-elevated/60 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" class="text-left font-medium px-3 py-2">Test</th>
              <th scope="col" class="text-left font-medium px-3 py-2">H</th>
              <th scope="col" class="text-left font-medium px-3 py-2">W</th>
              <th scope="col" class="text-right font-medium px-3 py-2">Documented</th>
              <th scope="col" class="text-right font-medium px-3 py-2">Computed here</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in references"
              :key="`${row.test}-${row.h}-${row.windowSize}-${i}`"
              class="border-t border-default"
            >
              <td class="px-3 py-2 font-mono text-xs">{{ row.test }}</td>
              <td class="px-3 py-2 font-mono text-xs">
                {{ row.h }}
                <span class="text-dimmed">· {{ row.label }}</span>
              </td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.windowSize }}</td>
              <td class="px-3 py-2 text-right font-mono">{{ row.documented }}</td>
              <td class="px-3 py-2 text-right font-mono">
                <span :class="row.matches ? 'text-success' : 'text-error'">{{ row.computed }}</span>
                <UIcon
                  :name="row.matches ? 'i-lucide-check' : 'i-lucide-x'"
                  class="size-3.5 ml-1 inline-block"
                  :class="row.matches ? 'text-success' : 'text-error'"
                />
              </td>
              <td class="px-3 py-2 text-xs text-muted">{{ row.source }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="mt-3 text-sm" :class="allMatch ? 'text-success' : 'text-error'">
        {{
          allMatch
            ? `All ${references.length} documented cutoffs reproduce exactly in this browser.`
            : 'A cutoff disagrees with its documented value — that would be a real bug.'
        }}
      </p>

      <template #footer>
        SP 800-90B's own Table 2 is not reproduced in the package docs, so these are the SDK's
        documented anchors (README lines, doc comments and test assertions), not a transcription of
        the standard's table. <code class="font-mono">rctCutoff</code> and
        <code class="font-mono">aptCutoff</code> live in
        <code class="font-mono">@mindpeeker/negentropy/numerics</code>; the entropy package ships a
        port of the same algorithm to stay dependency-free, and a cross-package test asserts the two
        agree cutoff for cutoff.
      </template>
    </DemoSection>

    <EntropyHealthSim />
    <EntropyConditioning />
  </div>
</template>
