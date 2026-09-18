<script setup lang="ts">
/**
 * The static channel: one JSON document, published once, rendered by the dial
 * panel. Edit the geometry here and the sixth panel above re-tessellates —
 * including the failure path, where an out-of-range pointer turns the badge red
 * with the reason instead of drawing something wrong.
 */
import type { RateCardGeometry } from '@viz/src/types'

const props = defineProps<{ geometry: RateCardGeometry }>()
const emit = defineEmits<{ 'update:geometry': [RateCardGeometry] }>()

const SECTOR_CHOICES = [
  { label: '44 — Malcolm Rae base-44', value: 44 },
  { label: '22', value: 22 },
  { label: '12', value: 12 },
]

const RING_CHOICES = [
  { label: '4 rings · 0.3 0.5 0.7 0.9', value: 4 },
  { label: '3 rings · 0.35 0.65 0.95', value: 3 },
  { label: '1 ring · 0.9 (spokes from the centre)', value: 1 },
]

const RING_SETS: Record<number, readonly number[]> = {
  4: [0.3, 0.5, 0.7, 0.9],
  3: [0.35, 0.65, 0.95],
  1: [0.9],
}

const sectors = ref(props.geometry.sectors)
const ringCount = ref(4)
const pointer = ref(props.geometry.pointerSector ?? 0)
const invalid = ref(false)

const document_ = computed<RateCardGeometry>(() => ({
  type: 'rate-card',
  sectors: sectors.value,
  rings: RING_SETS[ringCount.value] ?? RING_SETS[4] ?? [0.9],
  pointerSector: invalid.value ? sectors.value : Math.min(pointer.value, sectors.value - 1),
  label: invalid.value ? 'deliberately invalid document' : 'sample base-44 rate card',
}))

watch(
  document_,
  (next) => {
    emit('update:geometry', next)
  },
  { flush: 'post' },
)

watch(sectors, (n) => {
  if (pointer.value > n - 1) pointer.value = n - 1
})

const json = computed(() => JSON.stringify(document_.value, null, 2))

const snippet = computed(
  () => `// A producer publishes plain JSON — the visualizer never imports @mindpeeker/rate.
// An unserializable document (BigInt, a cycle, undefined) throws
// VisualizerError('invalid_channel') at attach time and registers nothing.
dash.attachStatic('rate card', ${json.value})

// In this page there is no server, so the document goes straight to the panel:
dash.setStatic(5, document)   // channel 5 is the static 'rate card' channel`,
)
</script>

<template>
  <DemoSection
    title="Rate card — the static channel"
    :api="['attachStatic', 'setStatic', 'RateCardGeometry', 'tessellateDial']"
    description="A static channel carries one JSON document, serialized once at attach time. The
      client's dial panel tessellates it into line lists: sector 0 at 12 o'clock, clockwise, with a
      pulsing pointer and a slow radar sweep. Change it and the sixth panel above redraws."
  >
    <template #controls>
      <UFormField label="Sectors" size="sm" class="w-60">
        <USelect v-model="sectors" :items="SECTOR_CHOICES" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Rings" size="sm" class="w-64">
        <USelect v-model="ringCount" :items="RING_CHOICES" size="sm" class="w-full" />
      </UFormField>
      <UFormField :label="`Pointer sector — ${pointer}`" size="sm" class="w-56">
        <USlider
          v-model="pointer"
          :min="0"
          :max="Math.max(0, sectors - 1)"
          :step="1"
          :disabled="invalid"
          class="mt-2"
          aria-label="Pointer sector"
        />
      </UFormField>
      <UCheckbox v-model="invalid" label="Send an invalid document" />
    </template>

    <div class="grid gap-3 lg:grid-cols-2">
      <div class="flex min-w-0 flex-col gap-3">
        <StatTile
          label="angular resolution"
          :value="360 / sectors"
          :digits="2"
          size="sm"
          :note="`degrees per sector · ${sectors} sectors, pointer at ${Math.min(pointer, sectors - 1)}`"
        />
        <UAlert
          v-if="invalid"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="pointerSector out of range"
          :description="`pointerSector must be an integer in [0, ${sectors}). This document sends
            ${sectors}, so the dial panel drops its geometry and the badge reads the reason — the
            panel never draws a pointer it cannot place.`"
        />
        <p v-else class="text-sm text-muted">
          The document above is the one the sixth panel is rendering right now. The client validates
          it on arrival: a <code class="font-mono text-xs">pointerSector</code> outside
          <code class="font-mono text-xs">[0, sectors)</code> or a ring radius outside
          <code class="font-mono text-xs">(0, 1]</code> shows an error badge instead of a wrong
          drawing. With fewer than two distinct radii the spokes run from the centre.
        </p>
      </div>
      <CodeSnippet :code="snippet" lang="ts" title="the document, as a producer publishes it" />
    </div>

    <template #footer>
      Base-44 is Malcolm Rae's rate notation: one sector per symbol position, a rate written as
      ring/sector coordinates. The geometry is exact; that such a card selects anything in the world
      is a radionics claim this package neither encodes nor supports —
      <code class="font-mono text-xs">@mindpeeker/rate</code> is where that framing lives.
    </template>
  </DemoSection>
</template>
