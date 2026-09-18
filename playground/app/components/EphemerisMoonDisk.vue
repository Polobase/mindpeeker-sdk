<script setup lang="ts">
/**
 * The lunar disk drawn from the two numbers `moonIllumination` returns: the
 * illuminated fraction k and the position angle χ of the bright limb. SSR-safe
 * (numbers in, SVG out — no SDK import).
 *
 * The terminator is the projection of a great circle, an ellipse whose
 * semi-minor axis is r·|2k − 1| (because cos i = 2k − 1). The disk is drawn in
 * the usual sky orientation, north up and east left, and the lit half is
 * rotated so its midpoint sits at position angle χ measured from north through
 * east — which is what makes a waxing moon lit on the right.
 */
const props = withDefaults(
  defineProps<{
    /** k ∈ [0, 1] from `moonIllumination().illuminatedFraction`. */
    illuminatedFraction: number
    /** χ in degrees from `moonIllumination().brightLimbAngle`. */
    brightLimbAngle: number
    /** Edge length in CSS pixels. */
    size?: number
    /** Show the N/E cardinal ticks. */
    cardinals?: boolean
  }>(),
  { size: 132, cardinals: true },
)

const R = 46
const k = computed(() => Math.min(1, Math.max(0, props.illuminatedFraction)))
const semi = computed(() => R * Math.abs(2 * k.value - 1))
const sweep = computed(() => (k.value > 0.5 ? 1 : 0))
const litPath = computed(
  () =>
    `M 0 ${-R} A ${R} ${R} 0 0 1 0 ${R} A ${semi.value.toFixed(3)} ${R} 0 0 ${sweep.value} 0 ${-R} Z`,
)
const rotation = computed(() => -(90 + props.brightLimbAngle))
const percent = computed(() => `${(k.value * 100).toFixed(1)} %`)
</script>

<template>
  <figure class="flex flex-col items-center gap-1">
    <svg
      :width="size"
      :height="size"
      viewBox="-56 -56 112 112"
      role="img"
      :aria-label="`Moon disk, ${percent} illuminated, bright limb at position angle ${brightLimbAngle.toFixed(0)} degrees`"
    >
      <!-- the unlit disk -->
      <circle :r="R" cx="0" cy="0" fill="var(--viz-grid)" />
      <g :transform="`rotate(${rotation.toFixed(3)})`">
        <path :d="litPath" fill="var(--viz-3)" />
      </g>
      <circle :r="R" cx="0" cy="0" fill="none" stroke="var(--viz-axis)" stroke-width="1" />
      <template v-if="cardinals">
        <line x1="0" :y1="-R - 6" x2="0" :y2="-R - 1" stroke="var(--viz-axis)" stroke-width="1" />
        <text x="0" :y="-R - 9" text-anchor="middle" font-size="7" fill="var(--viz-label)">N</text>
        <line :x1="-R - 6" y1="0" :x2="-R - 1" y2="0" stroke="var(--viz-axis)" stroke-width="1" />
        <text :x="-R - 9" y="2.5" text-anchor="end" font-size="7" fill="var(--viz-label)">E</text>
      </template>
    </svg>
    <figcaption class="text-xs text-muted text-center">
      {{ percent }} lit · χ = {{ brightLimbAngle.toFixed(1) }}°
    </figcaption>
  </figure>
</template>
