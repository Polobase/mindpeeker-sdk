<script setup lang="ts">
/**
 * Runes — a uniform draw without replacement from one of five rows, with the
 * optional modern blank rune, Elder-Futhark merkstave bits, the Norn layout,
 * and the three-sets reading that returns the runes to the pouch between sets.
 */
import type { Futhark, RuneCast, RuneSetsCast } from '@mindpeeker/oracle'
import { castRuneSets, castRunes, FUTHARKS } from '@mindpeeker/oracle'
import { sourceSummary, withReader } from '~/lib/entropy'
import { clampInt, fmtBig, orderedDeals } from '~/lib/oracle/exact'
import { autoRunAllowed } from '~/lib/oracle/sources'

const FUTHARK_ITEMS = [
  { value: 'elder', label: 'Elder Futhark — 24, three ættir of eight' },
  { value: 'younger', label: 'Younger Futhark — 16, Norwegian rune poem' },
  { value: 'futhorc28', label: 'Anglo-Saxon futhorc — 28 (no īor)' },
  { value: 'futhorc29', label: 'Anglo-Saxon futhorc — 29, rune-poem order' },
  { value: 'futhorc33', label: 'Anglo-Saxon futhorc — 33, with Hickes’ four' },
] as const

const MODES = [
  { value: 'count', label: 'A number of runes' },
  { value: 'norns', label: 'The Three Norns — Urðr, Verðandi, Skuld' },
] as const

const SET_PRESETS = [
  { value: '3,3,1', label: '3 + 3 + 1 — Arcarti’s three-sets reading' },
  { value: '3,3', label: '3 + 3' },
  { value: '1,1,1,1', label: '1 + 1 + 1 + 1' },
] as const

const futhark = ref<Futhark>('elder')
const mode = ref<'count' | 'norns'>('norns')
const count = ref(3)
const blank = ref(false)
const merkstave = ref(true)
const setSizes = ref('3,3,1')

const summary = sourceSummary()
const draw = useTask<RuneCast>()
const sets = useTask<RuneSetsCast>()

const rowSize = computed(() => FUTHARKS[futhark.value].length + (blank.value ? 1 : 0))
const safeCount = computed(() => clampInt(count.value, 1, rowSize.value, 3))
const elder = computed(() => futhark.value === 'elder')
const merkstaveOn = computed(() => elder.value && merkstave.value)

watch(futhark, () => {
  if (!elder.value) merkstave.value = false
  if (count.value > rowSize.value) count.value = rowSize.value
})

const options = computed(() => ({
  futhark: futhark.value,
  blank: blank.value,
  merkstave: merkstaveOn.value,
}))

function go(): void {
  void draw.run((signal) =>
    withReader(
      (reader) =>
        mode.value === 'norns'
          ? castRunes(reader, 'norns', options.value)
          : castRunes(reader, safeCount.value, options.value),
      { signal },
    ),
  )
}

/** Deliberately invalid: merkstave is modeled for the Elder Futhark only. */
function showTypedError(): void {
  void draw.run((signal) =>
    withReader((reader) => castRunes(reader, 3, { futhark: 'younger', merkstave: true }), {
      signal,
    }),
  )
}

function goSets(): void {
  const sizes = setSizes.value.split(',').map((s) => Number.parseInt(s, 10))
  void sets.run((signal) =>
    withReader((reader) => castRuneSets(reader, sizes, options.value), { signal }),
  )
}

const drawn = computed(() => draw.result.value)
const setsCast = computed(() => sets.result.value)
const drawnCount = computed(() => (mode.value === 'norns' ? 3 : safeCount.value))
const orderedDraws = computed(() => fmtBig(orderedDeals(rowSize.value, drawnCount.value)))

const SET_TITLES = [
  'The circumstances',
  'Courses of action or outcomes',
  'The influence on the whole',
  'Fourth set',
]

const code = computed(
  () => `import { castRunes, castRuneSets } from '@mindpeeker/oracle'

const cast = await castRunes(source, ${mode.value === 'norns' ? "'norns'" : safeCount.value}, {
  futhark: '${futhark.value}', blank: ${blank.value}, merkstave: ${merkstaveOn.value},
})
cast.runes.map((d) => d.rune.glyph + (d.merkstave ? ' (merkstave)' : ''))

// Sets return the runes to the pouch between draws:
await castRuneSets(source, [${setSizes.value}], { futhark: '${futhark.value}' })`,
)

onMounted(() => {
  if (autoRunAllowed()) go()
})
</script>

<template>
  <DemoSection
    id="runes-draw"
    title="Draw runes"
    :api="['castRunes', 'FUTHARKS', 'RUNE_LAYOUTS', 'drawWithoutReplacement']"
    description="A Fisher–Yates prefix over the chosen row — every one of the n!/(n−c)! ordered draws exactly equiprobable — then one merkstave bit per invertible rune, in draw order."
  >
    <template #controls>
      <UFormField label="Row" size="sm" class="w-full sm:w-80">
        <USelect v-model="futhark" :items="FUTHARK_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Layout" size="sm" class="w-full sm:w-64">
        <USelect v-model="mode" :items="MODES" class="w-full" />
      </UFormField>
      <UFormField v-if="mode === 'count'" label="Runes" size="sm" class="w-32">
        <UInputNumber v-model="count" :min="1" :max="rowSize" class="w-full" />
      </UFormField>
      <div class="flex flex-col gap-2 pb-1">
        <USwitch v-model="blank" :label="`Blank rune (${rowSize} in the pouch)`" size="sm" />
        <USwitch
          v-model="merkstave"
          label="Merkstave bits"
          size="sm"
          :disabled="!elder"
          :description="elder ? undefined : 'Elder Futhark only'"
        />
      </div>
      <RunControls
        :busy="draw.busy.value"
        label="Draw"
        busy-label="Drawing…"
        icon="i-lucide-feather"
        :hint="`≈ ${drawnCount} bytes from ${summary.providerName}`"
        @run="go"
        @cancel="draw.cancel()"
      >
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-triangle-alert"
          :disabled="draw.busy.value"
          @click="showTypedError"
        >
          Show a typed error
        </UButton>
      </RunControls>
    </template>

    <ErrorAlert :err="draw.error.value" title="The draw failed" @dismiss="draw.reset()" />

    <div v-if="drawn" class="flex flex-col gap-4">
      <p v-if="drawn.layout" class="text-sm text-muted">
        {{ drawn.layout.name }} — that which is, that which is becoming, and what should result if
        nothing is done to change things (Gundarsson 1990).
      </p>

      <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div
          v-for="(item, i) in drawn.runes"
          :key="`${item.rune.id}-${i}`"
          class="rounded-lg border border-default bg-elevated/40 p-3"
          :class="item.merkstave ? 'border-warning/50' : ''"
        >
          <p v-if="item.position" class="font-mono text-[11px] text-primary">
            {{ item.position.name }}
          </p>
          <div
            class="mt-1 text-4xl leading-none text-highlighted"
            :class="item.merkstave ? 'inline-block rotate-180' : ''"
            :aria-label="`${item.rune.name}${item.merkstave ? ' merkstave' : ''}`"
          >
            {{ item.rune.glyph || '▢' }}
          </div>
          <h3 class="mt-2 text-sm font-semibold text-highlighted">{{ item.rune.name }}</h3>
          <p class="mt-0.5 text-[11px] text-muted">
            {{ item.rune.aettName === null ? 'no ætt modeled' : `${item.rune.aettName}’s ætt` }}
            · index {{ item.rune.index }}
          </p>
          <div class="mt-1.5 flex flex-wrap gap-1">
            <UBadge v-if="item.merkstave" color="warning" variant="subtle" size="sm">
              merkstave
            </UBadge>
            <UBadge v-if="item.rune.modern" color="info" variant="subtle" size="sm">
              modern (Blum 1982)
            </UBadge>
            <UBadge
              v-if="merkstaveOn && !item.rune.invertible"
              color="neutral"
              variant="subtle"
              size="sm"
              title="Point-symmetric glyph: spending a bit on it would be wasted entropy."
            >
              no orientation
            </UBadge>
          </div>
          <p v-if="item.position" class="mt-1.5 text-[11px] leading-snug text-dimmed">
            {{ item.position.meaning }}
          </p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Row" :value="drawn.futhark" :mono="false" :note="`${rowSize} runes`" />
        <StatTile
          label="Ordered draws"
          :value="orderedDraws"
          note="all exactly equiprobable"
          size="sm"
        />
        <StatTile label="Bytes consumed" :value="drawn.bytesConsumed" note="≈ 1 byte per rune" />
        <StatTile
          label="Bits used"
          :value="drawn.bitsUsed"
          note="draw bytes + one bit per invertible rune"
        />
      </div>

      <AccountingBadge
        :bytes-consumed="drawn.bytesConsumed"
        :bytes-fetched="drawn.bytesFetched"
        :bits-used="drawn.bitsUsed"
        :source="summary.providerName"
      />

      <HonestNote variant="caveat" title="Two data choices worth knowing">
        The blank rune is Ralph Blum's 1982 addition, rejected by traditional runeworkers — offered,
        labelled, and off by default. Merkstave is modeled for the Elder Futhark only: the nine
        point-symmetric runes (Gebo, Hagalaz, Nauthiz, Isa, Jera, Eihwaz, Sowilo, Ingwaz, Dagaz)
        consume no bit, and other rows have no modeled reversal convention at all — asking for one
        throws <code>OracleError('invalid_input')</code>, as the button above shows.
      </HonestNote>

      <CodeSnippet :code="code" title="what this button ran" />
    </div>

    <template #footer>
      Ætt names vary: Freyr's or Freyja's, Heimdall's or Hagal's, Tyr's or Tiwaz's. The data use
      Freyr, Heimdall, Tyr and say so — attributions are data, not doctrine.
    </template>
  </DemoSection>

  <DemoSection
    id="runes-sets"
    title="Three sets, pouch refilled between them"
    :api="['castRuneSets']"
    description="Three runes for the circumstances, returned to the pouch; three for the courses of action, returned; one for the whole (Arcarti 1993). Each set is an independent draw without replacement — a rune may recur across sets, never within one."
  >
    <template #controls>
      <UFormField label="Set sizes" size="sm" class="w-full sm:w-80">
        <USelect v-model="setSizes" :items="SET_PRESETS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="sets.busy.value"
        label="Cast the sets"
        busy-label="Casting…"
        icon="i-lucide-layers"
        :hint="`row: ${futhark}, ${rowSize} runes`"
        @run="goSets"
        @cancel="sets.cancel()"
      />
    </template>

    <ErrorAlert :err="sets.error.value" title="The cast failed" @dismiss="sets.reset()" />

    <div v-if="setsCast" class="flex flex-col gap-4">
      <div
        v-for="(set, s) in setsCast.sets"
        :key="s"
        class="rounded-md border border-default bg-elevated/30 p-3"
      >
        <p class="text-[11px] uppercase tracking-wide text-muted">
          Set {{ s + 1 }} — {{ SET_TITLES[s] ?? `Set ${s + 1}` }}
        </p>
        <div class="mt-2 flex flex-wrap gap-4">
          <div v-for="(item, i) in set" :key="`${item.rune.id}-${i}`" class="text-center">
            <div
              class="text-3xl leading-none text-highlighted"
              :class="item.merkstave ? 'inline-block rotate-180' : ''"
            >
              {{ item.rune.glyph || '▢' }}
            </div>
            <div class="mt-1 text-xs text-muted">{{ item.rune.name }}</div>
          </div>
        </div>
      </div>

      <AccountingBadge
        :bytes-consumed="setsCast.bytesConsumed"
        :bytes-fetched="setsCast.bytesFetched"
        :bits-used="setsCast.bitsUsed"
        :source="summary.providerName"
      />
    </div>

    <template #footer>
      Exactly equivalent to consecutive <code>castRunes</code> calls on one reader, which is why the
      byte receipt is simply the sum of the sets.
    </template>
  </DemoSection>
</template>
