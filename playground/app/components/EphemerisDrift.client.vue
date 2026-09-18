<script setup lang="ts">
/**
 * Section 5 — the bridge into the LST analyses. A fixed clock hour maps to a
 * sidereal hour that slides through the whole day over a year, so the sidereal
 * coordinate of a session is a function of its clock time and its date. That is
 * the confound the next four sections have to live with, drawn before any test
 * is run.
 */
import { julianDay, lst } from '@mindpeeker/ephemeris'
import { LABS } from '~/lib/ephemeris/lab'
import { fmtNum } from '~/lib/format'

const labId = ref('edinburgh')
const spanDays = ref(365)

const SPANS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '182 days', value: 182 },
  { label: '365 days', value: 365 },
  { label: '730 days (2 years)', value: 730 },
]
const CLOCK_HOURS = [9, 13, 17]
const START = Date.UTC(2024, 0, 1)

const lon = computed(() => LABS.find((l) => l.id === labId.value)?.lon ?? 0)
const labItems = LABS.map((l) => ({ label: `${l.name} (λ = ${l.lon}°)`, value: l.id }))

/** LST at three fixed local clock hours, day by day through one year. */
const ramps = computed(() => {
  const jd0 = julianDay(new Date(START))
  const days = 365
  const x = new Float64Array(days)
  const series = CLOCK_HOURS.map(() => new Float64Array(days))
  for (let d = 0; d < days; d++) {
    x[d] = d + 1
    CLOCK_HOURS.forEach((hour, s) => {
      const jd = jd0 + d + (hour - lon.value / 15) / 24
      ;(series[s] as Float64Array)[d] = lst(jd, lon.value)
    })
  }
  return { x, series }
})

/** How the sidereal hours of 09:00–17:00 sessions fill up over a span. */
const coverage = computed(() => {
  const jd0 = julianDay(new Date(START))
  const counts = new Float64Array(24)
  let total = 0
  for (let d = 0; d < spanDays.value; d++) {
    for (let minute = 9 * 60; minute < 17 * 60; minute += 30) {
      const jd = jd0 + d + (minute / 60 - lon.value / 15) / 24
      const hours = lst(jd, lon.value)
      counts[Math.min(23, Math.floor(hours))] += 1
      total += 1
    }
  }
  const fraction = new Float64Array(24)
  let emptiest = 0
  let fullest = 0
  for (let h = 0; h < 24; h++) {
    fraction[h] = (counts[h] as number) / total
    if ((fraction[h] as number) < (fraction[emptiest] as number)) emptiest = h
    if ((fraction[h] as number) > (fraction[fullest] as number)) fullest = h
  }
  return { fraction, total, emptiest, fullest }
})

const categories = Array.from({ length: 24 }, (_, h) => String(h))

const snippet = computed(
  () => `import { julianDay, lst } from '@mindpeeker/ephemeris'

const lon = ${lon.value}                     // east-positive degrees
const jd0 = julianDay(new Date(Date.UTC(2024, 0, 1)))

// The same wall-clock hour, day after day, is a different sidereal hour.
for (let day = 0; day < ${spanDays.value}; day++) {
  const jd = jd0 + day + (13 - lon / 15) / 24   // 13:00 local mean solar time
  lst(jd, lon)                                  // slides ≈ 3 min 56 s per day
}`,
)
</script>

<template>
  <DemoSection
    id="drift"
    title="5 · Why sidereal time is not just another clock"
    description="Local sidereal time is GMST + λ/15, and GMST advances 360.9856° per day instead of 360°. A session booked for the same hour every week therefore walks through every sidereal hour over a year — which is exactly why an effect that depends on season, or on time of day, can arrive disguised as an effect that depends on sidereal time."
    :api="['lst', 'julianDay']"
  >
    <template #controls>
      <UFormField label="Observer" size="sm" class="min-w-56">
        <USelect v-model="labId" :items="labItems" class="w-full" />
      </UFormField>
      <UFormField label="Recruitment span" size="sm" class="w-48">
        <USelect v-model="spanDays" :items="SPANS" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-5">
      <div>
        <h4 class="mb-1 text-sm font-semibold text-highlighted">
          LST at three fixed local clock hours over 2024
        </h4>
        <LineChart
          :series="[
            { name: '09:00 local', y: ramps.series[0], x: ramps.x, color: 1 },
            { name: '13:00 local', y: ramps.series[1], x: ramps.x, color: 2 },
            { name: '17:00 local', y: ramps.series[2], x: ramps.x, color: 3 },
          ]"
          x-label="day of the year"
          y-label="local sidereal time (hours)"
          :y-domain="[0, 24]"
          :height="260"
          :format="(v) => `${v.toFixed(2)} h`"
          aria-label="Local sidereal time at three fixed clock hours across a year"
        />
        <p class="mt-1 text-xs text-muted">
          Each line climbs about 3 min 56 s a day and wraps once. Read it the other way round: fix a
          sidereal hour, and you have fixed a narrow band of (clock hour × date) pairs.
        </p>
      </div>

      <div>
        <h4 class="mb-1 text-sm font-semibold text-highlighted">
          Which sidereal hours a 09:00–17:00 schedule actually visits in {{ spanDays }} days
        </h4>
        <BarChart
          :categories="categories"
          :values="coverage.fraction"
          :expected="1 / 24"
          expected-label="uniform coverage (1/24)"
          :color="4"
          x-label="local sidereal hour"
          y-label="fraction of sessions"
          :height="230"
          :format="(v) => `${(v * 100).toFixed(2)} %`"
          aria-label="Fraction of daytime sessions falling in each sidereal hour"
        />
        <div class="mt-2 grid gap-3 sm:grid-cols-4">
          <StatTile label="Sessions enumerated" :value="coverage.total" :digits="0" size="sm" note="every 30 min, 09:00–17:00 local" />
          <StatTile
            label="Fullest sidereal hour"
            size="sm"
            :value="`${coverage.fullest}h — ${fmtNum(coverage.fraction[coverage.fullest] * 100, { digits: 2 })} %`"
            tone="warning"
          />
          <StatTile
            label="Emptiest sidereal hour"
            size="sm"
            :value="`${coverage.emptiest}h — ${fmtNum(coverage.fraction[coverage.emptiest] * 100, { digits: 2 })} %`"
          />
          <StatTile label="Uniform would be" value="4.17 %" size="sm" note="1/24 of the sessions in each hour" />
        </div>
        <p class="mt-2 text-xs text-muted">
          Over a full year the coverage is near-uniform; shorten the span to 30 or 90 days and half
          the sidereal day is never sampled at all. A peak found inside a short campaign is then a
          statement about which weeks the lab was busy.
        </p>
      </div>

      <HonestNote variant="caveat" title="This is the confound, stated as geometry">
        LST is a linear function of local solar time and day of the year. Spottiswoode said so
        himself in 1997: “some undiscovered systematic relationship between effect size and these
        variables might be responsible for the observed peak”. He did remove the means of one-hour
        clock-time bins and reported the LST plot “virtually indistinguishable” — but that check
        does not cover the season, and Sturrock &amp; Spottiswoode (2007) later found a seasonal
        variation in the same database which, in Ryan's words (2008, p. 337), “will, at least
        partly, explain the shape of the LST graph”. Section 10 below turns that sentence into a
        stratified permutation test you can run.
      </HonestNote>

      <CodeSnippet :code="snippet" title="what these two charts ran" />
    </div>

    <template #footer>
      Nothing here is data. Both charts enumerate a schedule and convert it, so the only inputs are
      the longitude and the span you picked.
    </template>
  </DemoSection>
</template>
