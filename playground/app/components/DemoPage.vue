<script setup lang="ts">
/**
 * The shell every package page uses: header from the manifest, docs links, and
 * the demo itself inside `<ClientOnly>` (the demo is the only part allowed to
 * touch `@mindpeeker/*`). SSR-safe — do not import the SDK here.
 *
 * ```vue
 * <template>
 *   <DemoPage id="oracle">
 *     <template #intro>One paragraph of context.</template>
 *     <OracleDemo />
 *   </DemoPage>
 * </template>
 * ```
 */
import type { CookbookRecipe } from '~/utils/manifest'

const props = defineProps<{ id: string }>()

const entry = computed(() => packageById(props.id))
const group = computed(() => (entry.value ? groupById(entry.value.group) : undefined))
const recipes = computed<CookbookRecipe[]>(() => {
  const out: CookbookRecipe[] = []
  for (const n of entry.value?.cookbookRecipes ?? []) {
    const recipe = cookbookRecipe(n)
    if (recipe) out.push(recipe)
  }
  return out
})
/** '§ 1' out of '§ 1 Entropy sources and conditioning'. */
const researchShort = computed(() => entry.value?.researchLabel.split(' ').slice(0, 2).join(' ') ?? '')

useHead({ title: () => entry.value?.title ?? 'Demo' })
useSeoMeta({ description: () => entry.value?.tagline ?? '' })
</script>

<template>
  <UContainer class="py-8 sm:py-10">
    <template v-if="entry">
      <header class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <UIcon :name="entry.icon" class="size-5 text-primary shrink-0" />
            <span class="font-mono text-sm text-primary">{{ entry.pkg }}</span>
            <UBadge v-if="entry.isNew" color="primary" variant="subtle" size="sm">new in 0.2.0</UBadge>
            <UBadge color="neutral" variant="outline" size="sm">{{ group?.label }}</UBadge>
          </div>
          <h1 class="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-highlighted">
            {{ entry.title }}
          </h1>
          <p class="mt-3 max-w-3xl text-muted">{{ entry.tagline }}</p>
          <div v-if="$slots.intro" class="mt-3 max-w-3xl text-muted text-sm sm:text-base">
            <slot name="intro" />
          </div>

          <div class="mt-5 flex flex-wrap gap-2">
            <UButton
              :to="entry.readmeUrl"
              target="_blank"
              rel="noreferrer"
              size="sm"
              color="neutral"
              variant="outline"
              icon="i-lucide-book-open"
            >
              README
            </UButton>
            <UButton
              :to="researchUrl(entry)"
              target="_blank"
              rel="noreferrer"
              size="sm"
              color="neutral"
              variant="outline"
              icon="i-lucide-flask-conical"
              :title="entry.researchLabel"
            >
              Research {{ researchShort }}
            </UButton>
            <UButton
              v-for="recipe in recipes"
              :key="recipe.n"
              :to="cookbookUrl(recipe.n)"
              target="_blank"
              rel="noreferrer"
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-chef-hat"
              :title="recipe.title"
            >
              Recipe {{ recipe.n }}
            </UButton>
          </div>
        </div>

        <aside
          v-if="entry.highlights.length"
          class="rounded-lg border border-default bg-elevated/40 p-4 h-fit"
        >
          <h2 class="text-xs uppercase tracking-wide text-muted">What 0.2.0 changed</h2>
          <ul class="mt-2 space-y-1.5">
            <li
              v-for="item in entry.highlights"
              :key="item"
              class="flex gap-2 text-sm text-muted"
            >
              <UIcon name="i-lucide-check" class="size-4 shrink-0 mt-0.5 text-primary" />
              <span>{{ item }}</span>
            </li>
          </ul>
        </aside>
      </header>

      <div class="mt-8">
        <ClientOnly>
          <slot />
          <template #fallback>
            <div class="flex flex-col gap-4" aria-busy="true" aria-live="polite">
              <USkeleton class="h-10 w-64" />
              <USkeleton class="h-56 w-full" />
              <USkeleton class="h-32 w-full" />
              <p class="text-sm text-muted">Loading the demo — every computation runs in your browser.</p>
            </div>
          </template>
        </ClientOnly>
      </div>
    </template>

    <template v-else>
      <h1 class="text-2xl font-bold">Unknown package “{{ id }}”</h1>
      <p class="mt-2 text-muted">
        This page id is not in the manifest.
        <ULink to="/">Back to the package index.</ULink>
      </p>
    </template>
  </UContainer>
</template>
