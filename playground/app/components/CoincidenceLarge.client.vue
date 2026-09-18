<script setup lang="ts">
/**
 * The law of truly large numbers: two lines of arithmetic, exported so a
 * synchronicity log can state its denominator next to its anecdote.
 *
 * Littlewood's "law of miracles" is this same arithmetic with invented inputs,
 * so the inputs are editable here and the package ships no constant for them.
 */
import { expectedCoincidences, probabilityAtLeastOne } from '@mindpeeker/coincidence'
import { largeNumbersCurve } from '~/lib/coincidence/curves'
import { fmtNum } from '~/lib/format'

const opportunities = ref(1_008_000)
const oneIn = ref(1_000_000)

/** Littlewood's counting rule, spelled out so every factor can be argued with. */
const perHour = ref(3600)
const hoursPerDay = ref(8)
const days = ref(35)

const builderN = computed(
  () =>
    Math.max(0, Math.trunc(Number(perHour.value) || 0)) *
    Math.max(0, Math.trunc(Number(hoursPerDay.value) || 0)) *
    Math.max(0, Math.trunc(Number(days.value) || 0)),
)

const safeN = computed(() => Math.max(0, Number(opportunities.value) || 0))
const p = computed(() => {
  const x = Math.max(1, Number(oneIn.value) || 1)
  return Math.min(1, 1 / x)
})

const outcome = computed<{ expected?: number; atLeastOne?: number; error?: unknown }>(() => {
  try {
    return {
      expected: expectedCoincidences(safeN.value, p.value),
      atLeastOne: probabilityAtLeastOne(safeN.value, p.value),
    }
  } catch (error) {
    return { error }
  }
})

const curve = computed(() => {
  const centre = Math.log10(1 / p.value)
  return largeNumbersCurve(p.value, Math.max(0, centre - 4), centre + 4)
})

const series = computed(() => [
  { name: 'P(at least one) = 1 − (1−p)^N', y: curve.value.atLeastOne, x: curve.value.x },
  {
    name: 'expected count N·p, clipped at 1',
    y: curve.value.expectedClipped,
    x: curve.value.x,
    color: 2 as const,
    dashed: true,
  },
])

const logN = computed(() => (safeN.value > 0 ? Math.log10(safeN.value) : 0))

function useBuilder(): void {
  opportunities.value = builderN.value
}

interface Example {
  label: string
  n: number
  oneIn: number
  note: string
}

const EXAMPLES: readonly Example[] = [
  {
    label: 'Littlewood’s month',
    n: 1_008_000,
    oneIn: 1_000_000,
    note: 'one noticed event a second, eight waking hours, 35 days — about one “miracle” a month',
  },
  {
    label: 'One in a million, to someone',
    n: 10_000_000,
    oneIn: 1_000_000,
    note: 'ten million people each with one chance: P ≈ 0.99995',
  },
  {
    label: 'A year of glancing at clocks',
    n: 365 * 20,
    oneIn: 1440,
    note: 'twenty glances a day, one minute of the day called meaningful',
  },
  {
    label: 'A dream that “came true”',
    n: 365 * 3 * 100_000_000,
    oneIn: 10_000,
    note: 'three remembered dreams a night across 100 million people, each a 1-in-10 000 hit',
  },
  {
    label: 'A 1-in-a-billion event, worldwide, daily',
    n: 8_000_000_000,
    oneIn: 1_000_000_000,
    note: 'eight billion people, one chance each: about eight a day',
  },
]

function load(example: Example): void {
  opportunities.value = example.n
  oneIn.value = example.oneIn
}

/** Values the README prints, recomputed live. */
const pinned = computed(() => [
  {
    label: 'expectedCoincidences(1_008_000, 1e-6)',
    live: expectedCoincidences(1_008_000, 1e-6),
    published: 1.008,
    source: 'README — Littlewood’s “one miracle a month”',
  },
  {
    label: 'probabilityAtLeastOne(1e7, 1e-6)',
    live: probabilityAtLeastOne(1e7, 1e-6),
    published: 0.9999546002972367,
    source: 'README quick start',
  },
])

const code = computed(
  () => `import { expectedCoincidences, probabilityAtLeastOne } from '@mindpeeker/coincidence'

const N = ${fmtNum(safeN.value, { digits: 0 })}          // opportunities
const p = 1 / ${fmtNum(1 / p.value, { digits: 0 })}      // per opportunity

expectedCoincidences(N, p)     // ${fmtNum(outcome.value.expected ?? 0, { digits: 4 })}  — N·p, no independence needed
probabilityAtLeastOne(N, p)    // ${fmtNum(outcome.value.atLeastOne ?? 0, { digits: 8 })}  — 1 − (1−p)^N, independent chances`,
)
</script>

<template>
  <DemoSection
    id="large-numbers"
    title="Truly large numbers — how many chances were there?"
    :api="['expectedCoincidences', 'probabilityAtLeastOne']"
    description="“With a large enough sample, any outrageous thing is likely to happen.” Np needs no independence; 1 − (1−p)ᴺ does, and is formed as −expm1(N·log1p(−p)) so a one-in-a-billion chance keeps its digits."
  >
    <template #controls>
      <UFormField label="N — opportunities" size="sm" class="w-full sm:w-52">
        <UInputNumber v-model="opportunities" :min="0" :step="1000" class="w-full" />
      </UFormField>
      <UFormField label="p — one chance in…" size="sm" class="w-full sm:w-52">
        <UInputNumber v-model="oneIn" :min="1" :step="1000" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="The arguments were rejected" />

      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="example in EXAMPLES"
          :key="example.label"
          size="xs"
          variant="soft"
          color="neutral"
          @click="load(example)"
        >
          {{ example.label }}
        </UButton>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Expected coincidences"
          :value="outcome.expected ?? null"
          :digits="4"
          tone="primary"
          note="N·p — linearity of expectation, independent or not"
        />
        <StatTile
          label="P(at least one)"
          :value="outcome.atLeastOne ?? null"
          :digits="8"
          tone="warning"
          note="1 − (1−p)ᴺ — independent opportunities only"
        />
        <StatTile
          label="Opportunities for one expected"
          :value="1 / p"
          :digits="0"
          note="N = 1/p makes the expected count exactly 1"
        />
        <StatTile
          label="Share of that threshold"
          :value="safeN * p"
          :digits="3"
          note="N ÷ (1/p) — the same number as the expected count"
        />
      </div>

      <div class="rounded-md border border-default bg-elevated/30 p-3">
        <h3 class="text-sm font-semibold text-highlighted">Where N comes from</h3>
        <p class="mt-1 text-sm text-muted">
          Littlewood counted one noticed event per second for eight waking hours a day. Every factor
          below is an invented but arguable number — change them and see what the “law of miracles”
          becomes.
        </p>
        <div class="mt-3 flex flex-wrap items-end gap-3">
          <UFormField label="Events noticed per hour" size="sm" class="w-full sm:w-44">
            <UInputNumber v-model="perHour" :min="0" :step="100" class="w-full" />
          </UFormField>
          <UFormField label="Waking hours per day" size="sm" class="w-full sm:w-40">
            <UInputNumber v-model="hoursPerDay" :min="0" :max="24" :step="1" class="w-full" />
          </UFormField>
          <UFormField label="Days" size="sm" class="w-full sm:w-32">
            <UInputNumber v-model="days" :min="0" :step="1" class="w-full" />
          </UFormField>
          <div class="pb-1.5 text-sm">
            = <span class="font-mono text-highlighted">{{ fmtNum(builderN, { digits: 0 }) }}</span> events
          </div>
          <UButton size="sm" variant="soft" color="primary" icon="i-lucide-arrow-up" @click="useBuilder">
            Use as N
          </UButton>
        </div>
      </div>

      <LineChart
        :series="series"
        :hlines="[{ value: 0.5, label: '½' }]"
        :vlines="[
          { value: logN, label: `your N = 10^${fmtNum(logN, { digits: 2 })}`, color: 'primary', dashed: false },
        ]"
        :y-domain="[0, 1]"
        x-label="log₁₀ opportunities N"
        y-label="probability"
        :height="280"
        :format="(v) => fmtNum(v, { digits: 5 })"
        aria-label="Probability of at least one success and the clipped expected count against the base-ten logarithm of the number of opportunities"
      />

      <div>
        <h3 class="text-sm font-semibold text-highlighted">Worked examples</h3>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Example</th>
                <th class="text-right py-1.5 px-3 font-medium">N</th>
                <th class="text-right py-1.5 px-3 font-medium">p</th>
                <th class="text-right py-1.5 px-3 font-medium">N·p</th>
                <th class="text-right py-1.5 px-3 font-medium">P(≥ 1)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="example in EXAMPLES" :key="example.label" class="border-t border-default align-top">
                <td class="py-1.5 pr-3">
                  <div class="text-highlighted">{{ example.label }}</div>
                  <div class="text-xs text-muted">{{ example.note }}</div>
                </td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">
                  {{ fmtNum(example.n, { digits: 0 }) }}
                </td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums text-muted">
                  1/{{ fmtNum(example.oneIn, { digits: 0 }) }}
                </td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">
                  {{ fmtNum(expectedCoincidences(example.n, 1 / example.oneIn), { digits: 3 }) }}
                </td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">
                  {{ fmtNum(probabilityAtLeastOne(example.n, 1 / example.oneIn), { digits: 6 }) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 class="text-sm font-semibold text-highlighted">Published values, recomputed here</h3>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Call</th>
                <th class="text-right py-1.5 px-3 font-medium">Computed now</th>
                <th class="text-right py-1.5 px-3 font-medium">Published</th>
                <th class="text-left py-1.5 pl-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in pinned" :key="row.label" class="border-t border-default">
                <td class="py-1.5 pr-3 font-mono text-xs">{{ row.label }}</td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">{{ row.live.toPrecision(12) }}</td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums text-muted">
                  {{ row.published.toPrecision(12) }}
                </td>
                <td class="py-1.5 pl-3 text-muted text-xs">{{ row.source }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <CodeSnippet :code="code" title="what these controls ran" />

      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact">
          Both formulas are exact given their inputs: N·p is linearity of expectation and needs no
          independence at all, and 1 − (1−p)ᴺ is exact when the N opportunities are independent.
          Neither is a statistical test, and neither knows anything about your data.
        </HonestNote>
        <HonestNote variant="caveat" title="Littlewood’s numbers are invented">
          One event a second, eight hours a day, one in a million as the threshold for surprise:
          these are illustrative figures from a 1953 book of essays, not measurements. The package
          ships no constant for them, and this page makes them editable for the same reason. The
          deeper point survives the arithmetic: the coincidence you noticed had far more chances to
          happen than the one you would have pre-registered, and that multiplicity is invisible from
          inside the anecdote.
        </HonestNote>
      </div>
    </div>

    <template #footer>
      Diaconis &amp; Mosteller (1989) for the law of truly large numbers; J. E. Littlewood,
      <em>A Mathematician's Miscellany</em> (1953); the name “law of miracles” is Freeman Dyson's
      (2004).
    </template>
  </DemoSection>
</template>
