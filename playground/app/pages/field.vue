<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/field</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Spatial field &amp; attractors</h1>
    <p class="mt-2 max-w-3xl text-muted">
      A field sampled from a good RNG is complete spatial randomness (CSR) — so its “attractors”
      are the chance clustering any random field shows. Each hotspot carries a Poisson tail p-value
      under CSR: the honest measure of how ordinary it is. Reseed to draw a new field.
    </p>
    <ClientOnly>
      <FieldDemo class="mt-6" />
      <template #fallback>
        <div class="mt-6 text-muted">Loading field…</div>
      </template>
    </ClientOnly>
  </UContainer>
</template>
