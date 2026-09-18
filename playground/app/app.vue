<script setup lang="ts">
useHead({
  titleTemplate: (title?: string) => (title ? `${title} · mindpeeker-sdk` : 'mindpeeker-sdk'),
})
useSeoMeta({
  description:
    'Interactive demos for the mindpeeker-sdk 0.2.0: entropy sources, order detection, experiment protocols, symbolic mappings and tamper-evident records — all client-side.',
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
