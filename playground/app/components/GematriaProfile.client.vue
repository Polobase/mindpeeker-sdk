<script setup lang="ts">
/**
 * `profile(text)` — every cipher of the detected script in one table, with the
 * mirrored value beside the forward one and the two switches that decide which
 * rows exist (modern calculator ciphers, SDK-extended methods).
 */
import type { CipherId, GematriaProfile, Script } from '@mindpeeker/gematria'
import { getCipher, profile, value } from '@mindpeeker/gematria'
import { FRONTEND_PARITY, SCRIPT_LABELS, SCRIPT_ORDER } from '~/lib/gematria/ciphers'
import { calc } from '~/lib/gematria/state'
import { fmtNum } from '~/lib/format'

const SCRIPT_ITEMS = [
  { label: 'auto — detect from the text', value: 'auto' },
  ...SCRIPT_ORDER.map((script) => ({ label: SCRIPT_LABELS[script], value: script })),
]

const outcome = computed<{ prof?: GematriaProfile; error?: unknown }>(() => {
  try {
    return {
      prof: profile(calc.text, {
        ...(calc.forcedScript === 'auto' ? {} : { script: calc.forcedScript as Script }),
        includeModern: calc.includeModern,
        includeExtended: calc.includeExtended,
      }),
    }
  } catch (error) {
    return { error }
  }
})

const rows = computed(() =>
  (outcome.value.prof?.values ?? []).map((row) => {
    const cipher = getCipher(row.cipher)
    return {
      ...row,
      reversed: value(calc.text, row.cipher, true),
      modern: cipher.modern,
      extended: cipher.extended,
      parity: FRONTEND_PARITY.has(row.cipher),
      description: cipher.description,
    }
  }),
)

/** How many rows each switch adds or removes, computed on the same text. */
const counts = computed(() => {
  const text = calc.text
  const script = calc.forcedScript === 'auto' ? undefined : (calc.forcedScript as Script)
  const count = (includeModern: boolean, includeExtended: boolean): number => {
    try {
      return profile(text, { ...(script ? { script } : {}), includeModern, includeExtended }).values
        .length
    } catch {
      return 0
    }
  }
  return {
    frontendDefault: count(true, false),
    all: count(true, true),
    historicalOnly: count(false, true),
  }
})

function focus(id: CipherId): void {
  calc.cipher = id
}

const code = computed(
  () => `import { profile } from '@mindpeeker/gematria'

const p = profile(${JSON.stringify(calc.text)}, {
  includeModern: ${calc.includeModern},   // the 20th–21st-century calculator ciphers
  includeExtended: ${calc.includeExtended},  // the SDK-added deeper methods
})
p.script          // '${outcome.value.prof?.script ?? '—'}'
p.values.length   // ${rows.value.length}
p.values[0]       // { cipher, label, value, reduced }
p.byLetter        // each letter's value under every row`,
)
</script>

<template>
  <DemoSection
    id="profile"
    title="Every cipher at once"
    :api="['profile', 'value', 'getCipher']"
    description="profile() runs every cipher applicable to the text's script. The default set is a row-for-row drop-in for the mindpeeker frontend engine; the two switches add the modern calculator ciphers and the SDK-added extended methods."
  >
    <template #controls>
      <UFormField label="Script" size="sm" class="w-full sm:w-64">
        <USelect v-model="calc.forcedScript" :items="SCRIPT_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Modern calculator ciphers" size="sm">
        <USwitch v-model="calc.includeModern" :label="calc.includeModern ? 'included' : 'dropped'" />
      </UFormField>
      <UFormField label="Extended methods" size="sm">
        <USwitch v-model="calc.includeExtended" :label="calc.includeExtended ? 'included' : 'dropped'" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="profile() rejected that script" :dismissible="false" />

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Rows shown"
          :value="rows.length"
          :digits="0"
          tone="primary"
          :note="`for “${calc.text || '∅'}”`"
        />
        <StatTile
          label="Frontend-parity default"
          :value="counts.frontendDefault"
          :digits="0"
          note="profile() with no options"
        />
        <StatTile
          label="Non-modern only"
          :value="counts.historicalOnly"
          :digits="0"
          note="includeModern: false, extended kept"
        />
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-120">
          <caption class="sr-only">Every applicable cipher for the current text</caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th scope="col" class="text-left py-1.5 pr-3 font-medium">Cipher</th>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">Id</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Value</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Reversed</th>
              <th scope="col" class="text-right py-1.5 pl-3 font-medium">Reduced</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.cipher"
              class="border-t border-default"
              :class="row.cipher === calc.cipher ? 'bg-elevated/60' : ''"
            >
              <td class="py-1.5 pr-3">
                <button
                  type="button"
                  class="text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-primary rounded"
                  :title="row.description"
                  @click="focus(row.cipher)"
                >
                  {{ row.label }}
                </button>
                <span v-if="row.parity" class="ml-1.5 text-[10px] uppercase tracking-wide text-dimmed">parity</span>
                <UBadge v-if="row.modern" color="warning" variant="subtle" size="sm" class="ml-1.5">modern</UBadge>
                <UBadge v-if="row.extended" color="info" variant="subtle" size="sm" class="ml-1.5">extended</UBadge>
              </td>
              <td class="py-1.5 px-3 font-mono text-xs text-dimmed">{{ row.cipher }}</td>
              <td class="py-1.5 px-3 text-right font-mono text-highlighted">{{ fmtNum(row.value, { digits: 0 }) }}</td>
              <td class="py-1.5 px-3 text-right font-mono text-muted">{{ fmtNum(row.reversed, { digits: 0 }) }}</td>
              <td class="py-1.5 pl-3 text-right font-mono">{{ row.reduced }}</td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="5" class="py-3 text-sm text-muted">
                No rows — every applicable cipher was filtered out by the switches above.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <CodeSnippet :code="code" title="what this table ran" />

      <HonestNote variant="caveat" title="Latin rows are a modern convention">
        Hebrew, Greek, Arabic, Cyrillic, Armenian, Georgian, Coptic, Syriac and Gothic letters
        <em>were</em> their scripts' numerals. Latin never had native alphabetic numerals of this
        kind, so every English row here — Ordinal and Reduction included, which stay
        <code class="font-mono">modern: false</code> only for frontend parity — is a 19th–21st-century
        convention. The ×6 “English”/“Sumerian” pair is one table under two names, and “Sumerian”
        has nothing to do with Sumerian numerals.
      </HonestNote>
    </div>

    <template #footer>
      Clicking a cipher name makes it the focus cipher of the calculator above. The reversed column
      is <code class="font-mono">value(text, id, true)</code> — the same cipher mirrored over its
      canonical alphabet, never a separate registry entry.
    </template>
  </DemoSection>
</template>
