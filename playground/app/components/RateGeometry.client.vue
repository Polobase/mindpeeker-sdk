<script setup lang="ts">
import {
  convertBase,
  type DialConversion,
  dialToBase44,
  digitToAngle,
  digitToDegrees,
  formatRate,
  radiansToDegrees,
  ratePhases,
} from '@mindpeeker/rate'
import { fmtNum } from '~/lib/format'
import { exactDegrees, exactRadians, ulpsBetween } from '~/lib/rate/exact'
import { oneBased, parsedRate, rateBase, rateForms } from '~/lib/rate/state'

/** Digit → angle, and what a change of base costs in radians. */

const rows = computed(() => {
  const rate = parsedRate.value
  if (!rate) return []
  const phases = ratePhases(rate)
  return rate.digits.map((digit, i) => ({
    ring: i + 1,
    digit,
    label: digit + 1,
    rad: phases[i] as number,
    deg: digitToDegrees(digit, rate.base),
    exactDeg: exactDegrees(digit, rate.base),
    exactRad: exactRadians(digit, rate.base),
    agrees: (phases[i] as number) === digitToAngle(digit, rate.base),
  }))
})

const allAgree = computed(() => rows.value.length > 0 && rows.value.every((r) => r.agrees))

/** Digits that land on an exact quarter turn — the README's 1-ulp claim, live. */
const quarterChecks = computed(() => {
  const base = parsedRate.value?.base ?? rateBase.value
  const targets = [
    { name: 'π/2', value: Math.PI / 2, fraction: 0.25 },
    { name: 'π', value: Math.PI, fraction: 0.5 },
    { name: '3π/2', value: (3 * Math.PI) / 2, fraction: 0.75 },
  ]
  return targets.flatMap((t) => {
    const digit = base * t.fraction
    if (!Number.isInteger(digit)) return []
    const got = digitToAngle(digit, base)
    return [
      {
        ...t,
        digit,
        got,
        ulps: ulpsBetween(got, t.value),
        identical: got === t.value,
      },
    ]
  })
})

const showAllDigits = ref(false)
const fullMap = computed(() => {
  const base = parsedRate.value?.base ?? rateBase.value
  return Array.from({ length: base }, (_, d) => ({
    digit: d,
    label: d + 1,
    deg: digitToDegrees(d, base),
  }))
})

// --- base conversion ---------------------------------------------------------
const targetBase = ref(10)
watch(
  () => parsedRate.value?.base ?? rateBase.value,
  (base) => {
    targetBase.value = base === 44 ? 10 : 44
  },
)

const conversion = computed<{
  ok?: {
    conv: DialConversion
    text: string
    backText: string
    roundTrips: boolean
    maxErrorDeg: number
    boundRad: number
    boundDeg: number
    withinBound: boolean
  }
  error?: unknown
}>(() => {
  const rate = parsedRate.value
  const target = Math.trunc(targetBase.value ?? 0)
  if (!rate) return {}
  try {
    const conv = convertBase(rate, target)
    const back = convertBase(conv.rate, rate.base)
    const boundRad = Math.PI / target
    return {
      ok: {
        conv,
        text: formatRate(conv.rate),
        backText: formatRate(back.rate),
        roundTrips: back.rate.digits.every((d, i) => d === rate.digits[i]),
        maxErrorDeg: radiansToDegrees(conv.maxErrorRad),
        boundRad,
        boundDeg: radiansToDegrees(boundRad),
        // Half a target step, proven in the README — never an empirical claim.
        withinBound: conv.maxErrorRad <= boundRad + 1e-12,
      },
    }
  } catch (error) {
    return { error }
  }
})

/** The README's own dial example, computed live rather than quoted. */
const dialExample = computed(() => {
  const conv = dialToBase44([1, 1, 1, 4, 8])
  return {
    text: formatRate(conv.rate),
    deg: radiansToDegrees(conv.maxErrorRad),
    boundDeg: 180 / 44,
  }
})

/** Max error against target base — always under the π/b bound, for any rate. */
const sweep = computed(() => {
  const rate = parsedRate.value
  if (!rate) return undefined
  const bases: number[] = []
  const bound: number[] = []
  const actual: number[] = []
  for (let b = 2; b <= 64; b++) {
    bases.push(b)
    bound.push(180 / b)
    actual.push(radiansToDegrees(convertBase(rate, b).maxErrorRad))
  }
  return { bases, bound, actual }
})

const snippet = computed(() => {
  const base = parsedRate.value?.base ?? rateBase.value
  const target = Math.trunc(targetBase.value ?? 0)
  return `import { convertBase, dialToBase44, digitToAngle, digitToDegrees, parseRate, ratePhases } from '@mindpeeker/rate'

const rate = parseRate('${rateForms.value?.canonical ?? '12-33-7'}', { base: ${base} })
ratePhases(rate)                    // Float64Array, one ring angle per digit
digitToAngle(${rows.value[0]?.digit ?? 0}, ${base})                  // ${fmtNum(rows.value[0]?.rad ?? 0, { digits: 6 })} rad
digitToDegrees(${rows.value[0]?.digit ?? 0}, ${base})                // ${fmtNum(rows.value[0]?.deg ?? 0, { digits: 4 })}°

const { rate: converted, maxErrorRad } = convertBase(rate, ${target})
maxErrorRad <= Math.PI / ${target}   // ${conversion.value.ok?.withinBound ?? '—'} — half a target step, proven
dialToBase44([1, 1, 1, 4, 8])       // base-10 dial → base 44, '${dialExample.value.text}'`
})
</script>

<template>
  <DemoSection
    id="geometry"
    title="Geometry"
    description="Every digit is an angle and nothing else: θ_d = d · 2π/base. That map is this package's model, not a scan of an original card — the table below gives the exact rational angle beside the double the code returns."
    :api="['digitToAngle', 'digitToDegrees', 'ratePhases', 'convertBase', 'dialToBase44']"
  >
    <div class="flex flex-col gap-4">
      <div v-if="!parsedRate" class="text-sm text-muted">
        Fix the rate above and the angle table returns.
      </div>

      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[34rem] text-sm">
            <caption class="sr-only">
              Digit to angle for every ring of the current rate
            </caption>
            <thead>
              <tr class="text-xs uppercase text-dimmed">
                <th scope="col" class="py-1.5 pr-3 text-left font-medium">Ring</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Digit</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Book label</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Exact degrees</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">digitToDegrees</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Exact radians</th>
                <th scope="col" class="py-1.5 pl-3 text-right font-medium">digitToAngle</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.ring" class="border-t border-default">
                <td class="py-1.5 pr-3 text-muted">#{{ row.ring }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-highlighted">{{ row.digit }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted">{{ row.label }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted">{{ row.exactDeg }}°</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ fmtNum(row.deg, { digits: 4 }) }}°</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted">{{ row.exactRad }}</td>
                <td class="py-1.5 pl-3 text-right font-mono">{{ fmtNum(row.rad, { digits: 6 }) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-sm">
          <UBadge :color="allAgree ? 'success' : 'error'" variant="subtle">
            <UIcon :name="allAgree ? 'i-lucide-check' : 'i-lucide-x'" class="size-3" />
            ratePhases matches digitToAngle on every ring
          </UBadge>
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            icon="i-lucide-list"
            @click="showAllDigits = !showAllDigits"
          >
            {{ showAllDigits ? 'Hide' : 'Show' }} all {{ fullMap.length }} digits of base
            {{ parsedRate.base }}
          </UButton>
        </div>

        <div v-if="showAllDigits" class="flex flex-wrap gap-1">
          <span
            v-for="entry in fullMap"
            :key="entry.digit"
            class="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-muted"
            :title="`${oneBased ? `book label ${entry.label}, ` : ''}digit ${entry.digit}`"
          >
            {{ entry.digit }}→{{ fmtNum(entry.deg, { digits: 2 }) }}°
          </span>
        </div>

        <div v-if="quarterChecks.length" class="rounded-md border border-default bg-elevated/40 p-3">
          <p class="text-xs uppercase tracking-wide text-dimmed">
            Floating point, checked — not asserted
          </p>
          <ul class="mt-2 flex flex-col gap-1 text-sm">
            <li v-for="check in quarterChecks" :key="check.name" class="font-mono text-muted">
              digitToAngle({{ check.digit }}, {{ parsedRate.base }}) =
              <span class="text-highlighted">{{ check.got.toPrecision(17) }}</span>
              vs {{ check.name }} =
              <span class="text-highlighted">{{ check.value.toPrecision(17) }}</span>
              →
              <span :class="check.ulps === 0 ? 'text-success' : 'text-warning'">
                {{ check.ulps }} ulp{{ check.ulps === 1 ? '' : 's' }}
              </span>
            </li>
          </ul>
          <p class="mt-2 text-xs text-muted">
            The exact arithmetic is exact; the doubles are one representable step apart at worst.
            Compare angles with a tolerance, never with <code class="font-mono">===</code>.
          </p>
        </div>

        <HonestNote variant="caveat" title="Modeled, not sourced">
          The sources confirm concentric rings carrying radial lines, and a 2024 practitioner design
          document gives 360/44 ≈ 8.18° per base-44 step. No source we found attributes the
          per-digit formula θ_d = d · 2π/44, the digit ↔ ring assignment, or the ring spacing to Rae.
          They are this package's clean parameterisation — which is exactly why the base is an
          argument everywhere rather than a constant.
        </HonestNote>

        <div class="rounded-md border border-default p-3 sm:p-4">
          <div class="flex flex-wrap items-end gap-3">
            <UFormField label="Target base" hint="nearest-angle projection" class="w-40">
              <UInputNumber v-model="targetBase" :min="2" :max="360" class="w-full" />
            </UFormField>
            <div class="flex flex-wrap gap-1.5 pb-1">
              <UButton
                v-for="b in [10, 22, 44, 100, 360]"
                :key="b"
                size="xs"
                color="neutral"
                variant="subtle"
                class="font-mono"
                @click="targetBase = b"
              >
                {{ b }}
              </UButton>
            </div>
          </div>

          <ErrorAlert :err="conversion.error" :dismissible="false" title="Conversion rejected" />

          <div v-if="conversion.ok" class="mt-3 flex flex-col gap-3">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Converted rate"
                :value="conversion.ok.text"
                tone="primary"
                :note="`base ${parsedRate.base} → ${targetBase}`"
              />
              <StatTile
                label="max angular error"
                :value="`${fmtNum(conversion.ok.maxErrorDeg, { digits: 4 })}°`"
                :note="`${fmtNum(conversion.ok.conv.maxErrorRad, { digits: 6 })} rad — the largest move any digit made`"
              />
              <StatTile
                label="proven bound π/b"
                :value="`${fmtNum(conversion.ok.boundDeg, { digits: 4 })}°`"
                tone="success"
                note="half a target step — never exceeded, for any rate"
              />
              <StatTile
                label="round trip"
                :value="conversion.ok.roundTrips ? 'recovers the rate' : conversion.ok.backText"
                :tone="conversion.ok.roundTrips ? 'success' : 'warning'"
                note="convert back to the source base"
              />
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <UBadge :color="conversion.ok.withinBound ? 'success' : 'error'" variant="subtle">
                <UIcon
                  :name="conversion.ok.withinBound ? 'i-lucide-check' : 'i-lucide-x'"
                  class="size-3"
                />
                maxErrorRad ≤ π/{{ targetBase }}
              </UBadge>
              <span class="text-xs text-muted">
                Refining (10 → 44) is near-lossless; coarsening (44 → 10) throws resolution away and
                the report says exactly how much.
              </span>
            </div>

            <LineChart
              v-if="sweep"
              :series="[
                { name: 'max error for this rate', y: sweep.actual, color: 1 },
                { name: 'proven bound 180°/b', y: sweep.bound, color: 2, dashed: true },
              ]"
              :x="sweep.bases"
              :vlines="[{ value: targetBase, label: 'target' }]"
              x-label="target base"
              y-label="degrees"
              :height="240"
              aria-label="Maximum angular conversion error against target base, always below the half-step bound"
            />

            <p class="text-sm text-muted">
              <code class="font-mono">dialToBase44([1, 1, 1, 4, 8])</code> — the README's De La Warr
              example — gives
              <code class="font-mono text-highlighted">{{ dialExample.text }}</code> with a maximum
              move of {{ fmtNum(dialExample.deg, { digits: 4 }) }}°, under the
              {{ fmtNum(dialExample.boundDeg, { digits: 4 }) }}° bound for base 44. It is
              <code class="font-mono">convertBase</code> with <code class="font-mono">fromBase</code>
              10 and <code class="font-mono">toBase</code> 44, named for the historical move Rae made.
            </p>
          </div>
        </div>

        <CodeSnippet :code="snippet" title="what this section ran" />
      </template>
    </div>

    <template #footer>
      Rounding is
      <code class="font-mono">d' = ⌊d · b_tgt/b_src + ½⌋ mod b_tgt</code>, so each digit lands on the
      nearest of b_tgt equally spaced steps and cannot move further than half a step, π/b_tgt. That
      bound is a theorem about the formula, not a measurement of these rates.
    </template>
  </DemoSection>
</template>
