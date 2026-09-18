<script setup lang="ts">
/**
 * Aiq Beker — the Qabalah of the Nine Chambers: the 22 letters and the 5
 * finals sorted into (units, tens, hundreds) triads, the exchanges they
 * license, and the theosophical reduction that sends a whole chamber to one
 * digit.
 */
import type { ChamberFinals } from '@mindpeeker/gematria'
import {
  aiqBeker,
  aiqBekerEquivalent,
  aiqBekerSubstitute,
  chamberMates,
  chamberReduce,
  NINE_CHAMBERS,
  value,
} from '@mindpeeker/gematria'
import { hebrew } from '~/lib/gematria/state'
import { fmtNum } from '~/lib/format'

const finals = ref<ChamberFinals>('distinct')
const letter = ref('ד')
const position = ref<1 | 2 | 3>(1)
const reduceInput = ref(666)

const FINALS_ITEMS = [
  { label: 'distinct — finals are the hundreds 500…900', value: 'distinct' },
  { label: 'fold — a final counts as its base letter', value: 'fold' },
]
const POSITION_ITEMS = [
  { label: '1 — units', value: 1 },
  { label: '2 — tens', value: 2 },
  { label: '3 — hundreds / finals', value: 3 },
]

const chambers = computed(() =>
  NINE_CHAMBERS.map((row, i) => ({
    chamber: i + 1,
    letters: row.map((char) => ({ char, value: value(char, 'he-gadol') })),
  })),
)

const cell = computed<{ chamber: number; position: number } | undefined>(() => {
  try {
    return aiqBeker(letter.value)
  } catch {
    return undefined
  }
})

const mates = computed<{ list?: readonly string[]; error?: unknown }>(() => {
  if (!letter.value.trim()) return {}
  try {
    return { list: chamberMates(letter.value, { finals: finals.value }) }
  } catch (error) {
    return { error }
  }
})

const substitution = computed<{ out?: string; error?: unknown }>(() => {
  try {
    return { out: aiqBekerSubstitute(hebrew.text, position.value, { finals: finals.value }) }
  } catch (error) {
    return { error }
  }
})

const substitutedValue = computed(() => {
  const out = substitution.value.out
  if (!out) return null
  try {
    return value(out, 'he-hechrachi')
  } catch {
    return null
  }
})

const equivalence = computed(() => {
  try {
    return {
      equal: aiqBekerEquivalent(hebrew.text, hebrew.other, { finals: finals.value }),
      left: value(hebrew.text, 'he-hechrachi'),
      right: value(hebrew.other, 'he-hechrachi'),
    }
  } catch {
    return undefined
  }
})

const reduced = computed(() => {
  try {
    return chamberReduce(Math.max(0, Math.trunc(reduceInput.value || 0)))
  } catch {
    return null
  }
})

const code = computed(
  () => `import { aiqBeker, aiqBekerEquivalent, aiqBekerSubstitute, chamberMates, chamberReduce } from '@mindpeeker/gematria'

aiqBeker('${letter.value}')                       // { chamber: ${cell.value?.chamber ?? '—'}, position: ${cell.value?.position ?? '—'} }
chamberMates('${letter.value}', { finals: '${finals.value}' })  // [${(mates.value.list ?? []).map((m) => `'${m}'`).join(', ')}]
aiqBekerSubstitute(${JSON.stringify(hebrew.text)}, ${position.value}, { finals: '${finals.value}' }) // '${substitution.value.out ?? '—'}'
aiqBekerEquivalent('אדם', 'אמת', { finals: 'fold' }) // true — 45 ↔ 441
chamberReduce(${reduceInput.value})                   // ${reduced.value ?? '—'}`,
)
</script>

<template>
  <DemoSection
    id="chambers"
    title="Aiq Beker — the nine chambers"
    :api="['NINE_CHAMBERS', 'aiqBeker', 'chamberMates', 'aiqBekerSubstitute', 'aiqBekerEquivalent', 'chamberReduce']"
    description="Each chamber holds the units, tens and hundreds letter of one digit, the hundreds running past ת into the five finals ך…ץ = 500…900. Qabalists exchange any letter for another of its chamber, and trace names as sigils on the planetary kameas."
  >
    <template #controls>
      <UFormField label="Finals" size="sm" class="w-full sm:w-80">
        <USelect v-model="finals" :items="FINALS_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Letter" size="sm" class="w-full sm:w-24">
        <UInput v-model="letter" dir="rtl" class="w-full" spellcheck="false" />
      </UFormField>
      <UFormField label="Substitute to position" size="sm" class="w-full sm:w-56">
        <USelect v-model="position" :items="POSITION_ITEMS" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-3 gap-2">
        <div
          v-for="row in chambers"
          :key="row.chamber"
          class="rounded-md border p-2 text-center"
          :class="cell?.chamber === row.chamber ? 'border-primary bg-primary/10' : 'border-default bg-elevated/30'"
        >
          <p class="text-[10px] uppercase tracking-wide text-muted">
            chamber {{ row.chamber }} · reduces to {{ row.chamber }}
          </p>
          <p class="mt-1 flex justify-center gap-2" dir="rtl">
            <span
              v-for="item in row.letters"
              :key="item.char"
              class="flex flex-col items-center"
              :title="`${item.char} = ${item.value}`"
            >
              <span class="text-xl leading-tight">{{ item.char }}</span>
              <span class="font-mono text-[10px] text-dimmed">{{ item.value }}</span>
            </span>
          </p>
        </div>
      </div>

      <ErrorAlert :err="mates.error" title="That is not a Hebrew letter" :dismissible="false" />

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Chamber of the letter"
          :value="cell ? `${cell.chamber} · position ${cell.position}` : '—'"
          :mono="false"
          note="1 units, 2 tens, 3 hundreds"
        />
        <StatTile
          label="Chamber mates"
          :value="(mates.list ?? []).join(' ') || '—'"
          :mono="false"
          :note="`finals: ${finals}`"
        />
        <StatTile
          label="chamberReduce"
          :value="reduced"
          :digits="0"
          note="the digital root — every chamber member shares it"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-2">
          <h4 class="text-xs uppercase tracking-wide text-muted">Substitute a word</h4>
          <ErrorAlert :err="substitution.error" :dismissible="false" />
          <p class="text-sm">
            <span dir="rtl" class="text-lg">{{ hebrew.text || '∅' }}</span>
            <UIcon name="i-lucide-arrow-right" class="mx-2 size-4 align-middle text-dimmed" />
            <span dir="rtl" class="text-lg text-highlighted">{{ substitution.out || '∅' }}</span>
            <span v-if="substitutedValue !== null" class="ml-2 font-mono text-muted">
              = {{ fmtNum(substitutedValue, { digits: 0 }) }}
            </span>
          </p>
          <p class="text-xs text-muted">
            Every letter moves to the member of its own chamber at position {{ position }}, so the
            per-letter digital roots — and the chamber reduction — are unchanged.
          </p>
        </div>

        <div class="rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-2">
          <h4 class="text-xs uppercase tracking-wide text-muted">Are two words chamber exchanges?</h4>
          <div class="flex flex-wrap gap-2">
            <UFormField label="Word A" size="sm" class="w-32">
              <UInput v-model="hebrew.text" dir="rtl" class="w-full" spellcheck="false" />
            </UFormField>
            <UFormField label="Word B" size="sm" class="w-32">
              <UInput v-model="hebrew.other" dir="rtl" class="w-full" spellcheck="false" />
            </UFormField>
          </div>
          <p v-if="equivalence" class="text-sm">
            <UBadge :color="equivalence.equal ? 'success' : 'neutral'" variant="subtle">
              {{ equivalence.equal ? 'chamber-equivalent' : 'not equivalent' }}
            </UBadge>
            <span class="ml-2 text-muted font-mono">
              {{ fmtNum(equivalence.left, { digits: 0 }) }} ↔ {{ fmtNum(equivalence.right, { digits: 0 }) }}
            </span>
          </p>
          <p class="text-xs text-muted">
            <em>Sepher Sephiroth</em> reads אמת (441) as the “Temurah of ADM [אדם, 45], by Aiq
            Bekar” — true with <code class="font-mono">finals: 'fold'</code>, false with the default
            distinct finals. The switch above is exactly that editorial choice.
          </p>
        </div>
      </div>

      <UFormField label="Reduce a number" size="sm" class="w-full sm:w-52">
        <UInputNumber v-model="reduceInput" :min="0" :step="1" class="w-full" />
      </UFormField>

      <CodeSnippet :code="code" title="what this section ran" />

      <HonestNote variant="exact">
        The grid, the exchanges and the reduction are exact combinatorics on a fixed table: a letter
        is in exactly one chamber, the substitution is a function, and
        <code class="font-mono">chamberReduce</code> is the digital root. Nothing here says that two
        chamber-equivalent words are <em>about</em> each other.
      </HonestNote>
    </div>

    <template #footer>
      Sources: Mathers, <em>The Kabbalah Unveiled</em> (1887, the chamber table with the finals as
      hundreds); DuQuette, <em>Llewellyn's Complete Book of Ceremonial Magick</em>; Regardie and the
      Ciceros; Crowley, <em>Sepher Sephiroth</em> (1912).
    </template>
  </DemoSection>
</template>
