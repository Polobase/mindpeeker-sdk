<script setup lang="ts">
/**
 * An effect size in information units: the Shannon capacity of the symmetric
 * channel a k-alternative hit rate implies. Zero at chance, log₂k at certainty.
 */
import { guessingCapacity } from '@mindpeeker/judging'
import type { LineSeries } from '~/lib/chart'
import { fmtNum } from '~/lib/format'
import { CHOICE_PRESETS } from '~/lib/judging/presets'

const choices = ref(5)
const hitsPerRun = ref(7)

const choiceItems = CHOICE_PRESETS.map((preset) => ({ label: preset.label, value: preset.choices }))

const safeChoices = computed(() => Math.max(2, Math.trunc(Number(choices.value) || 2)))
const rate = computed(() => Math.min(1, Math.max(0, Number(hitsPerRun.value) / 25)))

const capacity = computed(() => {
  try {
    return guessingCapacity(rate.value, safeChoices.value)
  } catch {
    return undefined
  }
})

const curves = computed<LineSeries[]>(() =>
  [2, 4, 5, 6].map((k, i) => {
    const x: number[] = []
    const y: number[] = []
    for (let step = 0; step <= 200; step++) {
      const p = step / 200
      x.push(p)
      y.push(guessingCapacity(p, k))
    }
    return {
      name: `k = ${k} — chance ${fmtNum(1 / k, { digits: 3 })}`,
      x,
      y,
      color: i + 1,
      dashed: k !== safeChoices.value,
    }
  }),
)

/** Epstein's table: what a Zener score is worth per call. */
const ZENER_ROWS = [5, 6, 7, 8, 9, 10, 12, 15, 25]
const zenerTable = computed(() =>
  ZENER_ROWS.map((hits) => ({
    hits,
    rate: hits / 25,
    capacity: guessingCapacity(hits / 25, 5),
  })),
)

const code = computed(
  () => `import { guessingCapacity } from '@mindpeeker/judging'

guessingCapacity(${fmtNum(rate.value, { digits: 4 })}, ${safeChoices.value})  // ${fmtNum(capacity.value ?? 0, { digits: 6 })} bits per trial

// Epstein's two published values for a Zener run:
guessingCapacity(6 / 25, 5)   // ${fmtNum(guessingCapacity(6 / 25, 5), { digits: 7 })}
guessingCapacity(7 / 25, 5)   // ${fmtNum(guessingCapacity(7 / 25, 5), { digits: 7 })}`,
)
</script>

<template>
  <DemoSection
    id="capacity"
    title="The same hit rate as an information rate"
    :api="['guessingCapacity']"
    description="C = log₂k + p log₂p + (1−p) log₂((1−p)/(k−1)): the capacity of the symmetric channel a hit rate p implies, with the misses spread evenly over the wrong symbols. It is 0 at chance and log₂k at p = 1."
  >
    <template #controls>
      <UFormField label="Design" size="sm" class="w-full sm:w-80">
        <USelect v-model="choices" :items="choiceItems" class="w-full" />
      </UFormField>
      <UFormField label="Hits per 25 calls" size="sm" class="w-full sm:w-44">
        <UInputNumber v-model="hitsPerRun" :min="0" :max="25" :step="1" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile label="Hit rate" :value="rate" :digits="4" :note="`chance ${fmtNum(1 / safeChoices, { digits: 4 })}`" />
        <StatTile
          label="Capacity"
          :value="capacity"
          :digits="6"
          tone="primary"
          note="bits per trial"
        />
        <StatTile
          label="Per 25 calls"
          :value="(capacity ?? 0) * 25"
          :digits="4"
          note="bits a whole run could carry at this rate"
        />
      </div>

      <LineChart
        :series="curves"
        :vlines="[{ value: rate, label: `your rate ${fmtNum(rate, { digits: 3 })}`, color: 'primary', dashed: false }]"
        :hlines="[{ value: 0, label: 'chance — zero capacity', dashed: false }]"
        x-label="hit rate p"
        y-label="bits per trial"
        :height="280"
        :format="(v) => fmtNum(v, { digits: 5 })"
        aria-label="Shannon capacity against hit rate for two, four, five and six alternatives"
      />

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="sr-only">Capacity of a Zener hit rate, five symbols</caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-left py-1.5 pr-3 font-medium">Hits per 25</th>
              <th class="text-right py-1.5 px-3 font-medium">Hit rate</th>
              <th class="text-right py-1.5 px-3 font-medium">Bits per call</th>
              <th class="text-right py-1.5 pl-3 font-medium">Bits per run</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in zenerTable"
              :key="row.hits"
              class="border-t border-default"
              :class="row.hits === Math.trunc(Number(hitsPerRun)) ? 'bg-elevated/50' : ''"
            >
              <td class="py-1 pr-3 font-mono tabular-nums">{{ row.hits }}</td>
              <td class="py-1 px-3 text-right font-mono tabular-nums text-muted">{{ fmtNum(row.rate, { digits: 2 }) }}</td>
              <td class="py-1 px-3 text-right font-mono tabular-nums">{{ fmtNum(row.capacity, { digits: 7 }) }}</td>
              <td class="py-1 pl-3 text-right font-mono tabular-nums text-muted">
                {{ fmtNum(row.capacity * 25, { digits: 4 }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <CodeSnippet :code="code" title="what these controls ran" />

      <HonestNote variant="caveat">
        6 or 7 hits per 25 — the rates the classic card literature argued over — are 0.0069 and
        0.0265 bits per call. That is the <em>most</em> such a channel could transmit with ideal
        coding, not what a guesser conveys, and it is a measure of size, never of mechanism. At
        0.0069 bits per call you would need about 145 calls to move one bit.
      </HonestNote>
    </div>

    <template #footer>
      Epstein (2009), ch. 11 prints 0.0069 and 0.026 for these two rates.
    </template>
  </DemoSection>
</template>
