<script setup lang="ts">
/**
 * Six I-Ching lines drawn the way they are read: line 1 at the bottom, line 6
 * at the top, yang solid and yin broken, moving lines marked. Presentational
 * and SSR-safe — it takes the `binary` key (bottom → top, yang = 1), never the
 * SDK.
 *
 * ```vue
 * <OracleHexagram :binary="cast.primary.binary" :changing="cast.changing" :values="values" />
 * ```
 */
const props = withDefaults(
  defineProps<{
    /** Six characters bottom → top, `'1'` = yang. */
    binary: string
    /** Positions 1–6 that move. */
    changing?: readonly number[]
    /** Line values 6/7/8/9 by position 1–6, when the lines came from a cast. */
    values?: readonly number[]
    size?: 'sm' | 'md'
    /** Show the position number and value next to each line. */
    annotate?: boolean
  }>(),
  { changing: () => [], values: undefined, size: 'md', annotate: false },
)

const VALUE_NAMES: Record<number, string> = {
  6: 'old yin — moving',
  7: 'young yang',
  8: 'young yin',
  9: 'old yang — moving',
}

/** Top line first, the way a hexagram is drawn. */
const lines = computed(() =>
  [...props.binary]
    .map((bit, i) => {
      const position = i + 1
      const value = props.values?.[i]
      return {
        position,
        yang: bit === '1',
        moving: props.changing.includes(position),
        value,
        note: value === undefined ? undefined : VALUE_NAMES[value],
      }
    })
    .reverse(),
)

const barHeight = computed(() => (props.size === 'sm' ? 'h-1.5' : 'h-2.5'))
const barWidth = computed(() => (props.size === 'sm' ? 'w-20' : 'w-32'))
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div
      v-for="line in lines"
      :key="line.position"
      class="flex items-center gap-2"
      :class="line.moving ? 'text-primary' : 'text-highlighted'"
    >
      <div
        class="flex gap-1.5"
        :class="[barWidth, barHeight]"
        role="img"
        :aria-label="`line ${line.position}: ${line.yang ? 'yang' : 'yin'}${line.moving ? ', moving' : ''}`"
      >
        <template v-if="line.yang">
          <span class="flex-1 rounded-sm bg-current" />
        </template>
        <template v-else>
          <span class="flex-1 rounded-sm bg-current" />
          <span class="flex-1 rounded-sm bg-current" />
        </template>
      </div>
      <span v-if="line.moving" class="text-xs" aria-hidden="true">✳</span>
      <span
        v-if="annotate"
        class="font-mono text-[11px] tabular-nums"
        :class="line.moving ? 'text-primary' : 'text-muted'"
      >
        {{ line.position }}<template v-if="line.value"> · {{ line.value }} {{ line.note }}</template>
      </span>
    </div>
  </div>
</template>
