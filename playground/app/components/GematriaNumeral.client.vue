<script setup lang="ts">
/**
 * Hebrew letter numerals (the inverse of Hechrachi for one number) and
 * Notariqon — the acronym half of the literal Kabbalah.
 */
import { acronym, MAX_HEBREW_NUMERAL, notariqon, toHebrewNumeral, value } from '@mindpeeker/gematria'
import { hebrew } from '~/lib/gematria/state'
import { fmtNum } from '~/lib/format'

const finals = ref(false)
const punctuation = ref(true)
const mode = ref<'first' | 'last'>('first')
const from = ref<'first' | 'last' | 'medial'>('first')

const MODE_ITEMS = [
  { label: 'first — roshei teivot', value: 'first' },
  { label: 'last — sofei teivot', value: 'last' },
]
const FROM_ITEMS = [
  { label: 'first', value: 'first' },
  { label: 'last', value: 'last' },
  { label: 'medial — emtsaei teivot', value: 'medial' },
]

const EXAMPLES = [15, 16, 26, 500, 900, 5784, 999_999]

const numeral = computed<{ text?: string; error?: unknown }>(() => {
  try {
    return {
      text: toHebrewNumeral(Math.trunc(hebrew.numeral || 0), {
        finals: finals.value,
        punctuation: punctuation.value,
      }),
    }
  } catch (error) {
    return { error }
  }
})

/** Geresh and gershayim are not letters, so the numeral scores its own number. */
const roundTrip = computed(() => {
  const text = numeral.value.text
  if (!text) return undefined
  const cipher = finals.value ? 'he-gadol' : 'he-hechrachi'
  const back = value(text, cipher)
  const n = Math.trunc(hebrew.numeral || 0)
  return { cipher, back, exact: back === n, thousands: n > 999 }
})

const examples = computed(() =>
  EXAMPLES.map((n) => ({
    n,
    plain: toHebrewNumeral(n),
    withFinals: n >= 500 && n <= 999 ? toHebrewNumeral(n, { finals: true }) : undefined,
  })),
)

const contracted = computed<{ first?: string; chosen?: string; error?: unknown }>(() => {
  try {
    return {
      first: notariqon(hebrew.phrase, { mode: mode.value }),
      chosen: acronym(hebrew.phrase, { from: from.value }),
    }
  } catch (error) {
    return { error }
  }
})

const contractedValue = computed(() => {
  const text = contracted.value.first
  if (!text) return null
  try {
    return value(text, 'he-hechrachi')
  } catch {
    return null
  }
})

const code = computed(
  () => `import { acronym, notariqon, toHebrewNumeral, value } from '@mindpeeker/gematria'

toHebrewNumeral(15)                     // 'ט״ו' — not יה, which spells a divine name
toHebrewNumeral(5784)                   // 'ה׳תשפ״ד' — thousands marked with a geresh
toHebrewNumeral(${Math.trunc(hebrew.numeral || 0)}${finals.value || !punctuation.value ? `, { finals: ${finals.value}, punctuation: ${punctuation.value} }` : ''}) // '${numeral.value.text ?? '—'}'
value(toHebrewNumeral(n), '${roundTrip.value?.cipher ?? 'he-hechrachi'}') === n   // for n ≤ 999

notariqon(${JSON.stringify(hebrew.phrase)}, { mode: '${mode.value}' }) // '${contracted.value.first ?? '—'}'
acronym('Atah, Gibor', { from: 'last' })  // 'hr' — letters only, never a vowel point`,
)
</script>

<template>
  <DemoSection
    id="numerals"
    title="Hebrew numerals and Notariqon"
    :api="['toHebrewNumeral', 'MAX_HEBREW_NUMERAL', 'notariqon', 'acronym']"
    description="Writing a number with letters is Hechrachi run backwards: hundreds, tens, units, with 15 as טו and 16 as טז so no numeral spells a divine name. Notariqon takes one letter per word — the third division of the literal Kabbalah beside gematria and temurah."
  >
    <template #controls>
      <UFormField label="Number" size="sm" class="w-full sm:w-44">
        <UInputNumber v-model="hebrew.numeral" :min="1" :max="MAX_HEBREW_NUMERAL" class="w-full" />
      </UFormField>
      <UFormField label="Hundreds 500–900" size="sm">
        <USwitch v-model="finals" :label="finals ? 'final forms ך…ץ' : 'ת-compounds'" />
      </UFormField>
      <UFormField label="Punctuation" size="sm">
        <USwitch v-model="punctuation" :label="punctuation ? 'geresh / gershayim' : 'bare letters'" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="numeral.error" title="toHebrewNumeral rejected that number" :dismissible="false" />

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Numeral"
          :value="numeral.text ?? '—'"
          :mono="false"
          size="md"
          :note="`${fmtNum(hebrew.numeral, { digits: 0 })} in Hebrew letters`"
        />
        <StatTile
          label="Read back"
          :value="roundTrip?.back ?? null"
          :digits="0"
          :tone="roundTrip?.exact ? 'success' : 'neutral'"
          :note="`value(numeral, '${roundTrip?.cipher ?? 'he-hechrachi'}')`"
        />
        <StatTile
          label="Largest supported"
          :value="MAX_HEBREW_NUMERAL"
          :digits="0"
          note="MAX_HEBREW_NUMERAL"
        />
      </div>

      <p v-if="roundTrip && !roundTrip.exact && roundTrip.thousands" class="text-sm text-muted">
        Above 999 the thousands are written as a marked count, so reading the numeral back as a plain
        letter sum gives {{ fmtNum(roundTrip.back, { digits: 0 }) }} rather than
        {{ fmtNum(hebrew.numeral, { digits: 0 }) }} — the identity
        <code class="font-mono">value(toHebrewNumeral(n)) === n</code> is stated for n ≤ 999 only.
      </p>

      <div>
        <h4 class="text-xs uppercase tracking-wide text-muted mb-2">Reference numerals</h4>
        <ul class="flex flex-wrap gap-1.5">
          <li v-for="row in examples" :key="row.n">
            <UButton size="xs" variant="soft" color="neutral" @click="hebrew.numeral = row.n">
              <span class="font-mono">{{ fmtNum(row.n, { digits: 0 }) }}</span>
              <span class="mx-1 text-dimmed">=</span>
              <span dir="rtl">{{ row.plain }}</span>
              <span v-if="row.withFinals" class="ml-1 text-dimmed" dir="rtl">/ {{ row.withFinals }}</span>
            </UButton>
          </li>
        </ul>
      </div>

      <div class="rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-3">
        <h4 class="text-xs uppercase tracking-wide text-muted">Notariqon — one letter per word</h4>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Phrase" size="sm" class="w-full sm:w-80">
            <UInput v-model="hebrew.phrase" dir="auto" class="w-full" spellcheck="false" />
          </UFormField>
          <UFormField label="notariqon mode" size="sm" class="w-full sm:w-52">
            <USelect v-model="mode" :items="MODE_ITEMS" class="w-full" />
          </UFormField>
          <UFormField label="acronym from" size="sm" class="w-full sm:w-52">
            <USelect v-model="from" :items="FROM_ITEMS" class="w-full" />
          </UFormField>
        </div>
        <ErrorAlert :err="contracted.error" :dismissible="false" />
        <div class="grid gap-3 sm:grid-cols-3">
          <StatTile label="notariqon" :value="contracted.first ?? '—'" :mono="false" :note="`mode: ${mode}`" />
          <StatTile label="acronym" :value="contracted.chosen ?? '—'" :mono="false" :note="`from: ${from}`" />
          <StatTile
            label="Its Hechrachi value"
            :value="contractedValue"
            :digits="0"
            note="the contraction is a word like any other"
          />
        </div>
        <p class="text-xs text-muted">
          Only letters count: vowel points, cantillation, accents, digits and punctuation are never
          picked, so <span dir="rtl" class="font-mono">לְךָ</span> with
          <code class="font-mono">mode: 'last'</code> gives
          <span dir="rtl" class="font-mono">{{ notariqon('לְךָ', { mode: 'last' }) }}</span>, not the
          qamats. Try “אתה גבור לעולם אדני” → אגלא, or an English phrase.
        </p>
      </div>

      <CodeSnippet :code="code" title="what this section ran" />

      <HonestNote variant="exact">
        Both directions are exact string operations on a fixed table. A numeral is a spelling of a
        number, and a notariqon is a selection of letters — neither operation licenses a claim that
        the contraction <em>means</em> the phrase.
      </HonestNote>
    </div>

    <template #footer>
      Agrippa II.xix states the fifteen-as-nine-and-six rule and the ת-compounds for 500–900;
      thousands are his “letters marked with a great Character”. Other avoidances some writers apply
      (ער for 270) are deliberately not applied.
    </template>
  </DemoSection>
</template>
