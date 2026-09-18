<script setup lang="ts">
import { cardGeometry, cardSvg } from '@mindpeeker/rate'
import { getBytes, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { buildDial } from '~/lib/rate/dial'
import { bytesPerDigit, drawDigits } from '~/lib/rate/sampling'
import {
  applyPreset,
  BASE_OPTIONS,
  oneBased,
  parsedRate,
  PRESETS,
  rateBase,
  rateForms,
  rateInput,
  rateProblem,
  ringCount,
  SEPARATOR_CASES,
  setDigits,
} from '~/lib/rate/state'

/** The card, the dials and the rate string that produces both. */

const baseChoice = computed({
  get: () => String(rateBase.value),
  set: (value: string) => {
    rateBase.value = Number(value)
  },
})
const baseItems = BASE_OPTIONS.map((b) => ({ label: b.label, value: String(b.value) }))
const baseNote = computed(
  () => BASE_OPTIONS.find((b) => b.value === rateBase.value)?.note ?? `360/${rateBase.value}° per step`,
)

const view = useTabQuery('card', { key: 'view', tabs: ['card', 'dials'] })
const viewItems = [
  { label: 'Card', value: 'card', icon: 'i-lucide-disc' },
  { label: 'Dials', value: 'dials', icon: 'i-lucide-gauge' },
]

// --- random draw from the header-selected source -----------------------------
const draw = useTask<{ digits: number[]; bytesUsed: number }>()
const drawHint = computed(
  () =>
    `≈ ${fmtBytes(Math.ceil(ringCount.value * bytesPerDigit(rateBase.value)))} from ${
      sourceSummary().label
    } · rejection-sampled, so every digit is exactly uniform`,
)

const randomRate = () =>
  draw.run(async (signal) => {
    const base = rateBase.value
    const n = Math.min(12, Math.max(1, Math.round(ringCount.value || 5)))
    const result = await drawDigits(n, base, (need) => getBytes(need, { signal }), { signal })
    const digits = [...result.digits]
    setDigits(digits)
    return { digits, bytesUsed: result.bytesUsed }
  })

// --- card geometry -----------------------------------------------------------
const evenSpread = ref(true)
const innerRadius = ref(0.2)
const ringGap = ref(0.16)

const geometry = computed<{ geo?: ReturnType<typeof cardGeometry>; error?: unknown }>(() => {
  const rate = parsedRate.value
  if (!rate) return {}
  try {
    return {
      geo: cardGeometry(
        rate,
        evenSpread.value
          ? { innerRadius: innerRadius.value, outerRadius: 1 }
          : { outerRadius: 1, ringGap: ringGap.value },
      ),
    }
  } catch (error) {
    return { error }
  }
})

const svg = computed(() =>
  geometry.value.geo
    ? cardSvg(geometry.value.geo, { size: 320, stroke: 'currentColor', strokeWidth: 1.25 })
    : '',
)
const showSvgSource = ref(false)

const dials = computed(() => {
  const rate = parsedRate.value
  if (!rate) return []
  return rate.digits.map((digit, i) => buildDial(i + 1, digit, rate.base, oneBased.value))
})

const cardAria = computed(() => {
  const rate = parsedRate.value
  if (!rate) return 'No card: the rate does not parse'
  return `Magneto-Geometric card for rate ${rateForms.value?.canonical}: ${rate.digits.length} concentric rings, each with one radial line at its digit's angle in base ${rate.base}`
})

const snippet = computed(() => {
  const preset = PRESETS.find((p) => p.input === rateInput.value.trim())
  const parseOpts = `{ base: ${rateBase.value}${oneBased.value ? ', oneBased: true' : ''} }`
  const geoOpts = evenSpread.value
    ? `{ innerRadius: ${innerRadius.value}, outerRadius: 1 }`
    : `{ outerRadius: 1, ringGap: ${ringGap.value} }`
  return `import { cardGeometry, cardSvg, formatRate, parseRate } from '@mindpeeker/rate'

const rate = parseRate('${rateInput.value.trim()}', ${parseOpts})
// ${preset ? preset.note : 'digits are stored 0-based, whatever the labels say'}
const geometry = cardGeometry(rate, ${geoOpts})
const svg = cardSvg(geometry, { size: 320, stroke: 'currentColor' })

formatRate(rate)                                             // '${rateForms.value?.canonical ?? '—'}'
formatRate(rate, { oneBased: true, pad: true, separator: ' ' }) // '${rateForms.value?.book ?? '—'}'`
})
</script>

<template>
  <DemoSection
    id="card"
    title="Card"
    description="A rate is a short tuple of digits; each digit is the angle of one radial line on one ring. Type one, draw one, or load a printed book rate — the card and the dials below are both rendered from the parsed digits, never from the text."
    :api="['parseRate', 'formatRate', 'cardGeometry', 'cardSvg']"
  >
    <template #controls>
      <UFormField label="Rate" hint="separators: - or ." class="min-w-56 flex-1">
        <UInput v-model="rateInput" class="w-full font-mono" placeholder="12-33-7" size="lg" />
      </UFormField>
      <UFormField label="Base" :hint="baseNote" class="min-w-56">
        <USelect v-model="baseChoice" :items="baseItems" class="w-full" />
      </UFormField>
      <USwitch v-model="oneBased" label="One-based labels" :description="`digits printed 1..${rateBase}`" />
      <UFormField label="Rings to draw" class="w-32">
        <UInputNumber v-model="ringCount" :min="1" :max="12" class="w-full" />
      </UFormField>
      <RunControls
        :busy="draw.busy.value"
        label="Draw a random rate"
        busy-label="Drawing…"
        icon="i-lucide-dices"
        :hint="drawHint"
        @run="randomRate"
        @cancel="draw.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs uppercase tracking-wide text-dimmed mr-1">Presets</span>
        <UButton
          v-for="preset in PRESETS"
          :key="preset.id"
          size="xs"
          color="neutral"
          variant="subtle"
          class="font-mono"
          :title="preset.note"
          @click="applyPreset(preset)"
        >
          {{ preset.label }}
        </UButton>
      </div>

      <ErrorAlert :err="rateProblem" :dismissible="false" title="This rate does not parse" />
      <ErrorAlert :err="draw.error.value" @dismiss="draw.reset()" />

      <div v-if="parsedRate && rateForms" class="flex flex-wrap items-center gap-2 text-sm">
        <UBadge color="primary" variant="subtle">base {{ parsedRate.base }}</UBadge>
        <UBadge color="neutral" variant="subtle">{{ parsedRate.digits.length }} rings</UBadge>
        <span class="text-muted">stored digits</span>
        <code class="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">
          [{{ parsedRate.digits.join(', ') }}]
        </code>
        <span class="text-muted">·</span>
        <span class="text-muted">dot form</span>
        <code class="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">{{ rateForms.dotted }}</code>
        <span class="text-muted">·</span>
        <span class="text-muted">book form</span>
        <code class="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">{{ rateForms.book }}</code>
      </div>

      <AccountingBadge
        v-if="draw.result.value"
        :bytes-consumed="draw.result.value.bytesUsed"
        :source="sourceSummary().providerName"
      />

      <div class="rounded-md border border-default bg-elevated/40 p-3">
        <p class="text-xs uppercase tracking-wide text-dimmed">
          Separators — parseRate takes <code class="font-mono">-</code> or
          <code class="font-mono">.</code>, one kind per rate, never spaces
        </p>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <UButton
            v-for="c in SEPARATOR_CASES"
            :key="c.id"
            size="xs"
            :color="c.valid ? 'success' : 'error'"
            variant="soft"
            class="font-mono"
            :title="c.why"
            @click="rateInput = c.input"
          >
            <UIcon :name="c.valid ? 'i-lucide-check' : 'i-lucide-x'" class="size-3" />
            {{ c.input.replace(/ /g, '␣') }}
          </UButton>
        </div>
        <p class="mt-2 text-xs text-muted">
          Click a red one: the demo shows the typed <code class="font-mono">RateError</code> with its
          <code class="font-mono">code</code> instead of throwing. A printed rate like
          <code class="font-mono">01 04 19 27 28</code> is parsed by replacing its spaces with
          dashes.
        </p>
      </div>

      <UTabs v-model="view" :items="viewItems" :content="false" size="sm" class="w-full" />

      <div v-if="view === 'card'" class="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div>
          <ErrorAlert :err="geometry.error" :dismissible="false" title="Card geometry rejected" />
          <!-- eslint-disable-next-line vue/no-v-html -- cardSvg builds the string from numbers -->
          <div
            v-if="svg"
            class="grid place-items-center text-highlighted [&>svg]:h-auto [&>svg]:w-full [&>svg]:max-w-[320px]"
            role="img"
            :aria-label="cardAria"
            v-html="svg"
          />
        </div>
        <div class="flex flex-col gap-3">
          <USwitch
            v-model="evenSpread"
            label="Even inner → outer spread"
            description="off: a fixed ring gap, so cards with different digit counts share a rim"
          />
          <UFormField
            v-if="evenSpread"
            label="Inner radius"
            :hint="`${fmtNum(innerRadius, { digits: 2 })} card units`"
          >
            <USlider v-model="innerRadius" :min="0.05" :max="0.9" :step="0.05" class="mt-2" />
          </UFormField>
          <UFormField v-else label="Ring gap" :hint="`${fmtNum(ringGap, { digits: 2 })} card units`">
            <USlider v-model="ringGap" :min="0.02" :max="0.4" :step="0.01" class="mt-2" />
          </UFormField>
          <p class="text-xs text-muted">
            <code class="font-mono">cardGeometry</code> returns pure
            <code class="font-mono">{{ '{ radius, angleRad }' }}</code> data — no DOM — and
            <code class="font-mono">cardSvg</code> turns it into a standalone SVG string you could
            print or snapshot-diff. Too large a ring gap is a typed error, not a broken picture: drag
            it up on a five-ring rate.
          </p>
          <div>
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-code"
              @click="showSvgSource = !showSvgSource"
            >
              {{ showSvgSource ? 'Hide' : 'Show' }} the SVG string ({{ svg.length }} chars)
            </UButton>
          </div>
          <CodeSnippet
            v-if="showSvgSource"
            :code="svg.length > 700 ? `${svg.slice(0, 700)}…` : svg"
            lang="svg"
            title="cardSvg output (truncated)"
          />
        </div>
      </div>

      <div v-else class="flex flex-col gap-3">
        <p class="text-sm text-muted">
          The same digits as dials — one dial per ring, every calibration of the base drawn as a
          tick, the digit as the needle. This is the instrument Rae replaced; the card above is the
          replacement.
        </p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div
            v-for="dial in dials"
            :key="dial.ring"
            class="flex flex-col items-center rounded-md border border-default bg-elevated/40 p-2"
          >
            <svg
              :viewBox="`0 0 ${dial.size} ${dial.size}`"
              class="w-full max-w-[128px]"
              role="img"
              :aria-label="dial.ariaLabel"
            >
              <circle
                :cx="dial.cx"
                :cy="dial.cy"
                :r="dial.r"
                fill="none"
                stroke="var(--viz-grid)"
                stroke-width="1"
              />
              <line
                v-for="tick in dial.ticks"
                :key="tick.key"
                :x1="tick.x1"
                :y1="tick.y1"
                :x2="tick.x2"
                :y2="tick.y2"
                :stroke="tick.major ? 'var(--viz-axis)' : 'var(--viz-grid)'"
                :stroke-width="tick.major ? 1.4 : 0.8"
              />
              <line
                :x1="dial.cx"
                :y1="dial.cy"
                :x2="dial.needle.x"
                :y2="dial.needle.y"
                stroke="var(--ui-primary)"
                stroke-width="2"
                stroke-linecap="round"
              />
              <circle :cx="dial.cx" :cy="dial.cy" r="2.5" fill="var(--ui-primary)" />
            </svg>
            <p class="mt-1 font-mono text-sm text-highlighted">{{ dial.label }}</p>
            <p class="font-mono text-xs text-muted">{{ fmtNum(dial.degrees, { digits: 2 }) }}°</p>
            <p class="text-[11px] text-dimmed">ring {{ dial.ring }}</p>
          </div>
        </div>
      </div>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <template #footer>
      Angle convention, from the package: θ = 0 points up (12 o'clock) and increases clockwise, so
      x = c + r·sin θ and y = c − r·cos θ. Digits are stored 0-based; the one-based switch only
      changes the labels you type and read.
    </template>
  </DemoSection>
</template>
