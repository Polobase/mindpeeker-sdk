<script setup lang="ts">
/** Version, documentation links and the honest-framing one-liner. SSR-safe. */
const links = [
  { label: 'Research notes', to: RESEARCH_URL, icon: 'i-lucide-flask-conical' },
  { label: 'Cookbook', to: COOKBOOK_URL, icon: 'i-lucide-chef-hat' },
  { label: 'Release notes', to: RELEASES_URL, icon: 'i-lucide-file-text' },
  { label: 'Contributing', to: CONTRIBUTING_URL, icon: 'i-lucide-git-pull-request' },
  { label: 'Repository', to: REPO_URL, icon: 'i-lucide-github' },
]
</script>

<template>
  <footer class="mt-12 border-t border-default">
    <UContainer class="py-8 flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="flex items-center gap-2 font-semibold text-highlighted">
          <span class="size-2 rounded-full bg-primary" />
          mindpeeker-sdk
          <UBadge color="neutral" variant="subtle" size="sm">v{{ SDK_VERSION }}</UBadge>
        </span>
        <nav class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <ULink
            v-for="link in links"
            :key="link.label"
            :to="link.to"
            target="_blank"
            rel="noreferrer"
            class="inline-flex items-center gap-1.5 text-muted hover:text-highlighted"
          >
            <UIcon :name="link.icon" class="size-4" />
            {{ link.label }}
          </ULink>
        </nav>
        <ULink
          :to="LICENSE_URL"
          target="_blank"
          rel="noreferrer"
          class="text-sm text-muted sm:ms-auto"
        >
          MIT
        </ULink>
      </div>
      <p class="text-xs text-muted max-w-3xl">
        Fifteen packages at {{ SDK_VERSION }}. Every demo runs client-side, in your browser. The
        mathematics is asserted; the contested hypotheses — psi, radionics, the meaning of a
        divination draw, sidereal-time effects — are stated as hypotheses, and no result here is
        evidence that any of them is real.
      </p>
    </UContainer>
  </footer>
</template>
