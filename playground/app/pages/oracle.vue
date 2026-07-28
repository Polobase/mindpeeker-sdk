<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/oracle</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Divination from entropy</h1>
    <p class="mt-2 max-w-3xl text-muted">
      Map an entropy stream to a symbolic system with exact, unbiased probabilities — the I-Ching, a
      Tarot spread, an Elder Futhark rune draw, or a geomancy shield. Each cast is reproducible from
      the bytes it consumed; the mathematics is asserted, the meaning is not.
    </p>
    <ClientOnly>
      <OracleDemo class="mt-6" />
      <template #fallback>
        <div class="mt-6 text-muted">Loading oracle…</div>
      </template>
    </ClientOnly>
  </UContainer>
</template>
