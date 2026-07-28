<script setup lang="ts">
const groups = ['frontier', 'randomness', 'tools'] as const
const pkgs = (g: string) => PACKAGES.filter((p) => p.group === g)
</script>

<template>
  <UContainer class="py-14">
    <section class="pb-10 border-b border-default">
      <p class="font-mono text-sm text-primary uppercase tracking-widest">mindpeeker-sdk</p>
      <h1 class="mt-3 text-4xl sm:text-5xl font-bold tracking-tight">
        Rigorous randomness, frontier research — in your browser.
      </h1>
      <p class="mt-4 max-w-2xl text-muted text-lg">
        A Nuxt + Nuxt UI rebuild of the mindpeeker-sdk demos. Every page draws live from your
        browser’s CSPRNG — or the beacon / quantum source you pick in the header — with no server.
      </p>
      <div class="mt-6 flex gap-3 flex-wrap">
        <UButton to="/gematria" size="lg" trailing-icon="i-lucide-arrow-right">
          Open the gematria calculator
        </UButton>
        <UButton :to="REPO_URL" target="_blank" size="lg" variant="outline" color="neutral">
          Source on GitHub
        </UButton>
      </div>
    </section>

    <section v-for="g in groups" :key="g" class="mt-10">
      <h2 class="text-sm uppercase tracking-wider text-muted border-l-2 border-primary pl-2 mb-4">
        {{ GROUP_LABELS[g] }}
      </h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UCard
          v-for="p in pkgs(g)"
          :key="p.id"
          :class="p.ready ? 'transition hover:ring-primary' : 'opacity-60'"
        >
          <div class="font-mono text-xs text-primary">{{ p.pkg }}</div>
          <div class="mt-1 flex items-center gap-2">
            <h3 class="font-semibold">{{ p.title }}</h3>
            <UBadge v-if="!p.ready" size="sm" color="neutral" variant="subtle">soon</UBadge>
          </div>
          <p class="mt-2 text-sm text-muted">{{ p.tagline }}</p>
          <UButton
            v-if="p.ready"
            :to="`/${p.id}`"
            class="mt-3"
            size="xs"
            variant="soft"
            trailing-icon="i-lucide-arrow-right"
          >
            Open
          </UButton>
        </UCard>
      </div>
    </section>
  </UContainer>
</template>
