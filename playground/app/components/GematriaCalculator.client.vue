<script setup lang="ts">
/**
 * The calculator: one word, one cipher, the exact integer and its per-letter
 * breakdown. Everything here is pure arithmetic — no entropy is consumed and
 * the same word always returns the same number.
 */
import type { GematriaResult, Script } from '@mindpeeker/gematria'
import { analyze, detectScript, getCipher, normalizeFor } from '@mindpeeker/gematria'
import {
  cipherSelectItems,
  LINEAGE,
  SAMPLES,
  SCRIPT_DEFAULT_CIPHER,
  SCRIPT_LABELS,
  supportsKeepTen,
  supportsNamesVariant,
} from '~/lib/gematria/ciphers'
import { calc, inspectNumber } from '~/lib/gematria/state'
import { fmtNum } from '~/lib/format'

const NAME_ITEMS = [
  { label: 'standard — gimel גמל 73, pe פא 81', value: 'standard' },
  { label: 'plene — gimel גימל 83, pe פה 85', value: 'plene' },
]

const detected = computed(() => {
  try {
    return detectScript(calc.text)
  } catch {
    return 'latin' as const
  }
})
/** The script in force: detected from the text unless the profile forced one. */
const activeScript = computed<Script>(() =>
  calc.forcedScript === 'auto' ? detected.value : (calc.forcedScript as Script),
)
const cipher = computed(() => getCipher(calc.cipher))
const cipherItems = computed(() => cipherSelectItems({ scripts: [activeScript.value] }))

// Keep the focus cipher on the active script: typing Hebrew switches to
// Hechrachi rather than silently scoring 0 under a Latin table.
watchEffect(() => {
  if (cipher.value.script !== activeScript.value) {
    calc.cipher = SCRIPT_DEFAULT_CIPHER[activeScript.value]
  }
})

const options = computed(() => ({
  reverse: calc.reverse,
  ...(supportsKeepTen(calc.cipher) && calc.keepTen ? { keepTen: true } : {}),
  ...(supportsNamesVariant(calc.cipher) ? { namesVariant: calc.namesVariant } : {}),
}))

const outcome = computed<{ result?: GematriaResult; error?: unknown }>(() => {
  try {
    return { result: analyze(calc.text, calc.cipher, { ...options.value, numberProperties: true }) }
  } catch (error) {
    return { error }
  }
})
const result = computed(() => outcome.value.result)

const normalized = computed(() => {
  try {
    return normalizeFor(calc.text, cipher.value.script)
  } catch {
    return ''
  }
})

const letterSum = computed(() =>
  (result.value?.byLetter ?? []).reduce((sum, letter) => sum + letter.value, 0),
)
/** `he-katan-mispari` reduces the whole word after summing — say so. */
const postSummed = computed(() => !!result.value && letterSum.value !== result.value.value)

const running = computed(() => {
  let total = 0
  return (result.value?.byLetter ?? []).map((letter) => {
    total += letter.value
    return { ...letter, total }
  })
})

const chartLetters = computed(() => running.value.slice(0, 48))
const showChart = computed(() => chartLetters.value.length > 1)

const code = computed(() => {
  const opts: string[] = []
  if (calc.reverse) opts.push('reverse: true')
  if (supportsKeepTen(calc.cipher) && calc.keepTen) opts.push('keepTen: true')
  if (supportsNamesVariant(calc.cipher) && calc.namesVariant === 'plene')
    opts.push("namesVariant: 'plene'")
  const bag = opts.length ? `, { ${opts.join(', ')} }` : ''
  return `import { analyze, detectScript, value } from '@mindpeeker/gematria'

detectScript(${JSON.stringify(calc.text)}) // '${detected.value}'
value(${JSON.stringify(calc.text)}, '${calc.cipher}'${bag}) // ${result.value ? result.value.value : '—'}

const r = analyze(${JSON.stringify(calc.text)}, '${calc.cipher}'${
    opts.length ? `, { ${opts.join(', ')}, numberProperties: true }` : ', { numberProperties: true }'
  })
r.reduced      // ${result.value?.reduced ?? '—'} — digital root
r.byLetter     // per-letter contributions
r.numbers      // the number-lore portrait of the total`
})
</script>

<template>
  <DemoSection
    id="calculator"
    title="Calculator"
    :api="['analyze', 'detectScript', 'normalizeFor', 'getCipher']"
    description="A word's value is the sum of its letters under one cipher, after normalizing for that cipher's script. Exact integer arithmetic: deterministic, zero entropy, no rounding anywhere."
  >
    <template #controls>
      <UFormField label="Word or phrase" size="sm" class="w-full sm:w-80">
        <UInput
          v-model="calc.text"
          placeholder="try אהבה, θελημα, موسى or gematria"
          size="lg"
          class="w-full"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
        />
      </UFormField>
      <UFormField
        label="Cipher"
        size="sm"
        class="w-full sm:w-72"
        :hint="`${SCRIPT_LABELS[activeScript]} ciphers`"
      >
        <USelect v-model="calc.cipher" :items="cipherItems" class="w-full" />
      </UFormField>
      <UFormField label="Mirror" size="sm">
        <USwitch v-model="calc.reverse" :label="calc.reverse ? 'reverse' : 'forward'" />
      </UFormField>
      <UFormField v-if="supportsKeepTen(calc.cipher)" label="Hubbard rule" size="sm">
        <USwitch v-model="calc.keepTen" :label="calc.reverse ? 'H counts 10' : 'S counts 10'" />
      </UFormField>
      <UFormField v-if="supportsNamesVariant(calc.cipher)" label="Letter names" size="sm" class="w-full sm:w-64">
        <USelect v-model="calc.namesVariant" :items="NAME_ITEMS" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs uppercase tracking-wide text-muted mr-1">Samples</span>
        <UButton
          v-for="sample in SAMPLES"
          :key="sample.text"
          size="xs"
          variant="soft"
          color="neutral"
          :title="`${SCRIPT_LABELS[sample.script]} — ${sample.gloss}`"
          @click="calc.text = sample.text"
        >
          {{ sample.text }}
        </UButton>
      </div>

      <ErrorAlert :err="outcome.error" title="That combination is rejected" :dismissible="false" />

      <div v-if="result" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Value"
          :value="result.value"
          :digits="0"
          tone="primary"
          :note="`${cipher.label}${calc.reverse ? ' · reverse' : ''}`"
        />
        <StatTile
          label="Reduced"
          :value="result.reduced"
          :digits="0"
          note="digital root — repeated digit sum"
        />
        <StatTile
          label="Letters scored"
          :value="result.byLetter.length"
          :digits="0"
          :note="`of ${[...normalized].length} normalized characters`"
        />
        <StatTile
          label="Script"
          :value="SCRIPT_LABELS[result.script]"
          :mono="false"
          :note="calc.forcedScript === 'auto' ? 'detected from the text' : 'forced in the profile'"
        />
      </div>

      <div v-if="result" class="rounded-md border border-default bg-elevated/40 p-3 flex flex-col gap-2">
        <p class="text-xs uppercase tracking-wide text-muted">{{ cipher.id }}</p>
        <p class="text-sm text-muted">{{ cipher.description }}</p>
        <p v-if="LINEAGE[cipher.id]" class="text-sm text-dimmed">{{ LINEAGE[cipher.id] }}</p>
        <div class="flex flex-wrap gap-1.5">
          <UBadge color="neutral" variant="subtle" size="sm">{{ cipher.alphabet.length }}-letter alphabet</UBadge>
          <UBadge color="neutral" variant="subtle" size="sm">{{ cipher.table.length }} scoring glyphs</UBadge>
          <UBadge v-if="cipher.modern" color="warning" variant="subtle" size="sm">modern invention</UBadge>
          <UBadge v-if="cipher.extended" color="info" variant="subtle" size="sm">extended</UBadge>
        </div>
      </div>

      <div v-if="result" class="overflow-x-auto">
        <table class="w-full text-sm min-w-80">
          <caption class="sr-only">Per-letter breakdown under {{ cipher.label }}</caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th scope="col" class="text-left py-1.5 pr-3 font-medium">#</th>
              <th scope="col" class="text-left py-1.5 px-3 font-medium">Letter</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Value</th>
              <th scope="col" class="text-right py-1.5 pl-3 font-medium">Running total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(letter, i) in running" :key="i" class="border-t border-default">
              <td class="py-1.5 pr-3 text-dimmed tabular-nums">{{ i + 1 }}</td>
              <td class="py-1.5 px-3 text-lg">{{ letter.char }}</td>
              <td class="py-1.5 px-3 text-right font-mono">{{ fmtNum(letter.value, { digits: 0 }) }}</td>
              <td class="py-1.5 pl-3 text-right font-mono text-muted">{{ fmtNum(letter.total, { digits: 0 }) }}</td>
            </tr>
            <tr v-if="!running.length">
              <td colspan="4" class="py-3 text-sm text-muted">
                No letter of the {{ SCRIPT_LABELS[cipher.script] }} script scores here — every
                character outside a cipher's alphabet contributes 0.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="postSummed" class="text-sm text-muted">
        The letters sum to <span class="font-mono">{{ fmtNum(letterSum, { digits: 0 }) }}</span>;
        this cipher applies a word-level transform afterwards, giving
        <span class="font-mono text-highlighted">{{ fmtNum(result?.value ?? 0, { digits: 0 }) }}</span>.
      </p>

      <BarChart
        v-if="showChart"
        :categories="chartLetters.map((l) => l.char)"
        :values="chartLetters.map((l) => l.value)"
        y-label="letter value"
        x-label="letters in reading order"
        :height="200"
        :aria-label="`Per-letter values of ${calc.text} under ${cipher.label}`"
        :format="(v) => fmtNum(v, { digits: 0 })"
      />

      <div v-if="result?.numbers" class="flex flex-wrap items-center gap-2 text-sm">
        <span class="text-muted">The total is</span>
        <UBadge v-if="result.numbers.isPrime" color="success" variant="subtle">prime</UBadge>
        <UBadge v-if="result.numbers.isTriangular" color="info" variant="subtle">
          triangular T({{ result.numbers.triangularIndex }})
        </UBadge>
        <UBadge v-if="result.numbers.isSquare" color="info" variant="subtle">a perfect square</UBadge>
        <UBadge v-if="result.numbers.isPerfect" color="warning" variant="subtle">a perfect number</UBadge>
        <span class="text-muted">
          digit sum {{ result.numbers.digitSum }}, digital root {{ result.numbers.digitalRoot }}.
        </span>
        <UButton size="xs" variant="link" icon="i-lucide-sigma" @click="inspectNumber(result.value)">
          Portrait it in Numbers
        </UButton>
      </div>

      <CodeSnippet :code="code" title="what this panel computed" />

      <HonestNote variant="exact">
        The sum is a fixed function of the letters: identical input always gives an identical
        integer, and nothing here draws a byte of entropy. Normalization is part of that function —
        <span class="font-mono">{{ calc.text || '∅' }}</span> becomes
        <span class="font-mono">{{ normalized || '∅' }}</span> before summing, so accents,
        cantillation, invisible format controls and presentation forms cannot change a value.
      </HonestNote>
    </div>

    <template #footer>
      Reverse is a parameter, not a separate cipher: a letter at index <em>i</em> of the canonical
      alphabet takes the forward value of the letter at <em>n − 1 − i</em>, so reversing twice
      returns the forward cipher and glyph variants always share a mirrored value.
    </template>
  </DemoSection>
</template>
