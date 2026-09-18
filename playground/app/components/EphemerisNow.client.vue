<script setup lang="ts">
/**
 * Section 1 — the live clock. One observer, one tick a second, and every time
 * scale the package computes: UT → Julian day → ΔT → TT, then Greenwich mean
 * and apparent sidereal time, local sidereal time and local mean solar time.
 */
import { hms, observe, type ObserverSnapshot, PLACES, raHms, utc } from '~/lib/ephemeris/observer'
import { locateObserver, setPlace, useObserverPlace } from '~/lib/ephemeris/place'
import { fmtNum } from '~/lib/format'

const place = useObserverPlace()
const now = ref(new Date())
const frozen = ref(false)
const locating = ref(false)
const geoError = ref<unknown>(undefined)

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (!frozen.value) now.value = new Date()
  }, 1000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

/** The presets, plus whatever the coordinates currently are when they match none. */
const placeItems = computed(() => {
  const base: { label: string; value: string }[] = PLACES.map((p) => ({
    label: String(p.label),
    value: String(p.label),
  }))
  if (!PLACES.some((p) => p.label === place.label)) {
    base.unshift({ label: place.label, value: place.label })
  }
  return base
})
// Typing into the longitude or latitude field means the preset no longer applies;
// choosing a preset or reading a geolocation fix sets all three fields at once.
let programmatic = false
function applyPlace(lon: number, lat: number, label: string): void {
  programmatic = true
  setPlace(lon, lat, label)
  nextTick(() => {
    programmatic = false
  })
}
watch(
  () => [place.longitudeEastDeg, place.latitudeDeg],
  () => {
    if (programmatic) return
    if (!PLACES.some((p) => p.lon === place.longitudeEastDeg && p.lat === place.latitudeDeg)) {
      place.label = 'custom coordinates'
    }
  },
)

const placeChoice = computed({
  get: () => place.label,
  set: (label: string) => {
    const found = PLACES.find((p) => p.label === label)
    if (found) applyPlace(found.lon, found.lat, found.label)
  },
})

/** `observe` throws EphemerisError on a non-finite longitude — show it, never throw. */
const computedSnapshot = computed<{ snapshot?: ObserverSnapshot; error?: unknown }>(() => {
  try {
    return { snapshot: observe(now.value, place.longitudeEastDeg, place.latitudeDeg) }
  } catch (error) {
    return { error }
  }
})
const snap = computed(() => computedSnapshot.value.snapshot)
const inputError = computed(() => computedSnapshot.value.error)

const hands = computed(() => {
  const s = snap.value
  if (!s) return []
  return [
    { hours: s.lstMeanHours, label: 'local sidereal time', color: 1 },
    { hours: s.localMeanSolarHours, label: 'local mean solar time', color: 2 },
    { hours: s.gmstHours, label: 'Greenwich sidereal time', color: 4 },
    { hours: s.sun.rightAscension / 15, label: 'Sun α (tick)', color: 3, tick: true },
  ]
})

async function useMyLocation(): Promise<void> {
  locating.value = true
  geoError.value = undefined
  try {
    const fix = await locateObserver()
    applyPlace(fix.longitudeEastDeg, fix.latitudeDeg, fix.label)
  } catch (error) {
    geoError.value = error
  } finally {
    locating.value = false
  }
}

const snippet = `import {
  deltaT, decimalYear, gast, gmst, julianDay, julianEphemerisDay,
  localMeanSolarTime, lst, toSexagesimal,
} from '@mindpeeker/ephemeris'

const jd = julianDay(new Date())            // UT Julian day
const dt = deltaT(decimalYear(jd))          // ΔT in seconds
const jde = julianEphemerisDay(jd, dt)      // TT — what the Sun and Moon take

gmst(jd)                                    // Greenwich mean sidereal time, hours
gast(jd)                                    // …apparent: GMST + Δψ cos ε
lst(jd, longitudeEastDeg)                   // GMST + λ/15
lst(jd, longitudeEastDeg, { sidereal: 'apparent' })
localMeanSolarTime(jd, longitudeEastDeg)    // UT + λ/15, for clock-time strata
toSexagesimal(lst(jd, longitudeEastDeg))    // { sign, whole, minutes, seconds }`
</script>

<template>
  <DemoSection
    id="now"
    title="1 · Now — one observer, every time scale"
    description="A clock that ticks once a second through the whole chain: a UTC reading becomes a Julian day, ΔT turns it into Terrestrial Time, and the sidereal formulas turn it into the right ascension standing on your meridian. Longitudes are east-positive, the convention the package uses everywhere (Meeus writes them west-positive)."
    :api="['julianDay', 'deltaT', 'julianEphemerisDay', 'gmst', 'gast', 'lst', 'localMeanSolarTime', 'equationOfTheEquinoxes', 'toSexagesimal']"
  >
    <template #controls>
      <UFormField label="Place" size="sm" class="min-w-52">
        <USelect v-model="placeChoice" :items="placeItems" class="w-full" />
      </UFormField>
      <UFormField label="Longitude (east +)" size="sm" class="w-36">
        <UInput v-model.number="place.longitudeEastDeg" type="number" step="0.01" min="-180" max="180" class="w-full" />
      </UFormField>
      <UFormField label="Latitude (north +)" size="sm" class="w-36">
        <UInput v-model.number="place.latitudeDeg" type="number" step="0.01" min="-90" max="90" class="w-full" />
      </UFormField>
      <UButton
        icon="i-lucide-locate-fixed"
        variant="soft"
        color="neutral"
        :loading="locating"
        @click="useMyLocation"
      >
        Use my location
      </UButton>
      <UButton
        :icon="frozen ? 'i-lucide-play' : 'i-lucide-pause'"
        variant="soft"
        color="neutral"
        @click="frozen = !frozen"
      >
        {{ frozen ? 'Resume clock' : 'Freeze clock' }}
      </UButton>
    </template>

    <ErrorAlert :err="geoError" title="Geolocation" @dismiss="geoError = undefined" />
    <ErrorAlert :err="inputError" title="The package rejected these coordinates" :dismissible="false" />

    <div v-if="snap" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span class="font-mono text-lg tabular-nums text-highlighted">{{ utc(snap.date) }}</span>
        <span class="text-xs text-muted">{{ place.label }} · λ = {{ fmtNum(place.longitudeEastDeg, { digits: 4 }) }}° E · φ = {{ fmtNum(place.latitudeDeg, { digits: 4 }) }}°</span>
        <UBadge v-if="frozen" size="sm" color="warning" variant="subtle">clock frozen</UBadge>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Julian day (UT)" :value="fmtNum(snap.jd, { digits: 6 })" size="sm" note="Meeus 7.1 — days since −4712 Jan 1.5" />
        <StatTile label="ΔT" :value="`${fmtNum(snap.deltaTSeconds, { digits: 2 })} s`" size="sm" tone="warning" note="Espenak & Meeus 2006 polynomial — an extrapolation after 2005" />
        <StatTile label="Julian Ephemeris Day (TT)" :value="fmtNum(snap.jde, { digits: 6 })" size="sm" note="JD + ΔT/86400 — the argument the Sun and Moon take" />
        <StatTile label="Decimal year" :value="fmtNum(snap.decimalYear, { digits: 4 })" size="sm" note="2000 + (JD − 2451545)/365.25" />
        <StatTile label="GMST" :value="hms(snap.gmstHours)" size="sm" tone="info" note="IAU 1982, Meeus 12.4 — 0.07 ms from ERFA's gmst82" />
        <StatTile label="GAST" :value="hms(snap.gastHours)" size="sm" note="GMST + equation of the equinoxes (USNO short series)" />
        <StatTile label="Equation of the equinoxes" :value="`${fmtNum(snap.equationOfEquinoxesSeconds, { digits: 4 })} s`" size="sm" note="Δψ cos ε — never leaves ±1.2 s" />
        <StatTile label="Local mean solar time" :value="hms(snap.localMeanSolarHours, 0)" size="sm" note="UT + λ/15 — the clock-time stratum" />
        <StatTile label="Local sidereal time (mean)" :value="hms(snap.lstMeanHours)" size="sm" tone="primary" note="GMST + λ/15 — the right ascension on your meridian" />
        <StatTile label="Local sidereal time (apparent)" :value="hms(snap.lstApparentHours)" size="sm" note="from GAST; sidereal: 'apparent'" />
        <StatTile label="Sun α on the meridian at" :value="raHms(snap.sun.rightAscension, 0)" size="sm" note="LST equals α when a body crosses the meridian" />
        <StatTile label="Nutation Δψ / Δε" :value="`${fmtNum(snap.nutation.longitude * 3600, { digits: 2 })}″ / ${fmtNum(snap.nutation.obliquity * 3600, { digits: 2 })}″`" size="sm" note="four-term series, 0.5″ / 0.1″ (Meeus ch. 22)" />
      </div>

      <div class="flex flex-col items-center gap-2 sm:flex-row sm:items-start sm:gap-6">
        <EphemerisDial :hands="hands" :size="212" aria-label="24-hour dial with local sidereal, local mean solar and Greenwich sidereal time" />
        <p class="max-w-md text-sm text-muted">
          A mean sidereal day is 23h56m04.0905s of UT, so the sidereal hand gains about
          <strong class="text-highlighted">3 min 56 s</strong> on the solar hand every day and laps
          it once a year. That is the whole reason a fixed clock hour sweeps through every sidereal
          hour over twelve months — and the reason an effect that really depends on season or on
          clock time can present itself as an effect that depends on sidereal time.
        </p>
      </div>

      <EphemerisSky :snapshot="snap" />

      <HonestNote variant="exact">
        Everything above is a formula evaluated on your clock reading: no fitting, no data, no
        claim. The bounds are the ones the package's test suite asserts against ERFA, astropy and
        JPL DE440s, and the README's accuracy table lists them all.
      </HonestNote>

      <HonestNote variant="caveat" title="Two places where “exact” needs a footnote">
        <p>
          <strong class="text-highlighted">ΔT after 2005 is an extrapolation.</strong> The Espenak
          &amp; Meeus polynomials are fitted to observations up to about 2005; the package's own
          README notes that for 2025 they give 74.5 s where the observed value is 69.1 s. A 5 s
          error in TT moves the Moon by roughly 2.7″ and shifts a phase instant by about 5 s — it
          does not touch UT, the Julian day or sidereal time.
        </p>
        <p class="mt-2">
          <strong class="text-highlighted">Altitude and azimuth are computed on this page</strong>,
          not by the package: the textbook rotation of α, δ through the hour angle. They are
          geometric — no refraction, no parallax, no semidiameter — so they are not rise and set
          times. A UTC clock is also within 0.9 s of UT1, which is the time scale the sidereal
          formulas actually want.
        </p>
      </HonestNote>

      <CodeSnippet :code="snippet" title="what this section runs, once a second" />
    </div>

    <template #footer>
      Longitudes are east-positive; Edinburgh is −3.19°, Palo Alto −122.14°, Tokyo +139.69°. “Use my
      location” asks the browser for a fix and keeps it in this tab only — nothing is stored or sent.
    </template>
  </DemoSection>
</template>
