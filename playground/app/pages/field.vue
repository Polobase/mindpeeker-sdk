<template>
  <DemoPage id="field">
    <template #intro>
      Draw a point field from the selected entropy source and ask whether it holds any order. A field
      from a good RNG is complete spatial randomness, so its “attractors” are the chance clustering
      every random field shows: each hotspot gets an exact single-point tail <em>and</em> a calibrated
      whole-field Monte-Carlo p, and the page says which is which. Ripley's K with four edge
      corrections, global envelope tests, quadrats, Clark–Evans, a kernel-density attractor with the
      chance baseline the open Randonaut ports never report, Kulldorff's scan statistic, and exact
      spherical samplers that turn the same bytes into coordinates.
    </template>
    <FieldDemo />
  </DemoPage>
</template>
