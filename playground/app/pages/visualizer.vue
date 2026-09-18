<template>
  <DemoPage id="visualizer">
    <template #intro>
      The package’s hand-rolled WebGL2 panels, mounted straight into this page: a scrolling noise
      bitmap, windowed negentropy, the GCP cumulative deviation against both a pointwise χ² band and
      a time-uniform anytime-valid boundary, the running netvar Z with its anytime p, a decaying byte
      histogram and a base-44 rate card. Every frame is produced by the package’s own wire encoders
      and read back by <code class="font-mono text-xs">decodeFrame</code> — the Bun WebSocket server
      is the only piece a browser cannot run.
    </template>
    <VisualizerDemo />
  </DemoPage>
</template>
