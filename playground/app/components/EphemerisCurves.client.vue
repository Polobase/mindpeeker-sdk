<script setup lang="ts">
/**
 * Section 4 — the shapes. The equation of time and the analemma over one year,
 * ΔT over five centuries, and the Moon's illuminated fraction over a lunation.
 * Everything here is a plot of a function, not of data.
 */
import {
  decimalYear,
  deltaT,
  equationOfTime,
  julianDay,
  julianEphemerisDay,
  moonIllumination,
  moonPhases,
  sunPosition,
} from '@mindpeeker/ephemeris'
import { PHASE_LABELS } from '~/lib/ephemeris/observer'
import { fmtNum } from '~/lib/format'

const year = ref(2026)
const lunationDays = ref(30)

const YEARS = [1900, 1950, 2000, 2026, 2050, 2100]

/** The equation of time and the Sun's declination, day by day. */
const solarYear = computed(() => {
  // A year outside the Julian-day domain throws `invalid_time`; report the
  // rejection and fall back to a valid year instead of crashing the page.
  let start = 0
  let days = 365
  let error: unknown
  try {
    start = julianDay({ year: year.value, month: 1, day: 1 })
    days = Math.round(julianDay({ year: year.value + 1, month: 1, day: 1 }) - start)
    julianEphemerisDay(start + days)
  } catch (err) {
    error = err
    start = julianDay({ year: 2026, month: 1, day: 1 })
    days = 365
  }
  const eot = new Float64Array(days)
  const dec = new Float64Array(days)
  const x = new Float64Array(days)
  for (let d = 0; d < days; d++) {
    const jde = julianEphemerisDay(start + d)
    eot[d] = equationOfTime(jde)
    dec[d] = sunPosition(jde).declination
    x[d] = d + 1
  }
  let minIndex = 0
  let maxIndex = 0
  for (let d = 1; d < days; d++) {
    if ((eot[d] as number) < (eot[minIndex] as number)) minIndex = d
    if ((eot[d] as number) > (eot[maxIndex] as number)) maxIndex = d
  }
  return { days, eot, dec, x, minIndex, maxIndex, error }
})

const yearError = computed(() => solarYear.value.error)

const analemma = computed(() => {
  const { days, eot, dec } = solarYear.value
  const points: [number, number][] = []
  for (let d = 0; d < days; d++) points.push([eot[d] as number, dec[d] as number])
  return points
})

/** ΔT from 1600 to 2150, in half-year steps. */
const deltaTCurve = computed(() => {
  const years: number[] = []
  const values: number[] = []
  for (let y = 1600; y <= 2150; y += 0.5) {
    years.push(y)
    values.push(deltaT(y))
  }
  return { years, values }
})

const todayYear = computed(() => decimalYear(julianDay(new Date())))
const todayDeltaT = computed(() => deltaT(todayYear.value))

/** Illuminated fraction over the next `lunationDays`, at 6-hour steps. */
const lunation = computed(() => {
  const startJde = julianEphemerisDay(julianDay(new Date()))
  const steps = lunationDays.value * 4
  const k = new Float64Array(steps + 1)
  const x = new Float64Array(steps + 1)
  for (let i = 0; i <= steps; i++) {
    const jde = startJde + i / 4
    k[i] = moonIllumination(jde).illuminatedFraction
    x[i] = i / 4
  }
  const events = moonPhases(startJde, startJde + lunationDays.value).map((event) => ({
    value: event.jde - startJde,
    label: PHASE_LABELS[event.phase],
    color: 'muted' as const,
  }))
  return { k, x, events, startJde }
})

const snippet = computed(
  () => `import {
  deltaT, equationOfTime, julianDay, julianEphemerisDay, moonIllumination, moonPhases, sunPosition,
} from '@mindpeeker/ephemeris'

// One year of the equation of time and the Sun's declination (the analemma).
const start = julianDay({ year: ${year.value}, month: 1, day: 1 })
for (let d = 0; d < 365; d++) {
  const jde = julianEphemerisDay(start + d)     // UT → TT, with ΔT
  equationOfTime(jde)                           // minutes, Meeus 28.3
  sunPosition(jde).declination                  // degrees
}

deltaT(${fmtNum(todayYear.value, { digits: 2 })})                              // ${fmtNum(todayDeltaT.value, { digits: 1 })} s today
moonIllumination(jde).illuminatedFraction       // k = (1 + cos i)/2
moonPhases(jde, jde + ${lunationDays.value})                     // every principal phase in the span`,
)
</script>

<template>
  <DemoSection
    id="curves"
    title="4 · The shapes — equation of time, the analemma, ΔT, one lunation"
    description="The same functions, evaluated over a range instead of at an instant. Nothing here is measured: each curve is a closed-form series plotted point by point."
    :api="['equationOfTime', 'sunPosition', 'deltaT', 'decimalYear', 'moonIllumination', 'moonPhases']"
  >
    <template #controls>
      <UFormField label="Year" size="sm" class="w-32">
        <UInput v-model.number="year" type="number" step="1" min="1600" max="2150" class="w-full" />
      </UFormField>
      <div class="flex flex-wrap gap-1.5 pb-1">
        <UButton
          v-for="y in YEARS"
          :key="y"
          size="xs"
          variant="soft"
          color="neutral"
          @click="year = y"
        >{{ y }}</UButton>
      </div>
    </template>

    <ErrorAlert :err="yearError" title="The package rejected that year" :dismissible="false" />

    <div class="flex flex-col gap-6">
      <!-- Equation of time -->
      <div>
        <h4 class="mb-1 text-sm font-semibold text-highlighted">
          The equation of time over {{ year }} — apparent solar time minus mean solar time
        </h4>
        <LineChart
          :series="[{ name: 'equation of time', y: solarYear.eot, x: solarYear.x, color: 1 }]"
          :hlines="[{ value: 0, label: 'sundial agrees with the clock' }]"
          x-label="day of the year"
          y-label="minutes"
          :height="240"
          :format="(v) => `${v.toFixed(2)} min`"
          aria-label="Equation of time over one year"
        />
        <div class="mt-2 grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Earliest sundial"
            size="sm"
            :value="`${fmtNum(solarYear.eot[solarYear.minIndex], { digits: 2 })} min`"
            :note="`day ${solarYear.minIndex + 1} of ${year}`"
          />
          <StatTile
            label="Latest sundial"
            size="sm"
            :value="`+${fmtNum(solarYear.eot[solarYear.maxIndex], { digits: 2 })} min`"
            :note="`day ${solarYear.maxIndex + 1} of ${year}`"
          />
          <StatTile
            label="Checked against"
            size="sm"
            value="3.2 s"
            note="largest difference from GAST − apparent solar RA (ERFA), 1900–2100"
          />
        </div>
      </div>

      <!-- Analemma -->
      <div>
        <h4 class="mb-1 text-sm font-semibold text-highlighted">
          The analemma — the same year as declination against the equation of time
        </h4>
        <LineChart
          :series="[{ name: `analemma ${year}`, points: analemma, color: 2 }]"
          :hlines="[{ value: 0, label: 'equator' }]"
          :vlines="[{ value: 0 }]"
          x-label="equation of time (minutes)"
          y-label="declination of the Sun (degrees)"
          :height="300"
          :format="(v) => v.toFixed(2)"
          aria-label="Analemma: the Sun's declination against the equation of time over one year"
        />
        <p class="mt-1 text-xs text-muted">
          The figure-of-eight a sundial traces at a fixed clock time. Its width is the equation of
          time (obliquity plus eccentricity), its height twice the obliquity of the ecliptic —
          {{ fmtNum(2 * Math.max(...Array.from(solarYear.dec)), { digits: 2 }) }}° across here.
        </p>
      </div>

      <!-- Delta T -->
      <div>
        <h4 class="mb-1 text-sm font-semibold text-highlighted">
          ΔT = TT − UT, 1600 to 2150 — Espenak &amp; Meeus polynomials
        </h4>
        <LineChart
          :series="[{ name: 'ΔT', y: deltaTCurve.values, x: deltaTCurve.years, color: 4 }]"
          :vlines="[{ value: 2005, label: 'fitted up to here' }, { value: todayYear, label: 'today', color: 'primary' }]"
          :hlines="[{ value: 0 }]"
          x-label="year"
          y-label="seconds"
          :height="240"
          :format="(v) => `${v.toFixed(1)} s`"
          aria-label="Delta T from 1600 to 2150"
        />
        <div class="mt-2 grid gap-3 sm:grid-cols-3">
          <StatTile label="ΔT today" :value="`${fmtNum(todayDeltaT, { digits: 2 })} s`" size="sm" tone="warning" :note="`decimal year ${fmtNum(todayYear, { digits: 3 })}`" />
          <StatTile label="ΔT in 1700" :value="`${fmtNum(deltaT(1700), { digits: 1 })} s`" size="sm" note="the Earth's rotation is not a clock" />
          <StatTile label="Checked against" size="sm" value="0.97 s" note="largest difference from IERS-B, 1962.5–2004.5" />
        </div>
      </div>

      <!-- Lunation -->
      <div>
        <div class="mb-1 flex flex-wrap items-center gap-3">
          <h4 class="text-sm font-semibold text-highlighted">
            The Moon's illuminated fraction, starting now
          </h4>
          <UFormField label="Span" size="sm" class="w-32">
            <USelect
              v-model="lunationDays"
              :items="[{ label: '15 days', value: 15 }, { label: '30 days', value: 30 }, { label: '60 days', value: 60 }]"
              class="w-full"
            />
          </UFormField>
        </div>
        <LineChart
          :series="[{ name: 'illuminated fraction k', y: lunation.k, x: lunation.x, color: 3 }]"
          :vlines="lunation.events"
          :hlines="[{ value: 0.5, label: 'half lit' }]"
          x-label="days from now"
          y-label="k = (1 + cos i) / 2"
          :height="240"
          :y-domain="[0, 1]"
          :format="(v) => v.toFixed(3)"
          aria-label="Illuminated fraction of the Moon over the coming weeks"
        />
        <p class="mt-1 text-xs text-muted">
          The vertical lines are the instants <code class="font-mono">moonPhases</code> solves for —
          the roots of λ − λ☉ = 0°, 90°, 180°, 270°. k reaches 0 and 1 there only approximately,
          because k is a geometric quantity and the phase is an angular one.
        </p>
      </div>

      <HonestNote variant="exact">
        Four plots of four closed-form series. The only input is the year you chose and, for the
        lunation, this tab's clock.
      </HonestNote>

      <CodeSnippet :code="snippet" title="what these four charts ran" />
    </div>

    <template #footer>
      ΔT is the one curve with a soft edge: it is fitted to observations up to about 2005 and
      extrapolated after that, so the right-hand end is a model, not a measurement.
    </template>
  </DemoSection>
</template>
