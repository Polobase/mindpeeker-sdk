<script setup lang="ts">
import { DEFAULT_BASE } from '@mindpeeker/rate'
import { sourceSummary } from '~/lib/entropy'
import { parsedRate, rateForms } from '~/lib/rate/state'

/**
 * The rate page: one card per export group of `@mindpeeker/rate`, all reading
 * the single rate in `~/lib/rate/state`. Every section is client-only because
 * the SDK resolves to package source through the Vite aliases.
 */

const source = sourceSummary()
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
      <UBadge color="neutral" variant="subtle">default base {{ DEFAULT_BASE }}</UBadge>
      <span>
        current rate
        <code class="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs text-highlighted">
          {{ rateForms?.canonical ?? '—' }}
        </code>
        <template v-if="parsedRate">
          · {{ parsedRate.digits.length }} rings · base {{ parsedRate.base }}
        </template>
      </span>
      <span class="hidden sm:inline">·</span>
      <span>
        random draws use the header source:
        <span class="text-highlighted">{{ source.label }}</span>
        <template v-if="source.network"> (press Run; nothing auto-fetches)</template>
      </span>
    </div>

    <RateCard />
    <RateGeometry />
    <RateCircular />
    <RateModulation />
    <RatePhase />
    <RateProvenance />
  </div>
</template>
