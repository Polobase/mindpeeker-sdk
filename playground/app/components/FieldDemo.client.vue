<script setup lang="ts">
/**
 * The spatial-field page. One field is drawn in the lab at the top and every
 * section below measures that same field, marking the shared canvas as it goes.
 * The four Monte-Carlo tests run in a Web Worker (app/workers/field-mc.worker.ts).
 */
import { closeFieldWorkers } from '~/lib/field/worker-client'

onUnmounted(() => closeFieldWorkers())
</script>

<template>
  <div class="flex flex-col gap-6">
    <HonestNote variant="caveat" title="Read this before reading any number on this page">
      A field drawn from a good RNG <strong>is</strong> complete spatial randomness, so it always has
      a densest point and an emptiest one. Randonautica-style engines call those the attractor and
      the void; the Fatum Project motivates the search with the claim that thinking hard about an
      outcome shifts where quantum measurements land. That claim is a
      <strong class="text-highlighted">hypothesis</strong>, and nothing on this page tests it. What
      is asserted here is the statistics: unbiased sampling, closed-form edge corrections checked
      against independent numerics, exact Monte-Carlo nulls, and p-values that mean what their names
      say. A small whole-field p says the pattern is unlikely under CSR from <em>this</em> source —
      it does not say why, and hardware bias is the first suspect.
    </HonestNote>

    <FieldLab />
    <FieldHotspots />
    <FieldEnvelope />
    <FieldRipley />
    <FieldQuadrats />
    <FieldDensity />
    <FieldScan />
    <FieldGeo />
    <FieldGeoHash />
  </div>
</template>
