<script setup lang="ts">
/**
 * @mindpeeker/entropy, explored one export group at a time. Each tab mounts
 * its own section, so leaving a tab aborts whatever it had running.
 */
import { sourceSummary } from '~/lib/entropy'

const TABS = [
  { value: 'catalogue', label: 'Sources', icon: 'i-lucide-list-tree' },
  { value: 'stream', label: 'Live stream', icon: 'i-lucide-activity' },
  { value: 'local', label: 'Local hardware', icon: 'i-lucide-cpu' },
  { value: 'health', label: 'Health tests', icon: 'i-lucide-heart-pulse' },
  { value: 'strategies', label: 'Strategies', icon: 'i-lucide-git-merge' },
  { value: 'control', label: 'Control arm', icon: 'i-lucide-repeat' },
  { value: 'beacons', label: 'Beacons', icon: 'i-lucide-radio-tower' },
] as const

const tab = useTabQuery('catalogue', { tabs: TABS.map((t) => t.value) })
const summary = sourceSummary()
</script>

<template>
  <div class="flex flex-col gap-5">
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-default bg-elevated/40 px-3 py-2.5"
    >
      <span class="text-xs uppercase tracking-wide text-muted">Header source</span>
      <span class="font-mono text-sm text-highlighted break-all">{{ summary.providerName }}</span>
      <UBadge size="sm" color="neutral" variant="subtle">{{ summary.kind }}</UBadge>
      <UBadge v-if="summary.deterministic" size="sm" color="primary" variant="subtle">
        deterministic · seed “{{ summary.seedLabel }}”
      </UBadge>
      <UBadge v-if="summary.network" size="sm" color="warning" variant="subtle">
        network · CSPRNG fallback after 3.5 s
      </UBadge>
      <span class="text-xs text-muted">{{ summary.note }}</span>
    </div>

    <UTabs
      v-model="tab"
      :items="[...TABS]"
      :content="false"
      size="sm"
      :ui="{ list: 'overflow-x-auto' }"
    />

    <EntropyCatalogue v-if="tab === 'catalogue'" />
    <EntropyStream v-else-if="tab === 'stream'" />
    <EntropyLocal v-else-if="tab === 'local'" />
    <EntropyHealth v-else-if="tab === 'health'" />
    <EntropyStrategies v-else-if="tab === 'strategies'" />
    <EntropyControl v-else-if="tab === 'control'" />
    <EntropyBeacons v-else-if="tab === 'beacons'" />
  </div>
</template>
