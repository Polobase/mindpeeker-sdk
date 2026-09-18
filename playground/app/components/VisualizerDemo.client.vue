<script setup lang="ts">
/**
 * @mindpeeker/visualizer — three tabs: the live dashboard (the package's own
 * WebGL2 panels, driven in this page), what its two envelopes promise, and the
 * CLI half that needs Bun.
 *
 * Each tab is its own client-only component; switching tabs unmounts the
 * previous one, which stops its driver and aborts its run.
 */
const TABS = [
  { value: 'dashboard', label: 'Live dashboard', icon: 'i-lucide-activity' },
  { value: 'envelopes', label: 'Envelopes', icon: 'i-lucide-chart-spline' },
  { value: 'cli', label: 'CLI, recording & security', icon: 'i-lucide-terminal' },
] as const

const tab = useTabQuery('dashboard', { tabs: TABS.map((t) => t.value) })
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="rounded-lg border border-default bg-elevated/30 p-4 text-sm text-muted">
      <p>
        The package is two halves. A <strong class="text-highlighted">Bun WebSocket server</strong>
        takes any <code class="font-mono text-xs">AsyncIterable</code> — raw bytes, statistic series,
        matrices, a static JSON document — puts each producer's frames in a per-channel drop-oldest
        ring buffer and fans them out to sockets that are keeping up. A
        <strong class="text-highlighted">zero-dependency WebGL2 client</strong> decodes those frames
        into one panel per channel. Only the first half needs Bun; the wire protocol and every line of
        client code are pure and browser-safe, enforced by the package's own client-safety test. So
        this page runs the second half for real — the same panels, fed frames the same encoders
        produced — with the socket left out.
      </p>
    </div>

    <UTabs
      v-model="tab"
      :items="TABS"
      :content="false"
      class="w-full"
      :ui="{ root: 'w-full min-w-0', list: 'w-full overflow-x-auto', trigger: 'shrink-0' }"
    />

    <VisualizerDashboard v-if="tab === 'dashboard'" />
    <VisualizerBands v-else-if="tab === 'envelopes'" />
    <VisualizerCli v-else-if="tab === 'cli'" />
  </div>
</template>
