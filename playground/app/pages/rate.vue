<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/rate</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Radionic rate card</h1>
    <p class="mt-2 max-w-3xl text-muted">
      A Malcolm Rae rate encodes an item as base-44 digits, each a fraction of a turn on a dial.
      Type a rate (dash- or dot-separated) to render its card geometry as SVG and read every digit’s
      phase angle, or draw a random rate from your selected entropy source.
    </p>
    <ClientOnly>
      <RateDemo class="mt-6" />
      <template #fallback>
        <div class="mt-6 text-muted">Loading rate card…</div>
      </template>
    </ClientOnly>
  </UContainer>
</template>
