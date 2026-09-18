<script setup lang="ts">
/**
 * Runes — the five shipped rows as data: order, names, ættir, and which glyphs
 * have a distinguishable upside-down form.
 */
import type { Futhark } from '@mindpeeker/oracle'
import { ELDER_FUTHARK, FUTHARKS, RUNE_LAYOUTS } from '@mindpeeker/oracle'

const ROWS = [
  { value: 'elder', label: 'Elder Futhark (24)' },
  { value: 'younger', label: 'Younger Futhark (16)' },
  { value: 'futhorc28', label: 'Futhorc 28' },
  { value: 'futhorc29', label: 'Futhorc 29' },
  { value: 'futhorc33', label: 'Futhorc 33' },
] as const

const SOURCES: Record<Futhark, string> = {
  elder: 'Thorsson (1984); identical order in Gundarsson (1990).',
  younger:
    'Norwegian rune poem (Dickins 1915, pp. 24–27), long-branch glyphs, ættir 6/5/5.',
  futhorc28: 'The rune-poem row without īor; manuscript orders differ, so this is a documented convention.',
  futhorc29: 'Old English rune poem stanza order (Hickes 1705, ed. Dickins 1915).',
  futhorc33: 'The poem’s 29 plus cweorð, calc, stān, gār in Hickes’ order.',
}

const row = ref<Futhark>('elder')
const runes = computed(() => FUTHARKS[row.value])
const symmetric = computed(() => ELDER_FUTHARK.filter((r) => !r.invertible))
const norns = RUNE_LAYOUTS.norns
</script>

<template>
  <DemoSection
    id="runes-rows"
    title="The rows, as data"
    :api="['FUTHARKS', 'ELDER_FUTHARK', 'YOUNGER_FUTHARK', 'FUTHORC_28', 'FUTHORC_29', 'FUTHORC_33', 'RUNE_LAYOUTS']"
    description="Every row is a frozen table with its source. Which runes are point-symmetric depends on the glyph form a carver uses, so a reversal set is claimed only for the Elder Futhark."
    :level="2"
  >
    <template #controls>
      <UFormField label="Row" size="sm" class="w-full sm:w-64">
        <USelect v-model="row" :items="ROWS" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <p class="text-sm text-muted">{{ SOURCES[row] }}</p>

      <div class="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        <div
          v-for="rune in runes"
          :key="rune.id"
          class="rounded-md border border-default bg-elevated/30 px-2 py-1.5 text-center"
          :class="rune.invertible ? '' : 'border-dashed'"
          :title="rune.invertible ? 'invertible — merkstave costs one bit' : 'point-symmetric — no merkstave, no bit'"
        >
          <div class="text-2xl leading-none text-highlighted">{{ rune.glyph }}</div>
          <div class="mt-1 truncate text-[11px] text-muted">{{ rune.name }}</div>
          <div class="font-mono text-[10px] text-dimmed">
            {{ rune.index }}<template v-if="rune.aett"> · ætt {{ rune.aett }}</template>
          </div>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile label="Runes in the row" :value="runes.length" note="the blank rune is opt-in" />
        <StatTile
          label="Invertible"
          :value="runes.filter((r) => r.invertible).length"
          note="merkstave modeled only for the Elder row"
        />
        <StatTile label="Layouts" :value="1" :note="`'${norns.id}' — ${norns.name}`" />
      </div>

      <div class="rounded-md border border-default bg-elevated/30 p-3">
        <p class="text-xs uppercase tracking-wide text-muted">
          The nine Elder runes that read the same upright and reversed
        </p>
        <p class="mt-1.5 flex flex-wrap items-center gap-3 text-2xl text-highlighted">
          <span v-for="rune in symmetric" :key="rune.id" :title="rune.name">{{ rune.glyph }}</span>
        </p>
        <p class="mt-1.5 text-xs text-muted">
          {{ symmetric.map((r) => r.name).join(', ') }} — the geometric criterion and the standard
          nine-rune non-reversible set of the divination literature coincide exactly. Note the
          deliberate divergence from the mindpeeker frontend: Nauthiz is non-invertible here,
          because its glyph is point-symmetric.
        </p>
      </div>
    </div>

    <template #footer>
      Names are the common reconstructed forms popularized in modern rune divination; the historical
      rows and the modern reading practice are different things, and the package does not blur them.
    </template>
  </DemoSection>
</template>
