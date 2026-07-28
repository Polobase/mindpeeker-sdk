<script setup lang="ts">
const sourceId = ref('crypto')
onMounted(() => {
  sourceId.value = currentSourceId()
})
const items = SOURCE_META.map((s) => ({ label: s.label, value: s.id }))
function onSource(val: string) {
  setSourceId(val)
  location.reload()
}
const navLinks = PACKAGES.filter((p) => p.ready)
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="sticky top-0 z-20 border-b border-default bg-default/80 backdrop-blur">
      <UContainer class="flex items-center gap-3 h-14">
        <NuxtLink to="/" class="flex items-center gap-2 font-bold whitespace-nowrap">
          <span class="size-2.5 rounded-full bg-primary" />
          mindpeeker-sdk
        </NuxtLink>
        <nav class="flex gap-0.5 text-sm ml-1">
          <UButton to="/" variant="ghost" color="neutral" size="xs">Home</UButton>
          <UButton
            v-for="p in navLinks"
            :key="p.id"
            :to="`/${p.id}`"
            variant="ghost"
            color="neutral"
            size="xs"
          >
            {{ p.title }}
          </UButton>
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <span class="hidden sm:inline text-[11px] text-muted uppercase tracking-wide">entropy</span>
          <USelect
            v-model="sourceId"
            :items="items"
            size="xs"
            class="w-44"
            @update:model-value="onSource"
          />
          <UButton :to="REPO_URL" target="_blank" variant="ghost" color="neutral" size="xs">
            GitHub ↗
          </UButton>
        </div>
      </UContainer>
    </header>

    <main class="flex-1">
      <slot />
    </main>

    <footer class="border-t border-default text-sm text-muted">
      <UContainer class="py-6 flex justify-between flex-wrap gap-3">
        <span>mindpeeker-sdk — Nuxt UI rebuild. Every demo runs client-side. MIT.</span>
        <ULink :to="REPO_URL" target="_blank">GitHub ↗</ULink>
      </UContainer>
    </footer>
  </div>
</template>
