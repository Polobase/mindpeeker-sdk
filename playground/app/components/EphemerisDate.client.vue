<script setup lang="ts">
/**
 * Section 2 — any date. The calendar ↔ Julian day conversion in both
 * directions, including the three calendar systems and the ten days of 1582
 * that do not exist, then the same sky the live clock shows.
 */
import {
  type CalendarSystem,
  dateFromJulianDay,
  julianDay,
  julianDayToDate,
  type MoonPhaseEvent,
  moonPhases,
  universalJulianDay,
} from '@mindpeeker/ephemeris'
import { hms, observe, type ObserverSnapshot, PHASE_LABELS, utc } from '~/lib/ephemeris/observer'
import { useObserverPlace } from '~/lib/ephemeris/place'
import { fmtNum } from '~/lib/format'

const place = useObserverPlace()

const form = reactive({
  year: 1987,
  month: 4,
  day: 10,
  hour: 0,
  minute: 0,
  second: 0,
  calendar: 'auto' as CalendarSystem,
})
const mode = ref<'calendar' | 'jd'>('calendar')
const jdInput = ref(2446895.5)
const phaseSpanDays = ref(60)

const CALENDARS = [
  { label: 'auto — Julian before 1582 Oct 15', value: 'auto' },
  { label: 'gregorian (proleptic)', value: 'gregorian' },
  { label: 'julian (proleptic)', value: 'julian' },
]
const SPANS = [
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '180 days', value: 180 },
  { label: '365 days', value: 365 },
]

const PRESETS = [
  { label: 'Meeus 12.a — 1987 Apr 10, 0h UT', y: 1987, mo: 4, d: 10, h: 0, mi: 0 },
  { label: 'Meeus 12.b — 1987 Apr 10, 19h21m UT', y: 1987, mo: 4, d: 10, h: 19, mi: 21 },
  { label: 'Meeus 47.a — 1992 Apr 12, 0h', y: 1992, mo: 4, d: 12, h: 0, mi: 0 },
  { label: 'Meeus 25.a — 1992 Oct 13, 0h', y: 1992, mo: 10, d: 13, h: 0, mi: 0 },
  { label: 'J2000.0 — 2000 Jan 1, 12h UT', y: 2000, mo: 1, d: 1, h: 12, mi: 0 },
  { label: 'Sputnik 1 — 1957 Oct 4, 19h26m', y: 1957, mo: 10, d: 4, h: 19, mi: 26 },
  { label: 'The Julian calendar — 333 Jan 27, 12h', y: 333, mo: 1, d: 27, h: 12, mi: 0 },
]

function applyPreset(p: (typeof PRESETS)[number]): void {
  mode.value = 'calendar'
  form.year = p.y
  form.month = p.mo
  form.day = p.d
  form.hour = p.h
  form.minute = p.mi
  form.second = 0
  form.calendar = 'auto'
}

function useNow(): void {
  mode.value = 'calendar'
  const d = new Date()
  form.year = d.getUTCFullYear()
  form.month = d.getUTCMonth() + 1
  form.day = d.getUTCDate()
  form.hour = d.getUTCHours()
  form.minute = d.getUTCMinutes()
  form.second = d.getUTCSeconds()
  form.calendar = 'auto'
}

/** The Julian day the inputs describe — or the typed error they produced. */
const resolved = computed<{ jd?: number; error?: unknown }>(() => {
  try {
    if (mode.value === 'jd') {
      const jd = Number(jdInput.value)
      // dateFromJulianDay validates the domain and throws `invalid_time` outside it.
      dateFromJulianDay(jd)
      return { jd }
    }
    return {
      jd: julianDay(
        {
          year: form.year,
          month: form.month,
          day: form.day,
          hour: form.hour,
          minute: form.minute,
          second: form.second,
        },
        { calendar: form.calendar },
      ),
    }
  } catch (error) {
    return { error }
  }
})

const sky = computed<{ snap?: ObserverSnapshot; error?: unknown }>(() => {
  const jd = resolved.value.jd
  if (jd === undefined) return {}
  try {
    return { snap: observe(julianDayToDate(jd), place.longitudeEastDeg, place.latitudeDeg) }
  } catch (error) {
    return { error }
  }
})

const roundTrip = computed(() => {
  const jd = resolved.value.jd
  if (jd === undefined) return undefined
  try {
    return dateFromJulianDay(jd)
  } catch {
    return undefined
  }
})

const phases = computed<{ rows?: readonly MoonPhaseEvent[]; error?: unknown }>(() => {
  const snap = sky.value.snap
  if (!snap) return {}
  try {
    return { rows: moonPhases(snap.jde, snap.jde + phaseSpanDays.value) }
  } catch (error) {
    return { error }
  }
})

function phaseDate(event: MoonPhaseEvent, deltaTSeconds: number): string {
  return utc(julianDayToDate(universalJulianDay(event.jde, deltaTSeconds)))
}

const snippet = computed(
  () => `import {
  dateFromJulianDay, julianDay, julianDayToDate, moonPhases, universalJulianDay,
} from '@mindpeeker/ephemeris'

// A calendar date → JD. 'auto' switches to the Julian calendar before 1582 Oct 15;
// a date in the ten-day gap, or 2023 Feb 29, throws EphemerisError 'invalid_time'.
const jd = julianDay(
  { year: ${form.year}, month: ${form.month}, day: ${form.day}, hour: ${form.hour}, minute: ${form.minute}, second: ${form.second} },
  { calendar: '${form.calendar}' },
)

dateFromJulianDay(jd)   // → { year, month, day, hour, minute, second, calendar }
julianDayToDate(jd)     // → a JS Date through the Unix epoch, exactly

// Every principal phase in a span, in TT; universalJulianDay takes them back to UT.
const events = moonPhases(jde, jde + ${phaseSpanDays})`,
)
</script>

<template>
  <DemoSection
    id="any-date"
    title="2 · Any date — the calendar, both ways"
    description="Feed a date to the same functions. The calendar option decides which calendar the fields are written in, astronomical year numbering means year 0 is 1 BC, and the domain 0 ≤ JD ≤ 10⁷ rejects a Unix timestamp handed over by mistake."
    :api="['julianDay', 'dateFromJulianDay', 'julianDayToDate', 'moonPhases', 'universalJulianDay']"
  >
    <template #controls>
      <UFormField label="Input" size="sm" class="w-44">
        <USelect
          v-model="mode"
          :items="[{ label: 'a calendar date', value: 'calendar' }, { label: 'a Julian day', value: 'jd' }]"
          class="w-full"
        />
      </UFormField>
      <UButton icon="i-lucide-clock" variant="soft" color="neutral" @click="useNow">Use now</UButton>
    </template>

    <div class="flex flex-col gap-4">
      <div v-if="mode === 'calendar'" class="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <UFormField label="Year" size="sm"><UInput v-model.number="form.year" type="number" step="1" class="w-full" /></UFormField>
        <UFormField label="Month" size="sm"><UInput v-model.number="form.month" type="number" step="1" min="1" max="12" class="w-full" /></UFormField>
        <UFormField label="Day" size="sm"><UInput v-model.number="form.day" type="number" step="1" min="1" max="31" class="w-full" /></UFormField>
        <UFormField label="Hour (UT)" size="sm"><UInput v-model.number="form.hour" type="number" step="1" min="0" max="23" class="w-full" /></UFormField>
        <UFormField label="Minute" size="sm"><UInput v-model.number="form.minute" type="number" step="1" min="0" max="59" class="w-full" /></UFormField>
        <UFormField label="Second" size="sm"><UInput v-model.number="form.second" type="number" step="1" min="0" max="59" class="w-full" /></UFormField>
        <UFormField label="Calendar" size="sm"><USelect v-model="form.calendar" :items="CALENDARS" class="w-full" /></UFormField>
      </div>
      <div v-else class="grid gap-3 sm:grid-cols-3">
        <UFormField label="Julian day (UT)" size="sm" description="0 … 10 000 000">
          <UInput v-model.number="jdInput" type="number" step="0.0001" class="w-full" />
        </UFormField>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="preset in PRESETS"
          :key="preset.label"
          size="xs"
          variant="soft"
          color="neutral"
          @click="applyPreset(preset)"
        >
          {{ preset.label }}
        </UButton>
      </div>

      <ErrorAlert :err="resolved.error" title="The package rejected this date" :dismissible="false" />
      <ErrorAlert :err="sky.error" title="The package rejected this instant" :dismissible="false" />

      <template v-if="sky.snap">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Julian day (UT)" :value="fmtNum(sky.snap.jd, { digits: 6 })" size="sm" tone="primary" note="what every other function takes" />
          <StatTile
            label="Round trip"
            size="sm"
            :value="roundTrip ? `${roundTrip.year}-${String(roundTrip.month).padStart(2, '0')}-${String(roundTrip.day).padStart(2, '0')} ${String(roundTrip.hour).padStart(2, '0')}:${String(roundTrip.minute).padStart(2, '0')}:${roundTrip.second.toFixed(1).padStart(4, '0')}` : '—'"
            :note="roundTrip ? `dateFromJulianDay → ${roundTrip.calendar} calendar` : ''"
          />
          <StatTile label="As a JS Date" :value="utc(sky.snap.date)" size="sm" note="julianDayToDate — exact through the Unix epoch" />
          <StatTile label="ΔT / JDE (TT)" :value="`${fmtNum(sky.snap.deltaTSeconds, { digits: 1 })} s`" size="sm" :note="`JDE ${fmtNum(sky.snap.jde, { digits: 5 })}`" />
          <StatTile label="GMST" :value="hms(sky.snap.gmstHours, 4)" size="sm" tone="info" />
          <StatTile label="GAST" :value="hms(sky.snap.gastHours, 4)" size="sm" />
          <StatTile label="LST at this place (mean)" :value="hms(sky.snap.lstMeanHours, 2)" size="sm" tone="primary" :note="`λ = ${fmtNum(place.longitudeEastDeg, { digits: 2 })}° E`" />
          <StatTile label="Local mean solar time" :value="hms(sky.snap.localMeanSolarHours, 0)" size="sm" note="UT + λ/15" />
        </div>

        <EphemerisSky :snapshot="sky.snap" />

        <div class="rounded-md border border-default bg-elevated/30 p-3">
          <div class="mb-2 flex flex-wrap items-center gap-3">
            <h4 class="text-sm font-semibold text-highlighted">
              Every phase in a span — <code class="font-mono text-xs text-primary">moonPhases(startJde, endJde)</code>
            </h4>
            <UFormField label="Span from this instant" size="sm" class="w-40">
              <USelect v-model="phaseSpanDays" :items="SPANS" class="w-full" />
            </UFormField>
          </div>
          <ErrorAlert :err="phases.error" :dismissible="false" />
          <ul v-if="phases.rows" class="grid gap-1.5 text-sm sm:grid-cols-2">
            <li v-for="event in phases.rows" :key="event.k" class="flex flex-wrap items-baseline gap-x-2">
              <span class="w-28 shrink-0 text-muted">{{ PHASE_LABELS[event.phase] }}</span>
              <span class="font-mono tabular-nums text-highlighted">{{ phaseDate(event, sky.snap.deltaTSeconds) }}</span>
              <span class="font-mono text-xs text-dimmed">k = {{ event.k }}</span>
            </li>
          </ul>
          <p v-if="phases.rows" class="mt-2 text-xs text-dimmed">
            {{ phases.rows.length }} events in {{ phaseSpanDays }} days — a synodic month is 29.53 d,
            so about {{ fmtNum((phaseSpanDays / 29.530589) * 4, { digits: 1 }) }} principal phases are expected.
          </p>
        </div>

        <HonestNote variant="caveat" title="Three ways a date can be wrong before any astronomy happens">
          <p>
            <strong class="text-highlighted">The calendar.</strong> With <code class="font-mono">'auto'</code>
            the same field values mean different days either side of 1582 October 15, and the ten
            days between October 5 and 14 throw <code class="font-mono">invalid_time</code> because
            they never happened. Try 1582-10-10, or 2023-02-29.
          </p>
          <p class="mt-2">
            <strong class="text-highlighted">The year number.</strong> Years are astronomical: year
            0 is 1 BC and year −1 is 2 BC, so the century arithmetic keeps working across the epoch.
          </p>
          <p class="mt-2">
            <strong class="text-highlighted">The time scale.</strong> The fields above are UT. The
            Sun, the Moon and the phase instants take TT, which is ΔT seconds later; this page adds
            it for you. Passing a UT Julian day straight to <code class="font-mono">moonPosition</code>
            is a silent error of about 70 s of time — roughly 38″ of lunar longitude today.
          </p>
        </HonestNote>

        <CodeSnippet :code="snippet" title="what this section runs" />
      </template>
    </div>

    <template #footer>
      The observer is the one selected in section 1, so changing the place there changes the LST
      here. A Julian day outside [0, 10⁷] is rejected, which is also how a Unix timestamp handed
      over by mistake is caught.
    </template>
  </DemoSection>
</template>
