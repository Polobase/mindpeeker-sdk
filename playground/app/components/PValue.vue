<script setup lang="ts">
import { fmtP } from '~/lib/format'

/**
 * A p-value with the one thing that makes it readable: what kind of p it is.
 * SSR-safe.
 *
 * ```vue
 * <PValue :p="report.deviation.p" kind="exact" />
 * <PValue :p="anytimeP" kind="anytime" :alpha="0.05" label="anytime p" />
 * ```
 */
type Kind = 'pointwise' | 'family-wise' | 'anytime' | 'exact'

const props = withDefaults(
  defineProps<{
    p?: number | null
    /** Threshold used only for emphasis — never for a verdict (default 0.05). */
    alpha?: number
    kind?: Kind
    /** Symbol in front of the value (default 'p'). */
    label?: string
    /** Hide the kind chip (the tooltip stays). */
    showKind?: boolean
  }>(),
  { p: undefined, alpha: 0.05, kind: 'pointwise', label: 'p', showKind: true },
)

const KINDS: Record<Kind, { chip: string; explain: string }> = {
  pointwise: {
    chip: 'pointwise',
    explain:
      'Pointwise p: valid for one pre-declared look. Re-checking it as data arrive, or scanning many windows, crosses 0.05 far more often than 5% of the time.',
  },
  'family-wise': {
    chip: 'family-wise',
    explain:
      'Family-wise adjusted p (Bonferroni / Holm / BH): controls false positives across all the comparisons in this family, not just this one.',
  },
  anytime: {
    chip: 'anytime-valid',
    explain:
      "Anytime-valid p: stays valid under continuous monitoring and optional stopping (Ville's inequality), so you may look whenever you like.",
  },
  exact: {
    chip: 'exact',
    explain:
      "Exact p: computed from the design's exact null distribution (no normal approximation), for one pre-declared comparison.",
  },
}

const info = computed(() => KINDS[props.kind])
const value = computed(() => fmtP(props.p))
const known = computed(() => typeof props.p === 'number' && Number.isFinite(props.p))
const low = computed(() => known.value && (props.p as number) < props.alpha)
const tooltip = computed(
  () =>
    `${info.value.explain} A small p says the data are unusual under the stated null model — not that an effect is real. α = ${props.alpha}.`,
)
</script>

<template>
  <UTooltip :text="tooltip" :delay-duration="150" :ui="{ content: 'max-w-xs h-auto whitespace-normal' }">
    <span
      tabindex="0"
      class="inline-flex items-center gap-1.5 rounded px-1 font-mono text-sm tabular-nums cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="low ? 'text-warning' : 'text-highlighted'"
    >
      <span>{{ label }} = {{ value }}</span>
      <UBadge v-if="showKind" size="sm" color="neutral" variant="subtle" class="font-sans">
        {{ info.chip }}
      </UBadge>
    </span>
  </UTooltip>
</template>
