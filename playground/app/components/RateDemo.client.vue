<script setup lang="ts">
import { cardGeometry, cardSvg, parseRate, RateError, ratePhases } from '@mindpeeker/rate'
import { getBytes } from '~/lib/entropy'

const input = ref('12-33-7')
const drawing = ref(false)

const parsed = computed(() => {
  try {
    return { rate: parseRate(input.value.trim()), error: '' }
  } catch (e) {
    // Only rate-shaped failures are user error; anything else is a real bug.
    if (e instanceof RateError) return { rate: undefined, error: e.message }
    throw e
  }
})

// `currentColor` so the card inherits the theme's text colour in light and dark.
const svg = computed(() =>
  parsed.value.rate
    ? cardSvg(cardGeometry(parsed.value.rate), { size: 300, stroke: 'currentColor' })
    : '',
)

const rows = computed(() => {
  const rate = parsed.value.rate
  if (!rate) return []
  const phases = ratePhases(rate)
  return rate.digits.map((d, i) => ({
    position: i + 1,
    digit: d,
    degrees: ((phases[i] as number) * 180) / Math.PI,
  }))
})

async function randomRate(): Promise<void> {
  drawing.value = true
  try {
    const bytes = await getBytes(3)
    input.value = [...bytes].map((b) => b % 44).join('-')
  } finally {
    drawing.value = false
  }
}
</script>

<template>
  <div>
    <UCard>
      <div class="flex flex-wrap gap-4 items-end">
        <div class="flex-1 min-w-60">
          <label class="text-xs text-muted uppercase tracking-wide">Rate</label>
          <UInput
            v-model="input"
            type="text"
            placeholder="12-33-7"
            size="lg"
            class="w-full mt-1 font-mono"
          />
        </div>
        <UButton :loading="drawing" @click="randomRate">Random rate from entropy</UButton>
        <UBadge v-if="parsed.rate" color="neutral" variant="subtle">
          base {{ parsed.rate.base }} · {{ parsed.rate.digits.length }} ring(s)
        </UBadge>
      </div>
      <p v-if="parsed.error" class="mt-3 text-sm text-error">{{ parsed.error }}</p>
    </UCard>

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <UCard>
        <h3 class="font-semibold mb-2">Card geometry</h3>
        <div
          class="grid place-items-center min-h-72 [&>svg]:w-[300px] [&>svg]:max-w-full [&>svg]:h-auto"
          v-html="svg"
        />
      </UCard>

      <UCard>
        <h3 class="font-semibold mb-2">Phase angles</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Position</th>
                <th class="text-right py-1.5 px-3 font-medium">
                  Digit (base {{ parsed.rate?.base ?? 44 }})
                </th>
                <th class="text-right py-1.5 pl-3 font-medium">Angle</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.position" class="border-t border-default">
                <td class="py-1.5 pr-3">#{{ r.position }}</td>
                <td class="py-1.5 px-3 text-right font-mono">{{ r.digit }}</td>
                <td class="py-1.5 pl-3 text-right font-mono">{{ r.degrees.toFixed(1) }}°</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mt-3 text-xs text-muted">
          Each digit <span class="font-mono">d</span> sits at
          <span class="font-mono">d · 360/{{ parsed.rate?.base ?? 44 }}</span> on its ring — the
          card is the set of those angles, nothing more.
        </p>
      </UCard>
    </div>
  </div>
</template>
