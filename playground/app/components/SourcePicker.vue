<script setup lang="ts">
/**
 * The entropy source every demo draws from, plus the DRBG seed behind the
 * reproducible source. SSR-safe: the stored selection is read after mount, and
 * changing it reloads the page so every demo rebuilds its provider.
 */
withDefaults(defineProps<{ block?: boolean }>(), { block: false })

const sourceId = ref(DEFAULT_SOURCE_ID)
const seed = ref(DEFAULT_SEED_LABEL)

onMounted(() => {
  sourceId.value = currentSourceId()
  seed.value = currentSeedLabel()
})

const items = SOURCE_META.map((s) => ({ label: s.label, value: s.id }))
const meta = computed(() => sourceMeta(sourceId.value))

function onSource(value: unknown): void {
  setSourceId(String(value))
  location.reload()
}

function applySeed(): void {
  setSeedLabel(seed.value)
  setSourceId('drbg')
  location.reload()
}

function randomSeed(): void {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  seed.value = `seed-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}
</script>

<template>
  <div class="flex items-center gap-1.5" :class="block ? 'w-full' : ''">
    <label :for="'entropy-source'" class="sr-only">Entropy source for every demo</label>
    <USelect
      id="entropy-source"
      v-model="sourceId"
      :items="items"
      size="sm"
      icon="i-lucide-dices"
      :class="block ? 'flex-1' : 'w-48'"
      :ui="{ base: 'truncate' }"
      @update:model-value="onSource"
    />
    <UPopover :content="{ align: 'end' }">
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-key-round"
        aria-label="Entropy source details and DRBG seed"
      />
      <template #content>
        <div class="w-80 max-w-[90vw] p-4 flex flex-col gap-3">
          <div>
            <p class="text-sm font-semibold text-highlighted">{{ meta.label }}</p>
            <p class="mt-0.5 text-xs text-muted">{{ meta.note }}</p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <UBadge size="sm" color="neutral" variant="subtle">{{ meta.kind }}</UBadge>
              <UBadge v-if="meta.network" size="sm" color="neutral" variant="subtle">
                network · falls back to the local CSPRNG
              </UBadge>
              <UBadge v-if="meta.deterministic" size="sm" color="primary" variant="subtle">
                deterministic
              </UBadge>
            </div>
          </div>

          <UFormField
            label="DRBG seed"
            description="Same seed + same actions ⇒ same bytes. A control, never a secret."
            size="sm"
          >
            <div class="flex gap-1.5">
              <UInput v-model="seed" size="sm" class="flex-1" placeholder="mindpeeker playground" />
              <UButton
                color="neutral"
                variant="subtle"
                size="sm"
                icon="i-lucide-refresh-cw"
                aria-label="Random seed label"
                @click="randomSeed"
              />
            </div>
          </UFormField>

          <UButton size="sm" icon="i-lucide-rotate-ccw" block @click="applySeed">
            {{ meta.deterministic ? 'Apply seed & reload' : 'Use the seeded DRBG & reload' }}
          </UButton>
          <p class="text-xs text-dimmed">
            Selecting a source reloads the page so every demo rebuilds its provider from scratch.
          </p>
        </div>
      </template>
    </UPopover>
  </div>
</template>
