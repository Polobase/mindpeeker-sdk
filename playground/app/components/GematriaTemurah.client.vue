<script setup lang="ts">
/**
 * Temurah — the substitution ciphers that turn a Hebrew word into another
 * Hebrew word, and the two ciphers that score the substituted word.
 */
import {
  achbi,
  aibat,
  albam,
  atbash,
  avgad,
  temurahShift,
  value,
} from '@mindpeeker/gematria'
import { hebrew } from '~/lib/gematria/state'
import { fmtNum } from '~/lib/format'

const shift = ref(1)

const SAMPLES = ['אמת', 'יהוה', 'תורה', 'רוח', 'אבגד', 'שלום']

interface Row {
  key: string
  name: string
  rule: string
  out: string
  involution: boolean
}

const outcome = computed<{ rows?: Row[]; error?: unknown }>(() => {
  const text = hebrew.text
  try {
    const rows: Row[] = [
      {
        key: 'atbash',
        name: 'Atbash',
        rule: 'i ↦ 21 − i (א↔ת, ב↔ש, …)',
        out: atbash(text),
        involution: true,
      },
      {
        key: 'albam',
        name: 'Albam',
        rule: 'i ↦ (i + 11) mod 22',
        out: albam(text),
        involution: true,
      },
      {
        key: 'avgad',
        name: 'Avgad',
        rule: 'i ↦ i + 1 — the mezuzah cipher (יהוה → כוזו)',
        out: avgad(text),
        involution: false,
      },
      {
        key: 'achbi',
        name: 'Achbi',
        rule: 'each half of eleven reversed onto itself; ו and פ fixed',
        out: achbi(text),
        involution: true,
      },
      {
        key: 'aibat',
        name: 'Aibat',
        rule: 'Ginsburg no. 10: א↔י, ב↔ט; כ and ת fixed',
        out: aibat(text),
        involution: true,
      },
      {
        key: 'shift',
        name: `temurahShift(${shift.value})`,
        rule: 'the generic cyclic shift — 1 is Avgad, 11 is Albam',
        out: temurahShift(text, shift.value),
        involution: shift.value % 22 === 11 || shift.value % 22 === 0,
      },
    ]
    return { rows }
  } catch (error) {
    return { error }
  }
})

const rows = computed(() =>
  (outcome.value.rows ?? []).map((row) => ({
    ...row,
    value: safeValue(row.out),
    roundTrip: row.key === 'shift' ? temurahShift(row.out, -shift.value) : undefined,
  })),
)

function safeValue(text: string): number {
  try {
    return value(text, 'he-hechrachi')
  } catch {
    return 0
  }
}

/** The identity the two temurah ciphers encode. */
const identity = computed(() => {
  try {
    return {
      substituted: value(atbash(hebrew.text), 'he-hechrachi'),
      cipher: value(hebrew.text, 'he-atbash'),
      mirrored: value(hebrew.text, 'he-hechrachi', true),
      albamSubstituted: value(albam(hebrew.text), 'he-hechrachi'),
      albamCipher: value(hebrew.text, 'he-albam'),
    }
  } catch {
    return undefined
  }
})

const code = computed(
  () => `import { achbi, aibat, albam, atbash, avgad, temurahShift, value } from '@mindpeeker/gematria'

atbash(${JSON.stringify(hebrew.text)})            // '${safeSub(atbash)}'
avgad('יהוה')             // 'כוזו' — the name on mezuzot
temurahShift(${JSON.stringify(hebrew.text)}, ${shift.value})        // '${safeSub((t) => temurahShift(t, shift.value))}'
temurahShift(temurahShift(x, n), -n) === x  // undo any shift

// The he-atbash cipher scores the substituted word:
value(atbash(x), 'he-hechrachi') === value(x, 'he-atbash') // ${identity.value ? identity.value.substituted === identity.value.cipher : '—'}`,
)

function safeSub(fn: (text: string) => string): string {
  try {
    return fn(hebrew.text)
  } catch {
    return '—'
  }
}
</script>

<template>
  <DemoSection
    id="temurah"
    title="Temurah — letter exchange"
    :api="['atbash', 'albam', 'avgad', 'achbi', 'aibat', 'temurahShift']"
    description="One of the three divisions of the literal Kabbalah (Scholem): gematria gives a word a number, notariqon contracts it, temurah exchanges its letters for other letters. Finals fold to their base before substitution; non-Hebrew characters pass through untouched."
  >
    <template #controls>
      <UFormField label="Hebrew word" size="sm" class="w-full sm:w-64">
        <UInput v-model="hebrew.text" dir="rtl" class="w-full" spellcheck="false" />
      </UFormField>
      <UFormField label="temurahShift by" size="sm" class="w-full sm:w-52">
        <UInputNumber v-model="shift" :min="-21" :max="21" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs uppercase tracking-wide text-muted mr-1">Try</span>
        <UButton
          v-for="sample in SAMPLES"
          :key="sample"
          size="xs"
          variant="soft"
          color="neutral"
          @click="hebrew.text = sample"
        >
          {{ sample }}
        </UButton>
      </div>

      <ErrorAlert :err="outcome.error" title="Temurah rejected that input" :dismissible="false" />

      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-120">
          <caption class="sr-only">Temurah substitutions of the current word</caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th scope="col" class="text-left py-1.5 pr-3 font-medium">Table</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Result</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Hechrachi</th>
              <th scope="col" class="text-left py-1.5 pl-3 font-medium">Rule</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key" class="border-t border-default align-top">
              <td class="py-1.5 pr-3 whitespace-nowrap">
                {{ row.name }}
                <UBadge v-if="row.involution" color="neutral" variant="outline" size="sm" class="ml-1">
                  involution
                </UBadge>
              </td>
              <td class="py-1.5 px-3 text-right text-lg" dir="rtl">{{ row.out }}</td>
              <td class="py-1.5 px-3 text-right font-mono">{{ fmtNum(row.value, { digits: 0 }) }}</td>
              <td class="py-1.5 pl-3 text-muted">
                {{ row.rule }}
                <template v-if="row.roundTrip">
                  · undone by −{{ shift }}: <span dir="rtl" class="font-mono">{{ row.roundTrip }}</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="identity" class="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="value(atbash(x), Hechrachi)"
          :value="identity.substituted"
          :digits="0"
          note="substitute first, then score"
        />
        <StatTile
          label="value(x, he-atbash)"
          :value="identity.cipher"
          :digits="0"
          :tone="identity.substituted === identity.cipher ? 'success' : 'error'"
          note="the cipher does both"
        />
        <StatTile
          label="value(x, Hechrachi, reverse)"
          :value="identity.mirrored"
          :digits="0"
          :tone="identity.mirrored === identity.cipher ? 'success' : 'warning'"
          note="0.2.0: the mirror is exactly Atbash"
        />
      </div>

      <CodeSnippet :code="code" title="what this table ran" />

      <HonestNote variant="fixed-in-0.2" title="Achbi and Aibat swapped names">
        Every commutation is named after its first two pairs, so Achbi (אכב״י) must be א↔כ, ב↔י —
        each half of eleven reversed onto itself with ו and פ fixed. 0.1.x shipped Ginsburg's table
        no. 10 (א↔י, ב↔ט, with כ and ת fixed) under that name; it now lives at
        <code class="font-mono">aibat</code>. If you stored 0.1 output, the two columns above are
        the check.
      </HonestNote>
    </div>

    <template #footer>
      Sources: Mathers, <em>The Kabbalah Unveiled</em> (1887); Ginsburg, <em>The Kabbalah</em>
      (1865), p. 55; Scholem, <em>Kabbalah</em>; DuQuette on Avgad. A substitution changes the
      letters — whether the new word is <em>about</em> the old one is tradition, not arithmetic.
    </template>
  </DemoSection>
</template>
