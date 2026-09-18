<script setup lang="ts">
/**
 * The verifiable-delay page.
 *
 * Every section runs its work in app/workers/vdf.worker.ts: a VDF is a
 * deliberately slow computation, so the only honest way to show it in a browser
 * is off the main thread, with a progress bar and a Cancel button that really
 * aborts.
 */
import { closeVdfWorkers } from '~/lib/vdf/worker-client'

onUnmounted(() => closeVdfWorkers())
</script>

<template>
  <div class="flex flex-col gap-6">
    <HonestNote variant="caveat" title="What a delay proves, and what it does not">
      Every number on this page is exact mathematics: T squarings happen, the proof verifies or it
      does not, the byte counts are what they are. What a delay <em>means</em> in seconds is not
      exact — T is "T squarings on the fastest hardware anyone owns", and the fastest hardware is
      not this browser. A seal is a
      <strong class="text-highlighted">no-earlier-than</strong> bound only: it says nobody could have
      known y sooner than T squarings after the input was fixed. It says nothing about when the input
      was fixed, when y was published, or whether the input was any good.
    </HonestNote>

    <VdfPipeline />
    <VdfForgery />
    <VdfModulus />
    <VdfSeal />
    <VdfCalibration />
  </div>
</template>
