<script setup lang="ts">
/** Full package index for small screens. SSR-safe. */
const open = ref(false)
const route = useRoute()

watch(
  () => route.fullPath,
  () => {
    open.value = false
  },
)
</script>

<template>
  <USlideover v-model:open="open" side="right" title="mindpeeker-sdk" description="All demos, by group">
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-menu"
      aria-label="Open the package menu"
    />

    <template #body>
      <div class="flex flex-col gap-6">
        <div>
          <p class="text-xs uppercase tracking-wide text-muted mb-2">Entropy source</p>
          <SourcePicker block />
        </div>

        <nav aria-label="Packages" class="flex flex-col gap-5">
          <UButton
            to="/"
            color="neutral"
            variant="ghost"
            icon="i-lucide-house"
            class="justify-start"
          >
            Home
          </UButton>
          <div v-for="group in GROUPS" :key="group.id">
            <p class="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
              <UIcon :name="group.icon" class="size-3.5" />
              {{ group.label }}
            </p>
            <ul class="mt-1.5 flex flex-col">
              <li v-for="entry in packagesInGroup(group.id)" :key="entry.id">
                <NuxtLink
                  :to="`/${entry.id}`"
                  class="flex gap-2.5 rounded-md px-2 py-2 hover:bg-elevated"
                  :class="route.path === `/${entry.id}` ? 'bg-elevated' : ''"
                >
                  <UIcon :name="entry.icon" class="size-4 mt-0.5 shrink-0 text-primary" />
                  <span class="min-w-0">
                    <span class="flex items-center gap-1.5 text-sm font-medium text-highlighted">
                      {{ entry.title }}
                      <UBadge v-if="entry.isNew" size="sm" color="primary" variant="subtle">new</UBadge>
                    </span>
                    <span class="text-xs text-muted line-clamp-2">{{ entry.tagline }}</span>
                  </span>
                </NuxtLink>
              </li>
            </ul>
          </div>
        </nav>

        <div class="flex flex-col gap-1 border-t border-default pt-4 text-sm">
          <ULink :to="RESEARCH_URL" target="_blank" rel="noreferrer" class="text-muted">Research notes ↗</ULink>
          <ULink :to="COOKBOOK_URL" target="_blank" rel="noreferrer" class="text-muted">Cookbook ↗</ULink>
          <ULink :to="RELEASES_URL" target="_blank" rel="noreferrer" class="text-muted">Release notes ↗</ULink>
          <ULink :to="REPO_URL" target="_blank" rel="noreferrer" class="text-muted">GitHub repository ↗</ULink>
        </div>
      </div>
    </template>
  </USlideover>
</template>
