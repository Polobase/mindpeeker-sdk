<script setup lang="ts">
import type { NuxtError } from '#app'

/**
 * The site's own error page. Without it Nuxt ships its stock screen as
 * `404.html` — no header, no navigation, and a document title ending in
 * "| Nuxt".
 *
 * `error.vue` replaces `app.vue`, so `UApp`, the layout and the title template
 * all have to be repeated here. SSR-safe: no `@mindpeeker/*` import, only the
 * plain-data manifest.
 */
const props = defineProps<{ error?: Partial<NuxtError> }>()

const status = computed(() => Number(props.error?.statusCode ?? 404))
const notFound = computed(() => status.value === 404)

const pageTitle = computed(() => (notFound.value ? 'Page not found' : `Error ${status.value}`))
useHead({
  titleTemplate: (title?: string) => (title ? `${title} · mindpeeker-sdk` : 'mindpeeker-sdk'),
  title: pageTitle,
})
useSeoMeta({
  description:
    'That page is not part of the mindpeeker-sdk demo site. The fifteen package demos are listed here.',
  robots: 'noindex',
})

// GitHub Pages serves this same static `404.html` for every unknown path, so the
// path baked into it at build time is never the one the visitor asked for. Only
// the client router knows it — hence the `<ClientOnly>` around the line below.
const route = useRoute()
const askedFor = computed(() => {
  const path = route.fullPath
  return path && path !== '/' && !path.startsWith('/404') ? path : undefined
})

/**
 * The error state outlives a route change, so every link out of this page has to
 * clear it — including the ones in the header and the footer, which this watcher
 * covers. `initialPath` is the route the client resolved before mount (on a
 * static 404 that is the URL the visitor typed, not the `/404.html` the server
 * rendered), so hydration alone never counts as a navigation.
 */
const initialPath = route.fullPath
watch(
  () => route.fullPath,
  (next) => {
    if (next !== initialPath) clearError()
  },
)

function recover(event: MouseEvent, to: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  clearError({ redirect: to })
}
</script>

<template>
  <UApp>
    <NuxtLayout>
      <UContainer class="py-12 sm:py-20">
        <section class="max-w-3xl">
          <p class="font-mono text-sm uppercase tracking-widest text-primary">
            {{ notFound ? '404' : `Error ${status}` }}
          </p>
          <h1 class="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-highlighted">
            {{ notFound ? "That page isn't part of this site." : 'Something went wrong.' }}
          </h1>
          <p v-if="notFound" class="mt-4 text-lg text-muted">
            Every demo lives at a one-word path —
            <code class="font-mono text-highlighted">/entropy</code>,
            <code class="font-mono text-highlighted">/oracle</code>,
            <code class="font-mono text-highlighted">/ledger</code>. Pick one below, or start from
            the index.
          </p>
          <p v-else class="mt-4 text-lg text-muted">
            {{ props.error?.message || 'The page could not be rendered.' }}
          </p>
          <ClientOnly>
            <p v-if="notFound && askedFor" class="mt-2 text-sm text-dimmed">
              Requested: <code class="font-mono break-all">{{ askedFor }}</code>
            </p>
          </ClientOnly>

          <div class="mt-6 flex flex-wrap gap-3">
            <UButton size="lg" icon="i-lucide-house" @click="clearError({ redirect: '/' })">
              Back to the index
            </UButton>
            <UButton
              size="lg"
              color="neutral"
              variant="outline"
              icon="i-lucide-layout-grid"
              @click="clearError({ redirect: '/#packages' })"
            >
              All fifteen demos
            </UButton>
            <UButton
              :to="REPO_URL"
              target="_blank"
              rel="noreferrer"
              size="lg"
              color="neutral"
              variant="ghost"
              icon="i-lucide-github"
            >
              Source on GitHub
            </UButton>
          </div>
        </section>

        <section v-if="notFound" class="mt-12">
          <h2 class="text-sm uppercase tracking-wider text-muted border-s-2 border-primary ps-2">
            The fifteen demos
          </h2>
          <div v-for="group in GROUPS" :key="group.id" class="mt-6">
            <p class="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
              <UIcon :name="group.icon" class="size-3.5" />
              {{ group.label }}
            </p>
            <ul class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <li v-for="entry in packagesInGroup(group.id)" :key="entry.id">
                <NuxtLink
                  :to="`/${entry.id}`"
                  class="flex gap-2.5 rounded-md border border-default p-3 transition hover:border-primary hover:bg-elevated/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  @click="recover($event, `/${entry.id}`)"
                >
                  <UIcon :name="entry.icon" class="size-4 mt-0.5 shrink-0 text-primary" />
                  <span class="min-w-0">
                    <span class="flex items-center gap-1.5 text-sm font-medium text-highlighted">
                      {{ entry.title }}
                      <UBadge v-if="entry.isNew" size="sm" color="primary" variant="subtle">new</UBadge>
                    </span>
                    <span class="mt-0.5 block text-xs text-muted line-clamp-2">{{ entry.tagline }}</span>
                  </span>
                </NuxtLink>
              </li>
            </ul>
          </div>
        </section>
      </UContainer>
    </NuxtLayout>
  </UApp>
</template>
