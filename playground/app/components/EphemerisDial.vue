<script setup lang="ts">
/**
 * A 24-hour dial: one hand per clock, so the ~3 min 56 s a day by which
 * sidereal time runs ahead of solar time is something you can watch drift
 * apart. SSR-safe (numbers in, SVG out).
 */
import { vizColor, type VizColor } from '~/lib/chart'

interface Hand {
  /** Position on the dial, in hours (any real; wrapped to [0, 24)). */
  hours: number
  label: string
  color?: VizColor
  /** Draw as a short outer tick instead of a hand from the centre. */
  tick?: boolean
}

const props = withDefaults(
  defineProps<{
    hands: readonly Hand[]
    size?: number
    ariaLabel?: string
  }>(),
  { size: 200, ariaLabel: undefined },
)

const R = 44
const wrap = (h: number): number => ((h % 24) + 24) % 24

const ticks = computed(() =>
  Array.from({ length: 24 }, (_, h) => {
    const angle = (h * 15 * Math.PI) / 180
    const inner = h % 6 === 0 ? R - 8 : h % 3 === 0 ? R - 5 : R - 3
    return {
      h,
      x1: Math.sin(angle) * inner,
      y1: -Math.cos(angle) * inner,
      x2: Math.sin(angle) * R,
      y2: -Math.cos(angle) * R,
      lx: Math.sin(angle) * (R - 15),
      ly: -Math.cos(angle) * (R - 15) + 2.5,
      major: h % 6 === 0,
    }
  }),
)

const drawn = computed(() =>
  props.hands.map((hand, index) => {
    const angle = (wrap(hand.hours) * 15 * Math.PI) / 180
    const length = hand.tick ? R : R - 12
    const from = hand.tick ? R - 10 : 0
    return {
      ...hand,
      stroke: vizColor(hand.color, index),
      x1: Math.sin(angle) * from,
      y1: -Math.cos(angle) * from,
      x2: Math.sin(angle) * length,
      y2: -Math.cos(angle) * length,
      text: `${String(Math.floor(wrap(hand.hours))).padStart(2, '0')}h${String(
        Math.floor((wrap(hand.hours) % 1) * 60),
      ).padStart(2, '0')}`,
    }
  }),
)
</script>

<template>
  <figure class="flex flex-col items-center gap-2">
    <svg
      :width="size"
      :height="size"
      viewBox="-52 -52 104 104"
      role="img"
      :aria-label="ariaLabel ?? `24-hour dial: ${drawn.map((d) => `${d.label} ${d.text}`).join(', ')}`"
    >
      <circle :r="R" cx="0" cy="0" fill="none" stroke="var(--viz-grid)" stroke-width="1" />
      <line
        v-for="t in ticks"
        :key="`t${t.h}`"
        :x1="t.x1"
        :y1="t.y1"
        :x2="t.x2"
        :y2="t.y2"
        stroke="var(--viz-axis)"
        :stroke-width="t.major ? 1.1 : 0.5"
      />
      <text
        v-for="t in ticks.filter((x) => x.major)"
        :key="`l${t.h}`"
        :x="t.lx"
        :y="t.ly"
        text-anchor="middle"
        font-size="6"
        fill="var(--viz-label)"
      >{{ t.h }}</text>
      <line
        v-for="hand in drawn"
        :key="hand.label"
        :x1="hand.x1"
        :y1="hand.y1"
        :x2="hand.x2"
        :y2="hand.y2"
        :stroke="hand.stroke"
        :stroke-width="hand.tick ? 2.4 : 1.8"
        stroke-linecap="round"
      />
      <circle r="1.6" cx="0" cy="0" fill="var(--viz-axis)" />
    </svg>
    <figcaption class="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted">
      <span v-for="hand in drawn" :key="`k${hand.label}`" class="inline-flex items-center gap-1.5">
        <span class="inline-block h-0.5 w-3 rounded" :style="{ background: hand.stroke }" />
        {{ hand.label }} <span class="font-mono tabular-nums text-highlighted">{{ hand.text }}</span>
      </span>
    </figcaption>
  </figure>
</template>
