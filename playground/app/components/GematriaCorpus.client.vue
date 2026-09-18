<script setup lang="ts">
/**
 * The bundled lexicon itself — 191 public-domain entries, each with the value
 * the package recomputes for it in the test suite, its gloss and its source.
 */
import type { Script } from '@mindpeeker/gematria'
import { value } from '@mindpeeker/gematria'
import type { LexiconEntry } from '~/lib/gematria/lexicon'
import { LEXICON_SCRIPTS, SCRIPT_CIPHER, SEPHER_SEPHIROTH } from '~/lib/gematria/lexicon'
import { fmtNum } from '~/lib/format'

const SOURCE_LABELS: Record<string, string> = {
  'sepher-sephiroth': 'Crowley & Bennett, Sepher Sephiroth (Equinox I.8, 1912)',
  mathers: 'Mathers, The Kabbalah Unveiled (1887)',
  stirling: 'Stirling, The Canon (1897)',
  agrippa: 'Agrippa, De Occulta Philosophia II.xxii',
  curated: 'curated — a widely cited value kept from the 0.1 corpus',
}

const query = ref('')
const script = ref<'all' | Script>('all')
const source = ref<'all' | string>('all')
const limit = ref(40)

const SCRIPT_ITEMS = [
  { label: 'every script', value: 'all' },
  ...LEXICON_SCRIPTS.map((s) => ({
    label: `${s.label} — ${SEPHER_SEPHIROTH.filter((e) => e.script === s.script).length}`,
    value: s.script,
  })),
]

const sources = computed(() => [...new Set(SEPHER_SEPHIROTH.map((e) => e.source))])
const SOURCE_ITEMS = computed(() => [
  { label: 'every source', value: 'all' },
  ...sources.value.map((s) => ({
    label: `${s} — ${SEPHER_SEPHIROTH.filter((e) => e.source === s).length}`,
    value: s as string,
  })),
])

const filtered = computed<readonly LexiconEntry[]>(() => {
  const needle = query.value.trim().toLowerCase()
  return SEPHER_SEPHIROTH.filter(
    (entry) =>
      (script.value === 'all' || entry.script === script.value) &&
      (source.value === 'all' || entry.source === source.value) &&
      (!needle ||
        entry.word.toLowerCase().includes(needle) ||
        entry.gloss.toLowerCase().includes(needle) ||
        String(entry.value) === needle),
  )
})

const shown = computed(() => filtered.value.slice(0, limit.value))

/** Every stored value is recomputed here, exactly as the test suite does. */
const recomputed = computed(() =>
  SEPHER_SEPHIROTH.every((entry) => value(entry.word, SCRIPT_CIPHER[entry.script]) === entry.value),
)
</script>

<template>
  <DemoSection
    id="corpus"
    title="The bundled corpus"
    :api="['SEPHER_SEPHIROTH', 'LexiconEntry', 'SCRIPT_CIPHER', 'defaultLexicon']"
    description="A curated, value-indexed reference dictionary shipped so lookups work out of the box: 160 Hebrew, 28 Greek and 3 English entries, deeply frozen, each naming the edition it came from."
  >
    <template #controls>
      <UFormField label="Search" size="sm" class="w-full sm:w-64">
        <UInput v-model="query" placeholder="word, gloss or exact value" icon="i-lucide-search" class="w-full" />
      </UFormField>
      <UFormField label="Script" size="sm" class="w-full sm:w-48">
        <USelect v-model="script" :items="SCRIPT_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Source" size="sm" class="w-full sm:w-64">
        <USelect v-model="source" :items="SOURCE_ITEMS" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Entries" :value="SEPHER_SEPHIROTH.length" :digits="0" tone="primary" note="36 in 0.1, 191 now" />
        <StatTile label="Matching the filters" :value="filtered.length" :digits="0" />
        <StatTile label="Sources" :value="sources.length" :digits="0" note="all public domain" />
        <StatTile
          label="Values recomputed"
          :value="recomputed ? 'all agree' : 'mismatch'"
          :mono="false"
          :tone="recomputed ? 'success' : 'error'"
          note="stored value vs the package's own cipher"
        />
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-120">
          <caption class="sr-only">Lexicon entries</caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th scope="col" class="text-left py-1.5 pr-3 font-medium">Word</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Value</th>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">Gloss</th>
              <th scope="col" class="text-left py-1.5 pl-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in shown" :key="`${entry.script}-${entry.word}-${entry.value}`" class="border-t border-default align-top">
              <td class="py-1 pr-3 text-base whitespace-nowrap" dir="auto">{{ entry.word }}</td>
              <td class="py-1 px-3 text-right font-mono">{{ fmtNum(entry.value, { digits: 0 }) }}</td>
              <td class="py-1 px-3 text-muted">
                {{ entry.gloss }}
                <span v-if="entry.note" class="block text-xs text-dimmed">{{ entry.note }}</span>
              </td>
              <td class="py-1 pl-3">
                <UBadge color="neutral" variant="subtle" size="sm" :title="SOURCE_LABELS[entry.source]">
                  {{ entry.source }}
                </UBadge>
              </td>
            </tr>
            <tr v-if="!shown.length">
              <td colspan="4" class="py-3 text-sm text-muted">Nothing in the corpus matches that.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="filtered.length > shown.length" class="flex items-center gap-3">
        <UButton size="sm" variant="soft" color="neutral" @click="limit += 60">
          Show 60 more
        </UButton>
        <span class="text-sm text-muted">{{ shown.length }} of {{ filtered.length }} shown</span>
      </div>

      <HonestNote variant="caveat" title="A historical reference, not a language sample">
        The corpus is deliberately small and curated: Crowley and Bennett's value-indexed
        dictionary, plus rows from Mathers, Stirling and Agrippa. Coincidence statistics computed
        over it price coincidences <em>in it</em> — not in Hebrew, not in English. Two corrections
        came out of recomputing every value: Crowley's Hebrew Babalon is באבאלען = 156 (the 0.1 entry
        בבלון = 90 is gone), and Stirling's printed ΟΚΤΩ = 1,100 is a misprint for 1190.
      </HonestNote>
    </div>

    <template #footer>
      Everything is public domain — Crowley died in 1947 and the 1912 edition predates 1929, Bennett
      1923, Mathers 1918, Stirling 1900, Agrippa 1535. Modern editorial notes from circulating
      e-texts are excluded; the glosses are short identifications written for the package.
    </template>
  </DemoSection>
</template>
