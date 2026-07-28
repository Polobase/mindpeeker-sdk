<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/scan</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Radionic scan</h1>
    <p class="mt-2 max-w-3xl text-muted">
      An AetherOne-style scan composed from unbiased primitives: a race ranks a random subset by
      energy, and a chance-deviation model scores every item against a fair-coin null. A high score
      flags a departure from chance — not evidence of intention. Edit the catalog and scan.
    </p>
    <ClientOnly>
      <ScanDemo class="mt-6" />
      <template #fallback>
        <div class="mt-6 text-muted">Loading scanner…</div>
      </template>
    </ClientOnly>
  </UContainer>
</template>
