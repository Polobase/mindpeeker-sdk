<script setup lang="ts">
/**
 * The whole registry: 43 ciphers across ten scripts, filterable, each with the
 * value it gives a probe word of its own script.
 */
import type { CipherAlias, Script } from '@mindpeeker/gematria'
import { ALIASES, CIPHERS, getCipher, resolveCipherId, value } from '@mindpeeker/gematria'
import { FRONTEND_PARITY, SCRIPT_LABELS, SCRIPT_ORDER, scriptCounts } from '~/lib/gematria/ciphers'
import { fmtNum } from '~/lib/format'

/** One probe word per script, so every row shows a real number. */
const PROBES: Readonly<Record<Script, string>> = {
  hebrew: 'אמת',
  greek: 'αγαπη',
  arabic: 'موسى',
  latin: 'gematria',
  cyrillic: 'ѰЗ',
  armenian: 'ՌՋՀԵ',
  georgian: 'ჩყმვ',
  coptic: 'ⲁⲅⲁⲡⲏ',
  syriac: 'ܡܫܝܚܐ',
  gothic: '𐌹𐌱',
}

const query = ref('')
const script = ref<'all' | Script>('all')
const showModern = ref(true)
const showExtended = ref(true)

const SCRIPT_ITEMS = [
  { label: 'every script', value: 'all' },
  ...SCRIPT_ORDER.map((s) => ({ label: SCRIPT_LABELS[s], value: s })),
]

const rows = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return CIPHERS.filter(
    (c) =>
      (script.value === 'all' || c.script === script.value) &&
      (showModern.value || !c.modern) &&
      (showExtended.value || !c.extended) &&
      (!needle ||
        c.id.includes(needle) ||
        c.label.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle)),
  ).map((c) => ({
    id: c.id,
    label: c.label,
    script: c.script,
    modern: c.modern,
    extended: c.extended,
    parity: FRONTEND_PARITY.has(c.id),
    letters: c.alphabet.length,
    description: c.description,
    probe: PROBES[c.script],
    probeValue: value(PROBES[c.script], c.id),
  }))
})

/** The friendly names online calculators use, resolved through the registry. */
const aliases = (Object.keys(ALIASES) as CipherAlias[]).map((alias) => ({
  alias,
  id: resolveCipherId(alias),
  label: getCipher(alias).label,
}))

const totals = computed(() => ({
  all: CIPHERS.length,
  modern: CIPHERS.filter((c) => c.modern).length,
  extended: CIPHERS.filter((c) => c.extended).length,
  scripts: scriptCounts(),
}))
</script>

<template>
  <DemoSection
    id="catalogue"
    title="The registry"
    :api="['CIPHERS', 'CIPHERS_BY_SCRIPT', 'ALIASES', 'resolveCipherId']"
    description="Forty-three ciphers in canonical order — Hebrew first, then Greek, Arabic, Latin and the six further numeral scripts. Ids are stable; friendly aliases (jewish, hebrew, latin, english, simple, ordinal, sumerian, isopsephy) resolve to them."
  >
    <template #controls>
      <UFormField label="Search" size="sm" class="w-full sm:w-64">
        <UInput v-model="query" placeholder="id, label or rule" icon="i-lucide-search" class="w-full" />
      </UFormField>
      <UFormField label="Script" size="sm" class="w-full sm:w-56">
        <USelect v-model="script" :items="SCRIPT_ITEMS" class="w-full" />
      </UFormField>
      <UCheckbox v-model="showModern" label="modern calculator ciphers" />
      <UCheckbox v-model="showExtended" label="extended methods" />
    </template>

    <div class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Ciphers shown" :value="rows.length" :digits="0" tone="primary" :note="`of ${totals.all}`" />
        <StatTile label="Scripts" :value="totals.scripts.length" :digits="0" note="each with its own normalization" />
        <StatTile label="Modern" :value="totals.modern" :digits="0" note="no historical pedigree" />
        <StatTile label="Extended" :value="totals.extended" :digits="0" note="outside the default profile()" />
      </div>

      <ul class="flex flex-wrap gap-1.5">
        <li v-for="entry in totals.scripts" :key="entry.script">
          <UButton
            size="xs"
            variant="soft"
            :color="script === entry.script ? 'primary' : 'neutral'"
            :aria-pressed="script === entry.script"
            @click="script = script === entry.script ? 'all' : entry.script"
          >
            {{ entry.label }} · {{ entry.count }}
          </UButton>
        </li>
      </ul>

      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-160">
          <caption class="sr-only">Every cipher in the registry</caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th scope="col" class="text-left py-1.5 pr-3 font-medium">Cipher</th>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">Id</th>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">Script</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Letters</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Probe</th>
              <th scope="col" class="text-left py-1.5 pl-3 font-medium">Rule</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" class="border-t border-default align-top">
              <td class="py-1.5 pr-3 whitespace-nowrap">
                {{ row.label }}
                <UBadge v-if="row.parity" color="neutral" variant="outline" size="sm" class="ml-1">parity</UBadge>
                <UBadge v-if="row.modern" color="warning" variant="subtle" size="sm" class="ml-1">modern</UBadge>
                <UBadge v-if="row.extended" color="info" variant="subtle" size="sm" class="ml-1">ext</UBadge>
              </td>
              <td class="py-1.5 px-3 font-mono text-xs text-primary whitespace-nowrap">{{ row.id }}</td>
              <td class="py-1.5 px-3 text-muted whitespace-nowrap">{{ SCRIPT_LABELS[row.script] }}</td>
              <td class="py-1.5 px-3 text-right font-mono">{{ row.letters }}</td>
              <td class="py-1.5 px-3 text-right whitespace-nowrap">
                <span class="text-muted">{{ row.probe }}</span>
                <span class="ml-1.5 font-mono text-highlighted">{{ fmtNum(row.probeValue, { digits: 0 }) }}</span>
              </td>
              <td class="py-1.5 pl-3 text-muted">{{ row.description }}</td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="6" class="py-3 text-sm text-muted">No cipher matches those filters.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="rounded-md border border-default bg-elevated/30 p-3">
        <h4 class="text-xs uppercase tracking-wide text-muted">
          Friendly aliases — <code class="font-mono normal-case">resolveCipherId(ref)</code>
        </h4>
        <ul class="mt-2 flex flex-wrap gap-1.5">
          <li
            v-for="row in aliases"
            :key="row.alias"
            class="rounded bg-elevated px-2 py-1 font-mono text-xs"
            :title="row.label"
          >
            '{{ row.alias }}' → {{ row.id }}
          </li>
        </ul>
        <p class="mt-2 text-xs text-muted">
          Accepted anywhere a cipher is chosen. A canonical id passes through unchanged, and an
          unresolved name reaches <code class="font-mono">getCipher</code>, which throws
          <code class="font-mono">unknown_cipher</code>.
        </p>
      </div>

      <HonestNote variant="caveat" title="“Parity” means one thing only">
        The nine ids marked <em>parity</em> reproduce the mindpeeker frontend engine row-for-row —
        identical ids, labels and values. That is a compatibility guarantee about numbers, not an
        endorsement of any reading of them.
      </HonestNote>
    </div>

    <template #footer>
      Probe words are fixed per script so the last column is comparable down a script's rows:
      אמת, αγαπη, موسى, gematria, ѰЗ, ՌՋՀԵ, ჩყმვ, ⲁⲅⲁⲡⲏ, ܡܫܝܚܐ, 𐌹𐌱.
    </template>
  </DemoSection>
</template>
