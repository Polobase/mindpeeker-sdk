<script setup lang="ts">
/**
 * The time-and-sky page. Sections 1–5 evaluate closed-form astronomy; sections
 * 6–10 manufacture a data set and run Spottiswoode's local-sidereal-time scan
 * against four different nulls. The permutation work runs in
 * app/workers/ephemeris-lst.worker.ts.
 */
import { closeEphemerisWorkers } from '~/lib/ephemeris/worker-client'

onUnmounted(() => closeEphemerisWorkers())
</script>

<template>
  <div class="flex flex-col gap-6">
    <HonestNote variant="caveat" title="Read this before reading any number on this page">
      The astronomy here is <strong class="text-highlighted">exact to a stated precision</strong>:
      Julian days, ΔT, sidereal time, the Sun, the Moon and the instants of its phases are closed-form
      series checked against ERFA, astropy and JPL DE440s, and section 3 recomputes the book's worked
      examples in front of you. The statistics are exact too — a permutation p that includes its own
      search is a real p-value. What is <strong class="text-highlighted">not</strong> asserted is the
      hypothesis those statistics exist to test. Spottiswoode (1997) reported free-response effect
      sizes peaking near 13.47 h local sidereal time; sidereal time is a linear function of solar time
      and day of the year, most sessions ran in daylight, and the same database shows a seasonal
      variation, so a seasonal or clock-time effect can present itself as a sidereal one. The claim is
      a <strong class="text-highlighted">contested hypothesis</strong>. Every data set analysed below
      was manufactured by this browser a moment ago, so no result on this page is evidence about the
      world — only about what these tests do to data of that shape.
    </HonestNote>

    <EphemerisNow />
    <EphemerisDate />
    <EphemerisChecks />
    <EphemerisCurves />
    <EphemerisDrift />
    <EphemerisLab />
    <EphemerisScan />
    <EphemerisPermutation />
    <EphemerisConfirm />
    <EphemerisConfound />
  </div>
</template>
