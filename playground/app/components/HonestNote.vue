<script setup lang="ts">
/**
 * The epistemic label a demo puts next to a number. SSR-safe.
 *
 * ```vue
 * <HonestNote variant="contested">
 *   Whether intention moves the number is an open question; the honest default is no.
 * </HonestNote>
 * ```
 */
type Variant = 'exact' | 'contested' | 'caveat' | 'fixed-in-0.2'

const props = withDefaults(
  defineProps<{
    variant: Variant
    /** Overrides the variant's default heading. */
    title?: string
  }>(),
  { title: undefined },
)

const STYLES: Record<
  Variant,
  { title: string; icon: string; text: string; border: string; bg: string }
> = {
  exact: {
    title: 'Exact mathematics',
    icon: 'i-lucide-sigma',
    text: 'text-success',
    border: 'border-success/50',
    bg: 'bg-success/5',
  },
  contested: {
    title: 'Contested hypothesis',
    icon: 'i-lucide-scale',
    text: 'text-warning',
    border: 'border-warning/50',
    bg: 'bg-warning/5',
  },
  caveat: {
    title: 'Read this before reading the number',
    icon: 'i-lucide-triangle-alert',
    text: 'text-info',
    border: 'border-info/50',
    bg: 'bg-info/5',
  },
  'fixed-in-0.2': {
    title: 'Fixed in 0.2.0',
    icon: 'i-lucide-wrench',
    text: 'text-primary',
    border: 'border-primary/50',
    bg: 'bg-primary/5',
  },
}

const style = computed(() => STYLES[props.variant])
const heading = computed(() => props.title ?? style.value.title)
</script>

<template>
  <div
    class="rounded-md border-s-4 border-y border-e border-default ps-3 pe-3 py-2.5"
    :class="[style.border, style.bg]"
  >
    <p class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" :class="style.text">
      <UIcon :name="style.icon" class="size-4 shrink-0" />
      {{ heading }}
    </p>
    <div class="mt-1 text-sm text-muted [&_a]:text-primary [&_a]:underline">
      <slot />
    </div>
  </div>
</template>
