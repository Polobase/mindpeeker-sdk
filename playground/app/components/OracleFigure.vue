<script setup lang="ts">
/**
 * A four-row divination figure drawn as points or marks — the shape shared by
 * Western geomancy (one point = active) and Ifá (one stroke = a single mark).
 * Presentational and SSR-safe: it takes the `binary` key, never the SDK.
 *
 * ```vue
 * <OracleFigure :binary="shield.judge.binary" :label="shield.judge.name"
 *   caption="Judge" numeral="XV" :row-titles="['Fire','Air','Water','Earth']" />
 * ```
 */
const props = withDefaults(
  defineProps<{
    /** Four rows top → bottom, `'1'` = one point / single mark. */
    binary: string
    variant?: 'dots' | 'strokes'
    label?: string
    caption?: string
    /** Roman numeral or index shown above the figure. */
    numeral?: string
    /** Tooltip per row, e.g. the elements Fire → Earth. */
    rowTitles?: readonly string[]
    size?: 'sm' | 'md'
    /** Muted rendering for reference tables. */
    dimmed?: boolean
  }>(),
  {
    variant: 'dots',
    label: undefined,
    caption: undefined,
    numeral: undefined,
    rowTitles: undefined,
    size: 'md',
    dimmed: false,
  },
)

const rows = computed(() => [...props.binary].map((c) => (c === '1' ? 1 : 2)))

const mark = computed(() =>
  props.variant === 'strokes'
    ? props.size === 'sm'
      ? 'h-3 w-[3px] rounded-[1px] bg-current'
      : 'h-4 w-1 rounded-[2px] bg-current'
    : props.size === 'sm'
      ? 'size-1 rounded-full bg-current'
      : 'size-1.5 rounded-full bg-current',
)
const rowClass = computed(() =>
  props.variant === 'strokes' ? 'h-4 items-center gap-1.5' : 'h-2.5 items-center gap-2',
)

const aria = computed(
  () =>
    `${props.label ?? 'figure'} — rows top to bottom: ${rows.value
      .map((count) => (count === 1 ? 'single' : 'double'))
      .join(', ')}`,
)
</script>

<template>
  <div class="flex flex-col items-center gap-1">
    <div v-if="numeral" class="font-mono text-[10px] uppercase tracking-wide text-dimmed">
      {{ numeral }}
    </div>
    <div
      class="flex flex-col gap-1 py-0.5"
      :class="dimmed ? 'text-muted' : 'text-highlighted'"
      role="img"
      :aria-label="aria"
    >
      <div
        v-for="(count, i) in rows"
        :key="i"
        class="flex justify-center"
        :class="rowClass"
        :title="rowTitles?.[i]"
      >
        <span v-for="k in count" :key="k" :class="mark" />
      </div>
    </div>
    <div v-if="label" class="text-center text-xs font-medium leading-tight text-highlighted">
      {{ label }}
    </div>
    <div v-if="caption" class="text-center text-[11px] leading-tight text-muted">
      {{ caption }}
    </div>
  </div>
</template>
