<script setup lang="ts">
/**
 * One card of a demo: a heading, what it does, the SDK calls behind it, a row
 * of controls, the body, and a footnote. SSR-safe.
 *
 * ```vue
 * <DemoSection title="Cast" description="One hexagram from the selected source."
 *   :api="['castHexagram', 'byteReader']">
 *   <template #controls><RunControls … /></template>
 *   <HexagramView :cast="cast" />
 *   <template #footer>Odds are exact; meaning belongs to the tradition.</template>
 * </DemoSection>
 * ```
 */
withDefaults(
  defineProps<{
    title: string
    description?: string
    /** SDK identifiers shown as code chips. */
    api?: readonly string[]
    /** Anchor id, so a section is linkable. */
    id?: string
    /** Heading level for the section title (default 2). */
    level?: 2 | 3
  }>(),
  { description: undefined, api: () => [], id: undefined, level: 2 },
)
</script>

<template>
  <section
    :id="id"
    class="rounded-lg border border-default bg-default/60 p-4 sm:p-5 flex flex-col gap-4"
  >
    <header class="flex flex-col gap-2">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <component :is="level === 3 ? 'h3' : 'h2'" class="text-base font-semibold text-highlighted">
          {{ title }}
        </component>
        <div v-if="api.length" class="flex flex-wrap gap-1">
          <code
            v-for="name in api"
            :key="name"
            class="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-primary"
          >{{ name }}</code>
        </div>
      </div>
      <p v-if="description || $slots.description" class="text-sm text-muted max-w-3xl">
        <slot name="description">{{ description }}</slot>
      </p>
      <div v-if="$slots.controls" class="flex flex-wrap items-end gap-3 pt-1">
        <slot name="controls" />
      </div>
    </header>

    <div class="min-w-0">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="text-xs text-muted border-t border-default pt-3">
      <slot name="footer" />
    </footer>
  </section>
</template>
