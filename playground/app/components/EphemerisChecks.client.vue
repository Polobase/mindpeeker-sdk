<script setup lang="ts">
/**
 * Section 3 — the Meeus check. Every worked example the package's test suite
 * pins, recomputed in this browser, with the book's printed value next to what
 * this build produced and the tolerance the tests assert.
 */
import { type CheckGroup, runChecks } from '~/lib/ephemeris/checks'

const groups = ref<CheckGroup[]>([])
const ranAt = ref<Date | undefined>(undefined)
const error = ref<unknown>(undefined)
const busy = ref(false)

function run(): void {
  busy.value = true
  error.value = undefined
  try {
    groups.value = runChecks()
    ranAt.value = new Date()
  } catch (err) {
    error.value = err
    groups.value = []
  } finally {
    busy.value = false
  }
}

onMounted(run)

const total = computed(() => groups.value.reduce((sum, g) => sum + g.rows.length, 0))
const passed = computed(() =>
  groups.value.reduce((sum, g) => sum + g.rows.filter((r) => r.ok).length, 0),
)
const allOk = computed(() => total.value > 0 && passed.value === total.value)

const snippet = `import { gmst, julianDay, toSexagesimal } from '@mindpeeker/ephemeris'

// Meeus Example 12.a — 1987 April 10, 0h UT
const jd = julianDay({ year: 1987, month: 4, day: 10 })   // 2446895.5
const s = toSexagesimal(gmst(jd))
// s → { sign: 1, whole: 13, minutes: 10, seconds: 46.3668… }
// the book prints 13h10m46.3668s; the tests assert < 0.1 ms`
</script>

<template>
  <DemoSection
    id="meeus"
    title="3 · The Meeus check — the book's worked examples, recomputed here"
    description="Astronomical Algorithms prints an answer for each of its worked examples. This runs them against the very build serving this page, so a wrong bundle, a wrong alias or a broken constant shows up as a red badge rather than as a plausible-looking number."
    :api="['julianDay', 'dateFromJulianDay', 'gmst', 'gast', 'nutation', 'meanObliquity', 'sunPosition', 'equationOfTime', 'moonPosition', 'moonIllumination', 'moonPhaseTime']"
  >
    <template #controls>
      <RunControls
        :busy="busy"
        label="Run the Meeus check"
        busy-label="Checking…"
        icon="i-lucide-check-check"
        :cancellable="false"
        hint="≈30 worked-example comparisons, all synchronous and local — no bytes, no network"
        @run="run"
      />
      <UBadge v-if="total" :color="allOk ? 'success' : 'error'" variant="subtle" size="lg">
        {{ passed }} / {{ total }} pass
      </UBadge>
    </template>

    <ErrorAlert :err="error" @dismiss="error = undefined" />

    <div class="flex flex-col gap-4">
      <p v-if="ranAt" class="text-xs text-muted">
        Last run {{ ranAt.toLocaleTimeString() }} in this tab.
      </p>

      <div v-for="group in groups" :key="group.id" class="rounded-md border border-default bg-elevated/30 p-3">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <UBadge :color="group.ok ? 'success' : 'error'" variant="subtle" size="sm">
            {{ group.ok ? 'pass' : 'fail' }}
          </UBadge>
          <h4 class="text-sm font-semibold text-highlighted">{{ group.title }}</h4>
          <span class="text-xs text-muted">{{ group.source }}</span>
          <div class="flex flex-wrap gap-1">
            <code
              v-for="name in group.api"
              :key="name"
              class="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-primary"
            >{{ name }}</code>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[48rem] text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wide text-muted">
                <th class="py-1 pr-3 font-medium">quantity</th>
                <th class="py-1 pr-3 font-medium">Meeus prints</th>
                <th class="py-1 pr-3 font-medium">this build</th>
                <th class="py-1 pr-3 font-medium">difference</th>
                <th class="py-1 pr-3 font-medium">tolerance</th>
                <th class="py-1 font-medium">—</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="rowItem in group.rows" :key="rowItem.quantity" class="border-t border-default/70 align-top">
                <td class="py-1.5 pr-3 text-muted">{{ rowItem.quantity }}</td>
                <td class="py-1.5 pr-3 font-mono tabular-nums text-muted">{{ rowItem.expected }}</td>
                <td class="py-1.5 pr-3 font-mono tabular-nums text-highlighted">{{ rowItem.got }}</td>
                <td class="py-1.5 pr-3 font-mono tabular-nums text-dimmed">{{ rowItem.difference }}</td>
                <td class="py-1.5 pr-3 font-mono tabular-nums text-dimmed">{{ rowItem.tolerance }}</td>
                <td class="py-1.5">
                  <UIcon
                    :name="rowItem.ok ? 'i-lucide-check' : 'i-lucide-x'"
                    :class="rowItem.ok ? 'text-success' : 'text-error'"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="group.note" class="mt-2 text-xs text-dimmed">{{ group.note }}</p>
      </div>

      <HonestNote variant="exact">
        A green row means this build reproduces a value published in 1998 to the precision the
        package claims. It says nothing about the world beyond that: the accuracy table in the
        README is the part that compares against ERFA, astropy and JPL DE440s, and those bounds
        (28″ for the Sun's longitude, 10.5″ for the Moon's, 12.6 s for a phase instant) are what
        limits any use of these numbers.
      </HonestNote>

      <CodeSnippet :code="snippet" title="one of the rows above, as code" />
    </div>

    <template #footer>
      The two rows that check a rejection are also worked examples: 1582 October 10 never existed
      under the historical calendar, and 2023 February 29 is not a date, so
      <code class="font-mono">julianDay</code> throws
      <code class="font-mono">EphemerisError('invalid_time')</code> for both rather than inventing
      a Julian day.
    </template>
  </DemoSection>
</template>
