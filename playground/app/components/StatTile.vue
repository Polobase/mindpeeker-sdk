<script setup lang="ts">
import { fmtNum } from '~/lib/format'

/**
 * One headline number with its label and a one-line caption. SSR-safe.
 *
 * ```vue
 * <StatTile label="Cumulative Stouffer Z" :value="z" tone="warning"
 *   note="inside ±2 is what chance looks like" />
 * <StatTile label="Bytes consumed"><template #value>…</template></StatTile>
 * ```
 */
type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info'

const props = withDefaults(
  defineProps<{
    label: string
    value?: string | number | null
    note?: string
    tone?: Tone
    /** Decimals for a numeric value (default 3). */
    digits?: number
    /** Tabular figures (default true). */
    mono?: boolean
    /** Smaller tile for dense grids. */
    size?: 'sm' | 'md'
  }>(),
  { value: undefined, note: undefined, tone: 'neutral', digits: 3, mono: true, size: 'md' },
)

const TONES: Record<Tone, string> = {
  neutral: 'text-highlighted',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
}

const text = computed(() =>
  typeof props.value === 'number'
    ? fmtNum(props.value, { digits: props.digits })
    : (props.value ?? '—'),
)
</script>

<template>
  <!--
    `min-w-0` lets the tile shrink inside a grid or flex row instead of forcing
    its column wider than the track; the note wraps rather than painting over
    the tile beside it (a long identifier overflowed at 390 px).
  -->
  <div class="min-w-0 rounded-md border border-default bg-elevated/40 px-3 py-2.5">
    <div class="text-[11px] uppercase tracking-wide text-muted break-words">{{ label }}</div>
    <div
      class="mt-0.5 truncate"
      :class="[
        TONES[tone],
        mono ? 'font-mono tabular-nums' : '',
        size === 'sm' ? 'text-xl' : 'text-2xl',
      ]"
      :title="$slots.value ? undefined : String(text)"
    >
      <slot name="value">{{ text }}</slot>
    </div>
    <div
      v-if="note || $slots.note"
      class="mt-1 text-xs text-dimmed break-words [overflow-wrap:anywhere]"
    >
      <slot name="note">{{ note }}</slot>
    </div>
  </div>
</template>
