<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/entropy</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Entropy source</h1>
    <p class="mt-2 max-w-3xl text-muted">
      Every provider exposes the same shape — a named source with a byte stream and SP 800-90B
      health accounting — so a QRNG, a public beacon, or your browser’s CSPRNG all plug in
      identically. This page rains bits from the source picked in the header — switch it to a public
      beacon or a quantum RNG and watch the throughput change (network sources fall back to the
      local CSPRNG if blocked).
    </p>
    <ClientOnly>
      <EntropyDemo class="mt-6" />
      <template #fallback>
        <div class="mt-6 text-muted">Loading entropy source…</div>
      </template>
    </ClientOnly>
  </UContainer>
</template>
