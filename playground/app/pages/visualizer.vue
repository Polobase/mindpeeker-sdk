<template>
  <UContainer class="py-10">
    <p class="font-mono text-sm text-primary uppercase tracking-widest">@mindpeeker/visualizer</p>
    <h1 class="mt-2 text-3xl font-bold tracking-tight">Live entropy dashboard</h1>
    <p class="mt-2 max-w-3xl text-muted">
      The package’s hand-rolled WebGL2 panels, driven entirely in your browser: a scrolling byte
      bitmap, Shannon entropy per chunk, a GCP-style cumulative-deviation walk against its χ²
      envelope, and a byte-value density heatmap — no server, no socket.
    </p>
    <ClientOnly>
      <VisualizerDemo class="mt-6" />
      <template #fallback><div class="mt-6 text-muted">Loading dashboard…</div></template>
    </ClientOnly>
  </UContainer>
</template>
