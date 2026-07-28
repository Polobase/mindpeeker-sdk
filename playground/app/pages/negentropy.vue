<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/negentropy</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Randomness health battery</h1>
    <p class="mt-2 max-w-3xl text-muted">
      The estimators behind the SDK’s order-detection stack, run live over a 4 KB sample of your
      browser’s CSPRNG. Ideal randomness sits near 8 bits/byte of entropy, p-values scattered in
      [0, 1], and z-scores near zero — structure would push them to the extremes.
    </p>
    <ClientOnly>
      <NegentropyDemo class="mt-6" />
      <template #fallback>
        <div class="mt-6 text-muted">Loading battery…</div>
      </template>
    </ClientOnly>
  </UContainer>
</template>
