<script setup lang="ts">
/**
 * Cipher explorer: the full glyph→value table of any of the 43 ciphers,
 * forward and mirrored, plus the canonical alphabet reverse defines itself
 * over and the variant glyphs that fold onto it.
 */
import type { CipherId } from '@mindpeeker/gematria'
import { getCipher, letterValues } from '@mindpeeker/gematria'
import { cipherSelectItems, LINEAGE, SCRIPT_LABELS } from '~/lib/gematria/ciphers'
import { fmtNum } from '~/lib/format'

const cipherItems = cipherSelectItems()
const id = ref<CipherId>('he-hechrachi')
const reverse = ref(false)

const cipher = computed(() => getCipher(id.value))
const table = computed(() => letterValues(id.value, reverse.value))
const forward = computed(() => letterValues(id.value))

/** The canonical alphabet with the value each letter carries in this direction. */
const alphabetRows = computed(() => {
  const letter = new Map(table.value.map((row) => [row.char, row.value]))
  return cipher.value.alphabet.map((char, i) => ({
    char,
    index: i,
    value: letter.get(char) ?? 0,
  }))
})

/** Glyphs the table scores that are not themselves canonical letters. */
const variantRows = computed(() => {
  const canonical = new Set(cipher.value.alphabet)
  return table.value
    .filter((row) => !canonical.has(row.char))
    .map((row) => ({ char: row.char, value: row.value, folds: cipher.value.fold(row.char) }))
})

/** The first few mirror pairs, i ↔ n − 1 − i over the canonical alphabet. */
const mirrorPairs = computed(() => {
  const { alphabet } = cipher.value
  const n = alphabet.length
  const out: { a: string; b: string; fixed: boolean }[] = []
  for (let i = 0; i < Math.min(6, Math.ceil(n / 2)); i++) {
    const a = alphabet[i] as string
    const b = alphabet[n - 1 - i] as string
    out.push({ a, b, fixed: a === b })
  }
  return out
})

const middleFixed = computed(() =>
  cipher.value.alphabet.length % 2 === 1
    ? (cipher.value.alphabet[(cipher.value.alphabet.length - 1) / 2] as string)
    : undefined,
)

const chartValues = computed(() => alphabetRows.value.map((row) => row.value))
const chartCategories = computed(() => alphabetRows.value.map((row) => row.char))
const maxValue = computed(() => Math.max(...chartValues.value, 0))

const code = computed(
  () => `import { getCipher, letterValues } from '@mindpeeker/gematria'

const c = getCipher('${id.value}')
c.alphabet.length   // ${cipher.value.alphabet.length} canonical letters — the domain of reverse
c.table.length      // ${cipher.value.table.length} scoring glyphs (variants included)
c.fold('${variantRows.value[0]?.char ?? (cipher.value.alphabet[0] as string)}')        // '${cipher.value.fold(variantRows.value[0]?.char ?? (cipher.value.alphabet[0] as string))}'

letterValues('${id.value}'${reverse.value ? ', true' : ''}) // [{ char, value }, …]`,
)
</script>

<template>
  <DemoSection
    id="cipher-explorer"
    title="Cipher explorer"
    :api="['getCipher', 'letterValues', 'Cipher.alphabet', 'Cipher.fold', 'Cipher.table']"
    description="Every cipher separates its canonical alphabet — one glyph per letter, in traditional order — from the glyphs it accepts. Reverse is defined over that alphabet, which is why final forms, sigma variants and case variants always share a mirrored value."
  >
    <template #controls>
      <UFormField label="Cipher" size="sm" class="w-full sm:w-80">
        <USelect v-model="id" :items="cipherItems" class="w-full" />
      </UFormField>
      <UFormField label="Direction" size="sm">
        <USwitch v-model="reverse" :label="reverse ? 'reversed table' : 'forward table'" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="rounded-md border border-default bg-elevated/40 p-3 flex flex-col gap-2">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 class="font-semibold text-highlighted">{{ cipher.label }}</h3>
          <code class="font-mono text-xs text-primary">{{ cipher.id }}</code>
          <UBadge color="neutral" variant="outline" size="sm">{{ SCRIPT_LABELS[cipher.script] }}</UBadge>
          <UBadge v-if="cipher.modern" color="warning" variant="subtle" size="sm">modern</UBadge>
          <UBadge v-if="cipher.extended" color="info" variant="subtle" size="sm">extended</UBadge>
        </div>
        <p class="text-sm text-muted">{{ cipher.description }}</p>
        <p v-if="LINEAGE[cipher.id]" class="text-sm text-dimmed">{{ LINEAGE[cipher.id] }}</p>
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Canonical letters" :value="cipher.alphabet.length" :digits="0" />
        <StatTile label="Scoring glyphs" :value="cipher.table.length" :digits="0" note="variants included" />
        <StatTile label="Largest value" :value="maxValue" :digits="0" :note="reverse ? 'mirrored table' : 'forward table'" />
        <StatTile
          label="Word-level transform"
          :value="cipher.postSum ? 'yes' : 'none'"
          :mono="false"
          note="applied after the letters are summed"
        />
      </div>

      <div>
        <h4 class="text-xs uppercase tracking-wide text-muted mb-2">
          {{ reverse ? 'Mirrored' : 'Forward' }} values over the canonical alphabet
        </h4>
        <ul class="flex flex-wrap gap-1.5">
          <li
            v-for="row in alphabetRows"
            :key="row.index"
            class="rounded border border-default bg-default px-2 py-1 text-center min-w-14"
            :title="`position ${row.index + 1} of ${cipher.alphabet.length}`"
          >
            <span class="block text-lg leading-tight">{{ row.char }}</span>
            <span class="block font-mono text-xs text-muted">{{ fmtNum(row.value, { digits: 0 }) }}</span>
          </li>
        </ul>
      </div>

      <BarChart
        :categories="chartCategories"
        :values="chartValues"
        y-label="value"
        x-label="canonical alphabet, traditional order"
        :height="220"
        :aria-label="`${cipher.label} letter values in ${reverse ? 'mirrored' : 'forward'} direction`"
        :format="(v) => fmtNum(v, { digits: 0 })"
      />

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-default bg-elevated/30 p-3">
          <h4 class="text-xs uppercase tracking-wide text-muted">Mirror pairs</h4>
          <p class="mt-1 text-sm text-muted">
            Position <em>i</em> pairs with <em>n − 1 − i</em>, so reversing twice is the forward
            cipher.
          </p>
          <ul class="mt-2 flex flex-wrap gap-1.5">
            <li
              v-for="(pair, i) in mirrorPairs"
              :key="i"
              class="rounded bg-elevated px-2 py-1 font-mono text-sm"
            >
              {{ pair.a }} ↔ {{ pair.b }}
            </li>
            <li v-if="middleFixed" class="rounded bg-elevated px-2 py-1 font-mono text-sm text-muted">
              {{ middleFixed }} fixed (odd alphabet)
            </li>
          </ul>
        </div>

        <div class="rounded-md border border-default bg-elevated/30 p-3">
          <h4 class="text-xs uppercase tracking-wide text-muted">
            Variant glyphs that fold onto a letter
          </h4>
          <p v-if="!variantRows.length" class="mt-1 text-sm text-muted">
            This cipher's table is exactly its alphabet — no final forms, numeral variants or case
            variants to fold.
          </p>
          <ul v-else class="mt-2 flex flex-wrap gap-1.5">
            <li
              v-for="row in variantRows"
              :key="row.char"
              class="rounded bg-elevated px-2 py-1 font-mono text-sm"
              :title="`scores ${row.value}`"
            >
              {{ row.char }} → {{ row.folds }}
              <span class="text-dimmed">{{ fmtNum(row.value, { digits: 0 }) }}</span>
            </li>
          </ul>
        </div>
      </div>

      <CodeSnippet :code="code" title="what this section read" />

      <HonestNote v-if="cipher.modern" variant="caveat" title="A modern invention">
        This cipher is flagged <code class="font-mono">modern: true</code>: a 20th–21st-century
        calculator or wordplay table with no historical pedigree. It computes an exact number; that
        number carries no more history than the table does.
      </HonestNote>
      <HonestNote v-else-if="reverse" variant="fixed-in-0.2">
        Reverse now mirrors over the canonical alphabet. Hebrew finals no longer score 0
        (<code class="font-mono">value('שלום', 'he-hechrachi', true)</code> is 112 — exactly Atbash —
        where 0.1 gave 102), <code class="font-mono">he-gadol</code> mirrors aleph↔tav, and the Greek
        27 numeral letters mirror α↔ϡ so σ/ς, ϝ/ϛ and ϙ/ϟ share a reversed value.
      </HonestNote>
    </div>

    <template #footer>
      The tables are frozen data from the package registry, not recomputed here:
      <code class="font-mono">letterValues(cipher)</code> returns the cipher's own
      <code class="font-mono">table</code> unchanged in the forward direction, and a mirrored copy
      when reverse or another option is set.
    </template>
  </DemoSection>
</template>
