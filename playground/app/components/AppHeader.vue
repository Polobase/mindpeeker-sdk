<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/** Brand, grouped package navigation, entropy source, theme and repository. */
const route = useRoute()

const items = computed<NavigationMenuItem[]>(() =>
  GROUPS.map((group) => {
    const packages = packagesInGroup(group.id)
    return {
      label: group.short,
      value: group.id,
      icon: group.icon,
      active: packages.some((p) => route.path === `/${p.id}`),
      // `children` makes the item a trigger; the content itself comes from the
      // `item-content` slot below, which can show taglines and "new" badges.
      children: packages.map((p) => ({
        label: p.title,
        description: p.tagline,
        icon: p.icon,
        to: `/${p.id}`,
      })),
    }
  }),
)

function groupPackages(value: unknown) {
  return packagesInGroup(String(value) as GroupId)
}

/**
 * `UColorModeButton` names itself from `colorMode.preference`, which is still
 * `'system'` on a first visit — so under a dark system preference the page
 * renders dark while the button announces "Switch to dark mode". The resolved
 * `colorMode.value` is the mode actually on screen, so the label and the icon
 * both come from that. Client-only, because the server cannot know it.
 */
const colorMode = useColorMode()
const isDark = computed({
  get: () => colorMode.value === 'dark',
  set: (dark: boolean) => {
    colorMode.preference = dark ? 'dark' : 'light'
  },
})
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-default bg-default/85 backdrop-blur">
    <UContainer class="flex h-14 items-center gap-2">
      <NuxtLink
        to="/"
        class="flex items-center gap-2 font-bold whitespace-nowrap text-highlighted"
        aria-label="mindpeeker-sdk home"
      >
        <span class="size-2.5 rounded-full bg-primary" />
        <span>mindpeeker<span class="text-muted font-normal">-sdk</span></span>
      </NuxtLink>

      <UNavigationMenu
        :items="items"
        variant="link"
        class="hidden xl:flex ms-2 min-w-0"
        :ui="{
          viewport: 'w-(--reka-navigation-menu-viewport-width)',
          content: 'w-auto',
          childList: 'grid sm:grid-cols-2 gap-1 p-2 w-[34rem] max-w-[90vw]',
        }"
      >
        <template #item-content="{ item }">
          <div class="w-[34rem] max-w-[80vw] p-3">
            <p class="px-2 pb-2 text-xs text-muted">
              {{ GROUPS.find((g) => g.id === item.value)?.description }}
            </p>
            <ul class="grid grid-cols-2 gap-1">
              <li v-for="entry in groupPackages(item.value)" :key="entry.id">
                <NuxtLink
                  :to="`/${entry.id}`"
                  class="flex gap-2.5 rounded-md p-2 hover:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <UIcon :name="entry.icon" class="size-4 mt-0.5 shrink-0 text-primary" />
                  <span class="min-w-0">
                    <span class="flex items-center gap-1.5 text-sm font-medium text-highlighted">
                      {{ entry.title }}
                      <UBadge v-if="entry.isNew" size="sm" color="primary" variant="subtle">new</UBadge>
                    </span>
                    <span class="mt-0.5 text-xs text-muted line-clamp-2">{{ entry.tagline }}</span>
                  </span>
                </NuxtLink>
              </li>
            </ul>
          </div>
        </template>
      </UNavigationMenu>

      <div class="ms-auto flex items-center gap-1.5">
        <div class="hidden sm:block">
          <SourcePicker />
        </div>
        <ClientOnly v-if="!colorMode?.forced">
          <UButton
            color="neutral"
            variant="ghost"
            :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
            :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="isDark = !isDark"
          />
          <template #fallback>
            <div class="size-8" />
          </template>
        </ClientOnly>
        <UButton
          :to="REPO_URL"
          target="_blank"
          rel="noreferrer"
          color="neutral"
          variant="ghost"
          icon="i-lucide-github"
          aria-label="Repository on GitHub"
        />
        <div class="xl:hidden">
          <AppMobileMenu />
        </div>
      </div>
    </UContainer>
  </header>
</template>
