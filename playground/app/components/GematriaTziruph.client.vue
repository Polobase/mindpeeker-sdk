<script setup lang="ts">
/**
 * The twenty-two Tziruph commutation tables: their closed form, the two
 * conventions for the self-mirrored letters of an even table, and Mathers'
 * Right and Averse squares.
 */
import type { TziruphSelfPairs, TziruphSquareKind } from '@mindpeeker/gematria'
import { ALBATH, HE_BASE, TZIRUPH_TABLES, tziruph, tziruphSquare, value } from '@mindpeeker/gematria'
import { hebrew } from '~/lib/gematria/state'
import { fmtNum } from '~/lib/format'

const k = ref<number>(ALBATH) // Mathers' worked example: RVCh → DTzO
const selfPairs = ref<TziruphSelfPairs>('swap')
const square = ref<'none' | TziruphSquareKind>('none')

const TABLE_ITEMS = TZIRUPH_TABLES.map((t) => ({
  label: `${t.k}. ${t.name} (${t.abbreviation}) — Ginsburg ${t.ginsburg}`,
  value: t.k,
}))

const SELF_ITEMS = [
  { label: 'swap — Mathers’ printed Albath pairs them (א over ל)', value: 'swap' },
  { label: 'fixed — the folded-halves reading leaves them alone', value: 'fixed' },
]

const SQUARE_ITEMS = [
  { label: 'hidden', value: 'none' },
  { label: 'Right table — row r is temurahShift by r', value: 'right' },
  { label: 'Averse table — the alphabet backwards from ת', value: 'averse' },
]

const table = computed(() => TZIRUPH_TABLES.find((t) => t.k === k.value))

/** The eleven pairs of the selected table, read off the substitution itself. */
const pairs = computed(() => {
  const opts = { selfPairs: selfPairs.value }
  const seen = new Set<string>()
  const out: { a: string; b: string; fixed: boolean }[] = []
  for (const letter of HE_BASE) {
    if (seen.has(letter)) continue
    const partner = tziruph(letter, k.value, opts)
    seen.add(letter)
    seen.add(partner)
    out.push({ a: letter, b: partner, fixed: letter === partner })
  }
  return out
})

const outcome = computed<{ out?: string; error?: unknown }>(() => {
  try {
    return { out: tziruph(hebrew.text, k.value, { selfPairs: selfPairs.value }) }
  } catch (error) {
    return { error }
  }
})

const substituted = computed(() => outcome.value.out ?? '')
const substitutedValue = computed(() => {
  try {
    return value(substituted.value, 'he-hechrachi')
  } catch {
    return 0
  }
})
const sourceValue = computed(() => {
  try {
    return value(hebrew.text, 'he-hechrachi')
  } catch {
    return 0
  }
})

/** Involution check: applying the same table twice returns the folded word. */
const involution = computed(() => {
  try {
    return tziruph(substituted.value, k.value, { selfPairs: selfPairs.value })
  } catch {
    return ''
  }
})

const squareRows = computed(() =>
  square.value === 'none' ? [] : tziruphSquare(square.value as TziruphSquareKind),
)

const albathExample = computed(() => tziruph('רוח', ALBATH))

const code = computed(
  () => `import { tziruph, tziruphSquare, TZIRUPH_TABLES, ALBATH } from '@mindpeeker/gematria'

// Letters numbered 1…22: table k pairs i with j ≡ k − i (mod 22).
tziruph('רוח', ALBATH)                       // '${albathExample.value}' — Mathers' RVCh → DTzO
tziruph(${JSON.stringify(hebrew.text)}, ${k.value}, { selfPairs: '${selfPairs.value}' }) // '${substituted.value}'
TZIRUPH_TABLES[${k.value - 1}]                        // { k: ${k.value}, name: '${table.value?.name}', abbreviation: '${table.value?.abbreviation}', ginsburg: ${table.value?.ginsburg} }
tziruphSquare('right')[0].join('')           // the alphabet from א — 484 cells in all`,
)
</script>

<template>
  <DemoSection
    id="tziruph"
    title="Tziruph — the twenty-two commutations"
    :api="['tziruph', 'tziruphSquare', 'TZIRUPH_TABLES', 'ATHBASH … ASHBAR']"
    description="Mathers: “the alphabet is bent exactly in half … twenty-two commutations are produced.” With the letters numbered 1…22, table k pairs i with j ≡ k − i (mod 22) — a reflection of the letter circle, so every table is its own inverse."
  >
    <template #controls>
      <UFormField label="Table" size="sm" class="w-full sm:w-96">
        <USelect v-model="k" :items="TABLE_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Self-mirrored letters (even k)" size="sm" class="w-full sm:w-80">
        <USelect v-model="selfPairs" :items="SELF_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Hebrew word" size="sm" class="w-full sm:w-48">
        <UInput v-model="hebrew.text" dir="rtl" class="w-full" spellcheck="false" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="tziruph rejected that input" :dismissible="false" />

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Table k" :value="k" :digits="0" :note="table?.name" />
        <StatTile label="Ginsburg no." :value="table?.ginsburg ?? null" :digits="0" note="his 1865 numbering" />
        <StatTile
          label="Word value"
          :value="sourceValue"
          :digits="0"
          note="Hechrachi, before substitution"
        />
        <StatTile
          label="Substituted value"
          :value="substitutedValue"
          :digits="0"
          tone="primary"
          note="Hechrachi of the new letters"
        />
      </div>

      <div class="rounded-md border border-default bg-elevated/40 p-3 flex flex-col gap-2">
        <p class="text-sm">
          <span class="text-muted">{{ hebrew.text || '∅' }}</span>
          <UIcon name="i-lucide-arrow-right" class="mx-2 size-4 align-middle text-dimmed" />
          <span class="text-lg text-highlighted" dir="rtl">{{ substituted || '∅' }}</span>
        </p>
        <p class="text-xs text-muted">
          Applying table {{ k }} again returns
          <span class="font-mono" dir="rtl">{{ involution || '∅' }}</span> — every table is an
          involution, so a second pass undoes the first.
        </p>
      </div>

      <div>
        <h4 class="text-xs uppercase tracking-wide text-muted mb-2">
          The pairs of table {{ k }} ({{ table?.name }}), selfPairs: {{ selfPairs }}
        </h4>
        <ul class="flex flex-wrap gap-1.5">
          <li
            v-for="(pair, i) in pairs"
            :key="i"
            class="rounded border border-default bg-default px-2 py-1 font-mono text-sm"
            :class="pair.fixed ? 'text-muted' : ''"
          >
            {{ pair.a }} {{ pair.fixed ? '·' : '↔' }} {{ pair.b }}
          </li>
        </ul>
      </div>

      <div class="flex flex-col gap-2">
        <UFormField label="Mathers’ Tables of the Commutations" size="sm" class="w-full sm:w-96">
          <USelect v-model="square" :items="SQUARE_ITEMS" class="w-full" />
        </UFormField>
        <div v-if="squareRows.length" class="overflow-x-auto">
          <table class="text-xs font-mono">
            <caption class="sr-only">Mathers' {{ square }} table of the commutations, 22 × 22</caption>
            <tbody>
              <tr v-for="(row, r) in squareRows" :key="r">
                <th scope="row" class="pr-2 text-dimmed font-normal">{{ r + 1 }}</th>
                <td v-for="(cell, c) in row" :key="c" class="px-1 py-0.5 text-center">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <CodeSnippet :code="code" title="what this section ran" />

      <HonestNote variant="caveat" title="Two readings, both defensible">
        Mathers prints only Albath in full, and its layout needs the swap (א over ל). But the name
        Agdath (AGDTh — skipping ב, whose mirror under k = 4 is itself) reads naturally with the
        self-mirrored letters left fixed. Under <code class="font-mono">'swap'</code> every name is
        the table's first two pairs except Agdath; under <code class="font-mono">'fixed'</code>
        every name except Albath. The package ships both and asserts neither as <em>the</em>
        tradition.
      </HonestNote>
    </div>

    <template #footer>
      <code class="font-mono">tziruph(x, ATHBASH)</code> is <code class="font-mono">atbash(x)</code>,
      and <code class="font-mono">tziruph(x, ACHBI, { selfPairs: 'fixed' })</code> is
      <code class="font-mono">achbi(x)</code> — the folded-halves functions are two of these
      twenty-two tables. Sources: Mathers (1887) Introduction § 14; Ginsburg (1865) p. 55; Regardie.
    </template>
  </DemoSection>
</template>
