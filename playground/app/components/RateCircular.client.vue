<script setup lang="ts">
import {
  circularMean,
  circularVariance,
  digitToAngle,
  radiansToDegrees,
  ratePhases,
  resultantLength,
} from '@mindpeeker/rate'
import { createYielder } from '~/lib/async'
// currentSeedLabel() is auto-imported from ~/utils/sources.
import { drbgSource, getBytes, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { buildPhasor } from '~/lib/rate/dial'
import {
  exactResultant,
  meanAndSd,
  rayleighDensity,
  twoSidedNormalP,
} from '~/lib/rate/exact'
import { bytesPerDigit, drawDigits } from '~/lib/rate/sampling'
import { applyPreset, parsedRate, PRESETS } from '~/lib/rate/state'

/** Directional statistics of the ring angles, against random rates. */

const stats = computed(() => {
  const rate = parsedRate.value
  if (!rate) return undefined
  const phases = ratePhases(rate)
  const R = resultantLength(phases)
  const mean = circularMean(phases)
  return {
    phases,
    R,
    mean,
    meanDeg: radiansToDegrees(mean),
    variance: circularVariance(phases),
    degenerate: R < 1e-9,
    exact: exactResultant(rate.digits, rate.base),
    phasor: buildPhasor(rate.digits, rate.base, R, mean),
  }
})

const exactGap = computed(() => {
  const s = stats.value
  return s?.exact ? Math.abs(s.R - s.exact.value) : undefined
})

// --- random rates from the selected source -----------------------------------
interface TrialMeta {
  n: number
  base: number
  bytesUsed: number
  source: string
  controlMeanR2: number
  controlTrials: number
  seedLabel: string
}

const trialCount = ref(200)
const samples = shallowRef<number[]>([])
const meta = ref<TrialMeta | undefined>()
const task = useTask<number>()

const ringsNow = computed(() => parsedRate.value?.digits.length ?? 0)
const byteHint = computed(() => {
  const rate = parsedRate.value
  if (!rate) return undefined
  const bytes = Math.ceil(trialCount.value * rate.digits.length * bytesPerDigit(rate.base))
  return `≈ ${fmtBytes(bytes)} from ${sourceSummary().label}, plus a free DRBG control arm`
})

function clampCount(value: number): number {
  return Math.min(2000, Math.max(20, Math.round(value || 200)))
}

/** Load one of the shared presets by id (the two with a closed form). */
function usePreset(id: string): void {
  const preset = PRESETS.find((p) => p.id === id)
  if (preset) applyPreset(preset)
}

function start(append: boolean): void {
  const rate = parsedRate.value
  if (!rate) return
  void task.run(async (signal, setProgress) => {
    const n = rate.digits.length
    const base = rate.base
    const count = clampCount(trialCount.value)
    const tick = createYielder(8, signal)
    setProgress(0)

    const draw = await drawDigits(count * n, base, (need) => getBytes(need, { signal }), { signal })
    // An independent, reproducible arm: the same seed and the same trial count
    // always give the same number, so it is a control, not a second result.
    const seedLabel = `${currentSeedLabel()} / rate circular control`
    const control = drbgSource(seedLabel)
    const controlDraw = await drawDigits(
      count * n,
      base,
      async (need) => (await control.getBytes(need, { signal })).bytes,
      { signal },
    )
    setProgress(0.25)

    const drawn: number[] = []
    const phases = new Float64Array(n)
    for (let t = 0; t < count; t++) {
      for (let k = 0; k < n; k++) phases[k] = digitToAngle(draw.digits[t * n + k] as number, base)
      drawn.push(resultantLength(phases))
      if ((t & 63) === 0) {
        setProgress(0.25 + (0.5 * t) / count)
        await tick()
      }
    }
    let controlSum = 0
    for (let t = 0; t < count; t++) {
      for (let k = 0; k < n; k++) {
        phases[k] = digitToAngle(controlDraw.digits[t * n + k] as number, base)
      }
      const r = resultantLength(phases)
      controlSum += r * r
      if ((t & 63) === 0) {
        setProgress(0.75 + (0.25 * t) / count)
        await tick()
      }
    }

    const previous = Boolean(append && meta.value && meta.value.n === n && meta.value.base === base)
    samples.value = previous ? [...samples.value, ...drawn] : drawn
    meta.value = {
      n,
      base,
      bytesUsed: (previous ? (meta.value?.bytesUsed ?? 0) : 0) + draw.bytesUsed,
      source: sourceSummary().providerName,
      controlMeanR2: controlSum / count,
      controlTrials: count,
      seedLabel,
    }
    setProgress(1)
    return samples.value.length
  })
}

const summary = computed(() => {
  const values = samples.value
  const info = meta.value
  if (!values.length || !info) return undefined
  const squares = values.map((r) => r * r)
  const { mean: meanR } = meanAndSd(values)
  const { mean: meanR2, sd: sdR2 } = meanAndSd(squares)
  const se = sdR2 / Math.sqrt(values.length)
  const expected = 1 / info.n
  const z = se > 0 ? (meanR2 - expected) / se : Number.NaN
  return { trials: values.length, meanR, meanR2, se, expected, z, p: twoSidedNormalP(z) }
})

const rayleigh = computed(() => {
  const n = meta.value?.n ?? 1
  return (x: number) => rayleighDensity(x, n)
})

onMounted(() => {
  // Beacons cost a round-trip per request; only local sources auto-run.
  if (!sourceSummary().network && parsedRate.value) start(false)
})

// A sample drawn for a different rate shape says nothing about this one.
watch(parsedRate, () => {
  samples.value = []
  meta.value = undefined
  task.reset()
})

const snippet = computed(() => {
  const s = stats.value
  return `import { circularMean, circularVariance, ratePhases, resultantLength } from '@mindpeeker/rate'

const phases = ratePhases(rate)      // one angle per ring
resultantLength(phases)              // ${fmtNum(s?.R ?? 0, { digits: 6 })} — concentration in [0, 1]
circularMean(phases)                 // ${fmtNum(s?.mean ?? 0, { digits: 6 })} rad — undefined as R̄ → 0
circularVariance(phases)             // ${fmtNum(s?.variance ?? 0, { digits: 6 })} = 1 − R̄

// Uniform digits are the b-th roots of unity, so E[e^{iθ}] = 0 exactly and
// E[R̄²] = 1/n for an n-ring rate — the reference the histogram is read against.`
})
</script>

<template>
  <DemoSection
    id="circular"
    title="Circular statistics"
    description="Angles do not average like numbers. The mean direction, the mean resultant length and the circular variance are the directional statistics of Mardia & Jupp, applied to the ring angles — and to random rates drawn from your selected source."
    :api="['circularMean', 'resultantLength', 'circularVariance', 'ratePhases']"
  >
    <template #controls>
      <UFormField label="Random rates per run" class="w-40">
        <UInputNumber v-model="trialCount" :min="20" :max="2000" :step="20" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!parsedRate"
        :label="`Draw ${clampCount(trialCount)} random rates`"
        :hint="byteHint"
        @run="start(false)"
        @cancel="task.cancel()"
      >
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-plus"
          :disabled="task.busy.value || !samples.length"
          @click="start(true)"
        >
          Add {{ clampCount(trialCount) }} more
        </UButton>
      </RunControls>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div v-if="stats" class="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <svg
            :viewBox="`0 0 ${stats.phasor.size} ${stats.phasor.size}`"
            class="mx-auto w-full max-w-[240px]"
            role="img"
            :aria-label="`Unit phasors for ${stats.phasor.spokes.length} ring angles with the mean resultant vector of length ${fmtNum(stats.R, { digits: 3 })}`"
          >
            <circle
              :cx="stats.phasor.cx"
              :cy="stats.phasor.cy"
              :r="stats.phasor.r"
              fill="none"
              stroke="var(--viz-grid)"
            />
            <line
              v-for="g in stats.phasor.gridAngles"
              :key="g.key"
              :x1="stats.phasor.cx"
              :y1="stats.phasor.cy"
              :x2="g.x"
              :y2="g.y"
              stroke="var(--viz-grid)"
              stroke-width="0.6"
            />
            <line
              v-for="spoke in stats.phasor.spokes"
              :key="spoke.key"
              :x1="stats.phasor.cx"
              :y1="stats.phasor.cy"
              :x2="spoke.x"
              :y2="spoke.y"
              stroke="var(--viz-1)"
              stroke-width="1.4"
              stroke-linecap="round"
            />
            <circle
              v-for="spoke in stats.phasor.spokes"
              :key="`dot-${spoke.key}`"
              :cx="spoke.x"
              :cy="spoke.y"
              r="3"
              fill="var(--viz-1)"
            />
            <template v-if="!stats.degenerate">
              <line
                :x1="stats.phasor.cx"
                :y1="stats.phasor.cy"
                :x2="stats.phasor.resultant.x"
                :y2="stats.phasor.resultant.y"
                stroke="var(--ui-primary)"
                stroke-width="2.5"
                stroke-linecap="round"
              />
              <polygon
                :points="stats.phasor.resultantHead.map((p) => `${p.x},${p.y}`).join(' ')"
                fill="var(--ui-primary)"
              />
            </template>
            <circle :cx="stats.phasor.cx" :cy="stats.phasor.cy" r="2.5" fill="var(--viz-axis)" />
          </svg>
          <p class="mt-2 text-center text-xs text-muted">
            Ring angles as unit phasors; the arrow is their mean, drawn at length R̄. Same convention
            as the card: 0 up, clockwise.
          </p>
        </div>

        <div class="flex flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="mean resultant length R̄"
              :value="stats.R"
              :digits="6"
              tone="primary"
              note="1 = every ring on one angle, 0 = perfectly balanced"
            />
            <StatTile
              label="circular mean θ̄"
              :value="`${fmtNum(stats.meanDeg, { digits: 3 })}°`"
              :tone="stats.degenerate ? 'warning' : 'neutral'"
              :note="
                stats.degenerate
                  ? 'R̄ ≈ 0 — the mean direction is undefined; atan2(0,0) returns 0'
                  : `${fmtNum(stats.mean, { digits: 6 })} rad, in [0, 2π)`
              "
            />
            <StatTile
              label="circular variance V"
              :value="stats.variance"
              :digits="6"
              note="V = 1 − R̄, matching scipy.stats.circvar"
            />
          </div>

          <div
            v-if="stats.exact"
            class="rounded-md border border-success/40 bg-success/5 p-3 text-sm"
          >
            <p class="font-medium text-success">
              Closed form for this rate: R̄ = {{ fmtNum(stats.exact.value, { digits: 6 }) }}
            </p>
            <p class="mt-1 text-muted">{{ stats.exact.why }}</p>
            <p class="mt-1 font-mono text-xs text-muted">
              computed {{ stats.R.toPrecision(17) }} · |difference| =
              {{ fmtNum(exactGap ?? 0, { digits: 2, exponential: true }) }}
              — floating point, not disagreement
            </p>
          </div>
          <p v-else class="text-sm text-muted">
            No closed form for this rate: R̄ is the defining formula
            <span class="font-mono">|Σ e^{iθ}|/n</span> evaluated in doubles. Try the
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              class="font-mono"
              @click="usePreset('aligned')"
            >
              7-7-7-7-7
            </UButton>
            and
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              class="font-mono"
              @click="usePreset('balanced')"
            >
              0-11-22-33
            </UButton>
            presets, which have one.
          </p>
        </div>
      </div>

      <div class="rounded-md border border-default p-3 sm:p-4">
        <h3 class="text-sm font-semibold text-highlighted">
          Random rates: what R̄ looks like when nothing is going on
        </h3>
        <p class="mt-1 text-sm text-muted">
          Each trial draws {{ ringsNow || 'n' }} uniform digits (rejection-sampled, so no modulo
          bias) and takes their resultant length. Uniform digits are the base-th roots of unity, so
          <span class="font-mono">E[e^{iθ}] = 0</span> exactly and
          <span class="font-mono">E[R̄²] = 1/n</span> exactly — an exact reference for any n, not an
          asymptotic one.
        </p>

        <div v-if="summary && meta" class="mt-3 flex flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="trials" :value="summary.trials" :digits="0" />
            <StatTile label="mean R̄" :value="summary.meanR" :digits="4" />
            <StatTile
              label="mean R̄²"
              :value="summary.meanR2"
              :digits="5"
              tone="primary"
              :note="`exact expectation 1/n = ${fmtNum(summary.expected, { digits: 5 })}`"
            />
            <StatTile
              label="z against 1/n"
              :value="summary.z"
              :digits="2"
              :tone="Math.abs(summary.z) > 3 ? 'warning' : 'success'"
              :note="`± ${fmtNum(summary.se, { digits: 5 })} Monte-Carlo SE`"
            />
          </div>
          <div class="flex flex-wrap items-center gap-3 text-sm">
            <PValue :p="summary.p" kind="pointwise" label="p" />
            <span class="text-muted">
              a uniformity check on the sampler over these trials, by the normal approximation —
              nothing about radionics is being tested here.
            </span>
          </div>

          <Histogram
            :values="samples"
            :bins="30"
            density
            :domain="[0, 1]"
            :reference="rayleigh"
            reference-label="Rayleigh approximation (large n)"
            :markers="[{ value: summary.meanR, label: 'mean R̄', color: 2 }]"
            x-label="mean resultant length R̄"
            y-label="density"
            :height="260"
            aria-label="Distribution of the mean resultant length over random rates"
          />

          <div class="flex flex-wrap items-center gap-2">
            <AccountingBadge :bytes-consumed="meta.bytesUsed" :source="meta.source" />
            <UBadge color="neutral" variant="subtle" class="font-mono text-[11px]">
              DRBG control arm: mean R̄² = {{ fmtNum(meta.controlMeanR2, { digits: 5 }) }} over
              {{ meta.controlTrials }} trials
            </UBadge>
          </div>
          <p class="text-xs text-muted">
            The control arm is a seeded HMAC_DRBG ("{{ meta.seedLabel }}"): the same seed and the
            same trial count always give that number again. Two arms agreeing near 1/n is what a
            working sampler looks like, on any source.
          </p>
        </div>
        <p v-else-if="!task.busy.value" class="mt-3 text-sm text-muted">
          Press Run to draw random rates for this rate's ring count. Changing the rate clears the
          sample — a run made for a different number of rings has a different 1/n reference.
        </p>
      </div>

      <HonestNote variant="exact">
        Everything on this card is ordinary directional statistics: R̄ ∈ [0, 1], V = 1 − R̄, and the
        mean direction from atan2. The Rayleigh curve is the large-n approximation and is drawn as a
        reference, not as the exact null for a five-ring rate; the 1/n line is exact for every n. A
        rate that happens to land at high R̄ is a rate whose digits happen to be close together —
        that is all it means.
      </HonestNote>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <template #footer>
      <code class="font-mono">circularMean</code> is undefined as R̄ → 0 and still returns
      atan2(0, 0) = 0 there, so gate on <code class="font-mono">resultantLength</code> before quoting
      a mean direction — the 0-11-22-33 preset is exactly that case.
    </template>
  </DemoSection>
</template>
