<script setup lang="ts">
/**
 * The Sun, the Moon and the next four principal phases for one
 * {@link ObserverSnapshot} — shared by the live clock and the date picker.
 * Presentational: it computes nothing, it only formats what `observe()`
 * already produced.
 */
import { dms, hms, type ObserverSnapshot, raHms, utc } from '~/lib/ephemeris/observer'
import { fmtNum } from '~/lib/format'

const props = defineProps<{ snapshot: ObserverSnapshot }>()

const sun = computed(() => props.snapshot.sun)
const moon = computed(() => props.snapshot.moon)
const illum = computed(() => props.snapshot.illumination)

const eot = computed(() => {
  const minutes = props.snapshot.equationOfTimeMinutes
  const sign = minutes < 0 ? '−' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${Math.floor(abs)}m ${((abs % 1) * 60).toFixed(1)}s`
})

const above = (altitude: number): string => (altitude >= 0 ? 'above the horizon' : 'below the horizon')
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-2">
    <!-- ── The Sun ─────────────────────────────────────────────────────── -->
    <!-- `min-w-0` on every card: grid items default to `min-width:auto`, so the
         phase table's `min-w-[34rem]` would otherwise size the whole column and
         pan the page sideways at 390 px instead of scrolling inside its own box. -->
    <div class="min-w-0 rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-sun" class="text-warning" />
        <h4 class="text-sm font-semibold text-highlighted">The Sun — <code class="font-mono text-xs text-primary">sunPosition(jde)</code></h4>
      </div>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt class="text-muted">apparent λ</dt>
        <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(sun.longitude, { digits: 5 }) }}°</dd>
        <dt class="text-muted">true ☉ / mean L₀</dt>
        <dd class="font-mono tabular-nums text-highlighted">
          {{ fmtNum(sun.trueLongitude, { digits: 4 }) }}° / {{ fmtNum(sun.meanLongitude, { digits: 4 }) }}°
        </dd>
        <dt class="text-muted">mean anomaly M</dt>
        <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(sun.meanAnomaly, { digits: 4 }) }}°</dd>
        <dt class="text-muted">right ascension α</dt>
        <dd class="font-mono tabular-nums text-highlighted">{{ raHms(sun.rightAscension) }}</dd>
        <dt class="text-muted">declination δ</dt>
        <dd class="font-mono tabular-nums text-highlighted">{{ dms(sun.declination) }}</dd>
        <dt class="text-muted">distance R</dt>
        <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(sun.distanceAu, { digits: 6 }) }} AU</dd>
        <dt class="text-muted">equation of time</dt>
        <dd class="font-mono tabular-nums text-highlighted">{{ eot }}</dd>
        <dt class="text-muted">hour angle H</dt>
        <dd class="font-mono tabular-nums text-highlighted">{{ hms(snapshot.sunHorizontal.hourAngleHours, 0) }}</dd>
        <dt class="text-muted">altitude / azimuth</dt>
        <dd class="font-mono tabular-nums" :class="snapshot.sunHorizontal.altitude >= 0 ? 'text-warning' : 'text-muted'">
          {{ fmtNum(snapshot.sunHorizontal.altitude, { digits: 2 }) }}° /
          {{ fmtNum(snapshot.sunHorizontal.azimuth, { digits: 1 }) }}°
        </dd>
      </dl>
      <p class="text-xs text-dimmed">
        The Sun is {{ above(snapshot.sunHorizontal.altitude) }}. Meeus ch. 25 “low accuracy”: within
        28″ in λ and 11″ in δ of astropy/ERFA over 1900–2100.
      </p>
    </div>

    <!-- ── The Moon ────────────────────────────────────────────────────── -->
    <div class="min-w-0 rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-moon" class="text-info" />
        <h4 class="text-sm font-semibold text-highlighted">
          The Moon — <code class="font-mono text-xs text-primary">moonPosition</code>
          <code class="font-mono text-xs text-primary">moonIllumination</code>
        </h4>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
        <EphemerisMoonDisk
          :illuminated-fraction="illum.illuminatedFraction"
          :bright-limb-angle="illum.brightLimbAngle"
          :size="116"
        />
        <dl class="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <dt class="text-muted">apparent λ</dt>
          <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(moon.longitude, { digits: 5 }) }}°</dd>
          <dt class="text-muted">latitude β</dt>
          <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(moon.latitude, { digits: 5 }) }}°</dd>
          <dt class="text-muted">distance Δ</dt>
          <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(moon.distanceKm, { digits: 0 }) }} km</dd>
          <dt class="text-muted">parallax π</dt>
          <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(moon.horizontalParallax, { digits: 5 }) }}°</dd>
          <dt class="text-muted">α / δ</dt>
          <dd class="font-mono tabular-nums text-highlighted">{{ raHms(moon.rightAscension) }} / {{ dms(moon.declination) }}</dd>
          <dt class="text-muted">phase angle i</dt>
          <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(illum.phaseAngle, { digits: 3 }) }}°</dd>
          <dt class="text-muted">illuminated k</dt>
          <dd class="font-mono tabular-nums text-info">{{ fmtNum(illum.illuminatedFraction, { digits: 4 }) }}</dd>
          <dt class="text-muted">elongation ψ</dt>
          <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(illum.elongation, { digits: 3 }) }}°</dd>
          <dt class="text-muted">λ − λ☉</dt>
          <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(illum.longitudeFromSun, { digits: 3 }) }}°</dd>
          <dt class="text-muted">altitude</dt>
          <dd class="font-mono tabular-nums text-highlighted">{{ fmtNum(snapshot.moonHorizontal.altitude, { digits: 2 }) }}°</dd>
        </dl>
      </div>
      <p class="text-xs text-dimmed">
        {{ illum.waxing ? 'Waxing' : 'Waning' }} — λ − λ☉ is
        {{ illum.waxing ? 'below' : 'at or above' }} 180°. The complete Meeus ch. 47 tables
        (60 + 60 terms) stay within 10.5″ of JPL DE440s over 1900–2100, and k within 0.0001.
      </p>
    </div>

    <!-- ── Phases ──────────────────────────────────────────────────────── -->
    <div class="min-w-0 rounded-md border border-default bg-elevated/30 p-3 lg:col-span-2">
      <div class="mb-2 flex items-center gap-2">
        <UIcon name="i-lucide-calendar-clock" class="text-muted" />
        <h4 class="text-sm font-semibold text-highlighted">
          Next principal phases — <code class="font-mono text-xs text-primary">nextMoonPhase(jde, phase)</code>
        </h4>
      </div>
      <div class="min-w-0 overflow-x-auto">
        <table class="w-full min-w-[34rem] text-sm">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-muted">
              <th class="py-1 pr-3 font-medium">phase</th>
              <th class="py-1 pr-3 font-medium">k</th>
              <th class="py-1 pr-3 font-medium">instant (UT)</th>
              <th class="py-1 pr-3 font-medium">JDE (TT)</th>
              <th class="py-1 font-medium">in</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in snapshot.phases" :key="row.phase" class="border-t border-default/70">
              <td class="py-1.5 pr-3 text-highlighted">{{ row.label }}</td>
              <td class="py-1.5 pr-3 font-mono tabular-nums text-muted">{{ row.k }}</td>
              <td class="py-1.5 pr-3 font-mono tabular-nums text-highlighted">{{ utc(row.date) }}</td>
              <td class="py-1.5 pr-3 font-mono tabular-nums text-muted">{{ fmtNum(row.jde, { digits: 5 }) }}</td>
              <td class="py-1.5 font-mono tabular-nums text-muted">{{ fmtNum(row.daysAway, { digits: 2 }) }} d</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-xs text-dimmed">
        The package returns each instant in TT; the UT column subtracts the same ΔT shown above
        (<code class="font-mono">universalJulianDay</code>). Against JPL DE440s the phase instants
        land within 12.6 s over 1950–2050, and they match PyMeeus to under 0.1 ms.
      </p>
    </div>
  </div>
</template>
