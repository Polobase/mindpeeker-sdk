<script setup lang="ts">
/**
 * @mindpeeker/negentropy — the whole package, one tab per export group.
 *
 * Each tab mounts only while it is selected, so a live session or a long
 * simulation is torn down (useTask aborts on unmount) when you navigate away.
 */
import { sourceSummary } from '~/lib/entropy'

const TABS = [
  { value: 'quality', label: 'Quality', icon: 'i-lucide-ruler' },
  { value: 'network', label: 'Network', icon: 'i-lucide-network' },
  { value: 'sequential', label: 'Sequential', icon: 'i-lucide-activity' },
  { value: 'registration', label: 'Pre-registration', icon: 'i-lucide-file-lock-2' },
  { value: 'session', label: 'Live session', icon: 'i-lucide-radio' },
  { value: 'extraction', label: 'Extraction', icon: 'i-lucide-filter' },
  { value: 'numerics', label: 'Numerics', icon: 'i-lucide-sigma' },
] as const

const tab = useTabQuery('quality', { tabs: TABS.map((t) => t.value) })
const summary = sourceSummary()
</script>

<template>
  <div class="flex flex-col gap-5">
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-default bg-elevated/40 px-3 py-2 text-sm"
    >
      <UIcon name="i-lucide-dices" class="size-4 text-primary shrink-0" />
      <span class="text-muted">Every draw on this page comes from</span>
      <span class="font-mono text-highlighted">{{ summary.label }}</span>
      <UBadge size="sm" color="neutral" variant="subtle" class="font-mono">
        {{ summary.providerName }}
      </UBadge>
      <UBadge v-if="summary.deterministic" size="sm" color="primary" variant="subtle">
        deterministic · seed “{{ summary.seedLabel }}”
      </UBadge>
      <span class="text-xs text-dimmed basis-full sm:basis-auto sm:ml-auto">
        change it in the header · null-path simulations and control arms use their own DRBG seeds
      </span>
    </div>

    <UTabs v-model="tab" :items="[...TABS]" :content="false" class="w-full" />

    <div v-if="tab === 'quality'" class="flex flex-col gap-5">
      <NegentropyQuality />
      <NegentropyWindowed />
    </div>
    <NegentropyNetwork v-else-if="tab === 'network'" />
    <NegentropySequential v-else-if="tab === 'sequential'" />
    <NegentropyRegistration v-else-if="tab === 'registration'" />
    <NegentropySession v-else-if="tab === 'session'" />
    <div v-else-if="tab === 'extraction'" class="flex flex-col gap-5">
      <NegentropyExtract />
      <NegentropyAccounting />
      <NegentropyHealth />
    </div>
    <NegentropyNumerics v-else-if="tab === 'numerics'" />
  </div>
</template>
