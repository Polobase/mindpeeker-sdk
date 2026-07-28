<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/gematria</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Gematria calculator</h1>
    <p class="mt-2 max-w-3xl text-muted">
      31 exact-integer ciphers across Hebrew, Greek, Arabic and English/Latin — including Peter
      Plichta’s Prime Cross. Reverse is a parameter, shown as its own column. Computation is exact;
      what equal values mean is a contested tradition.
    </p>
    <ClientOnly>
      <GematriaDemo class="mt-6" />
      <template #fallback>
        <div class="mt-6 text-muted">Loading calculator…</div>
      </template>
    </ClientOnly>
  </UContainer>
</template>
