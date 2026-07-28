<script setup lang="ts">
import type { ScanReport } from '@mindpeeker/scan'
import { defineCatalog, scan } from '@mindpeeker/scan'
import { provider } from '~/lib/entropy'

const DEFAULT_CATALOG = [
  'Rest',
  'Movement',
  'Water',
  'Fire',
  'Focus',
  'Release',
  'Grounding',
  'Clarity',
  'Balance',
  'Vitality',
]

const text = ref(DEFAULT_CATALOG.join('\n'))
const running = ref(false)
const report = ref<ScanReport>()
const message = ref<string>()

const items = computed(() =>
  text.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean),
)

const fmt = (n: number, digits: number) => n.toFixed(digits)

async function run(): Promise<void> {
  if (items.value.length < 3) {
    message.value = 'add at least 3 items'
    report.value = undefined
    return
  }
  message.value = undefined
  running.value = true
  try {
    const catalog = defineCatalog(
      'demo',
      'Demo catalog',
      items.value.map((name) => ({ name })),
    )
    report.value = await scan(catalog, provider, { deviationRounds: 128 })
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
    report.value = undefined
  } finally {
    running.value = false
  }
}

onMounted(run)
</script>

<template>
  <div class="grid lg:grid-cols-2 gap-4">
    <UCard class="h-fit">
      <label class="text-xs text-muted uppercase tracking-wide">Catalog (one item per line)</label>
      <UTextarea v-model="text" :rows="10" class="w-full mt-1 font-mono" />
      <div class="mt-3 flex items-center gap-3">
        <UButton :loading="running" @click="run">Scan catalog</UButton>
        <UBadge color="neutral" variant="subtle">{{ items.length }} items</UBadge>
      </div>
    </UCard>

    <UCard>
      <h3 class="font-semibold mb-2">Ranked results</h3>
      <p v-if="message" class="text-sm text-muted">{{ message }}</p>
      <div v-else-if="report" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-right py-1.5 pr-3 font-medium">#</th>
              <th class="text-left py-1.5 px-3 font-medium">Item</th>
              <th class="text-left py-1.5 px-3 font-medium">Energy</th>
              <th class="text-right py-1.5 px-3 font-medium">Vitality</th>
              <th class="text-right py-1.5 px-3 font-medium">z</th>
              <th class="text-right py-1.5 pl-3 font-medium">BF₁₀</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in report.results" :key="r.rank" class="border-t border-default">
              <td class="py-1.5 pr-3 text-right font-mono text-muted">{{ r.rank }}</td>
              <td class="py-1.5 px-3">{{ r.name }}</td>
              <td class="py-1.5 px-3">
                <div v-if="r.energy !== undefined" class="h-2.5 w-20 rounded-full bg-elevated overflow-hidden">
                  <div class="h-full bg-primary" :style="{ width: `${Math.round(r.energy * 100)}%` }" />
                </div>
                <span v-else class="text-muted">—</span>
              </td>
              <td class="py-1.5 px-3 text-right font-mono">
                {{ r.vitality === undefined ? '—' : Math.round(r.vitality) }}
              </td>
              <td class="py-1.5 px-3 text-right font-mono">
                {{ r.deviation ? fmt(r.deviation.z, 2) : '—' }}
              </td>
              <td class="py-1.5 pl-3 text-right font-mono">
                {{ r.deviation ? fmt(r.deviation.bayesFactor, 2) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="text-xs text-muted mt-3">
          {{ report.numberOfTrials }} race passes · {{ report.accounting.bytesConsumed }} bytes from
          “{{ report.source }}”. With {{ report.results.length }} items, expect
          ~{{ (0.05 * report.results.length).toFixed(1) }} to cross p&lt;0.05 by chance — energy and
          vitality have no chance baseline at all.
        </p>
      </div>
      <p v-else class="text-sm text-muted">scanning…</p>
    </UCard>
  </div>
</template>
