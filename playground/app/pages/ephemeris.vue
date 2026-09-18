<template>
  <DemoPage id="ephemeris">
    <template #intro>
      Time is the one covariate every experiment already records, and sky position follows from it by
      arithmetic. This page runs that arithmetic live — a clock reading becomes a Julian day, ΔT turns
      it into Terrestrial Time, and the sidereal formulas turn it into the strip of sky overhead —
      then uses it to test the best-known claim built on that coordinate: that free-response
      performance peaks near 13.47 h local sidereal time. The astronomy is exact to a stated
      precision. The claim is contested, notably because sidereal time is a linear function of solar
      time and the day of the year, and this page lets you watch that confound eat the result.
    </template>
    <EphemerisDemo />
  </DemoPage>
</template>
