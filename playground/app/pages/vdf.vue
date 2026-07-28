<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/vdf</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Verifiable delay function</h1>
    <p class="mt-2 max-w-3xl text-muted">
      Computing y = x^(2^T) mod n needs T sequential squarings that no amount of parallelism can
      shortcut — a proof of elapsed time. The Pietrzak proof then lets anyone verify it in O(log T)
      steps. The squaring chain yields to the event loop as it runs, so the progress bar keeps
      moving.
    </p>
    <ClientOnly>
      <VdfDemo class="mt-6" />
      <template #fallback>
        <div class="mt-6 text-muted">Loading delay function…</div>
      </template>
    </ClientOnly>
  </UContainer>
</template>
