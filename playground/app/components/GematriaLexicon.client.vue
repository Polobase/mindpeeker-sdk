<script setup lang="ts">
/**
 * Matching against the bundled lexicon, in both directions: word → peers
 * (`matches`) and number → words (`lookup`, gematrix.org's ?word=<number>).
 * Every answer carries the honest denominator.
 */
import type { CipherId, MatchResult } from '@mindpeeker/gematria'
import { expectedMatches, getCipher, lookup, matches, value } from '@mindpeeker/gematria'
import { cipherSelectItems, SCRIPT_LABELS } from '~/lib/gematria/ciphers'
import { glossOf, SEPHER_SEPHIROTH, wordsFor } from '~/lib/gematria/lexicon'
import { fmtNum } from '~/lib/format'

const cipherItems = cipherSelectItems({ scripts: ['hebrew', 'greek', 'latin'] })

const cipher = ref<CipherId>('he-hechrachi')
const colel = ref(false)
const tolerance = ref(0)
const target = ref(156)
const text = ref('אמת')

const QUICK_NUMBERS = [13, 26, 31, 93, 156, 358, 418, 666]
const QUICK_WORDS: Record<string, string[]> = {
  hebrew: ['אמת', 'משיח', 'אחד', 'אהבה', 'שדי'],
  greek: ['αγαπη', 'θελημα', 'ιησους'],
  latin: ['Thelema', 'Babalon'],
}

const script = computed(() => getCipher(cipher.value).script)
const quickWords = computed(() => QUICK_WORDS[script.value] ?? [])

/** `tolerance` wins over `colel` when both are given — the documented order. */
const options = computed(() =>
  tolerance.value > 0 ? { tolerance: tolerance.value } : colel.value ? { colel: true } : {},
)

const admissible = computed(() => wordsFor(cipher.value))

const byNumber = computed<{ result?: MatchResult; error?: unknown }>(() => {
  try {
    return { result: lookup(Math.max(0, Math.trunc(target.value || 0)), cipher.value, options.value) }
  } catch (error) {
    return { error }
  }
})

const byWord = computed<{ result?: MatchResult; error?: unknown }>(() => {
  try {
    return { result: matches(text.value, cipher.value, options.value) }
  } catch (error) {
    return { error }
  }
})

const baseline = computed(() => {
  try {
    return expectedMatches(SEPHER_SEPHIROTH, cipher.value, options.value)
  } catch {
    return undefined
  }
})

function decorate(words: readonly string[], exact: readonly string[]) {
  const exactSet = new Set(exact)
  return words.map((word) => ({
    word,
    gloss: glossOf(word),
    exact: exactSet.has(word),
    value: safeValue(word),
  }))
}

function safeValue(word: string): number {
  try {
    return value(word, cipher.value)
  } catch {
    return 0
  }
}

const numberRows = computed(() =>
  byNumber.value.result ? decorate(byNumber.value.result.matches, byNumber.value.result.exact) : [],
)
const wordRows = computed(() =>
  byWord.value.result ? decorate(byWord.value.result.matches, byWord.value.result.exact) : [],
)

const remarkable = computed(() => {
  const found = byWord.value.result?.matches.length
  const expected = baseline.value
  if (found === undefined || expected === undefined) return undefined
  return { found, expected, remarkable: found > expected + 1 }
})

const code = computed(() => {
  const opts =
    tolerance.value > 0
      ? `, { tolerance: ${tolerance.value} }`
      : colel.value
        ? ', { colel: true }'
        : ''
  return `import { lookup, matches, expectedMatches } from '@mindpeeker/gematria'
import { defaultLexicon, SEPHER_SEPHIROTH } from '@mindpeeker/gematria/lexicon'

defaultLexicon() // registers the 191-entry corpus as the default lexicon

lookup(${Math.trunc(target.value || 0)}, '${cipher.value}'${opts})
// { matches: [${(byNumber.value.result?.matches ?? []).slice(0, 3).map((w) => `'${w}'`).join(', ')}], exact, tolerance, commonness: ${fmtNum(byNumber.value.result?.commonness ?? 0, { digits: 4 })}, lexiconSize: ${byNumber.value.result?.lexiconSize ?? '—'} }

matches(${JSON.stringify(text.value)}, '${cipher.value}'${opts}).value // ${byWord.value.result?.value ?? '—'}
expectedMatches(SEPHER_SEPHIROTH, '${cipher.value}'${opts}) // ${fmtNum(baseline.value ?? 0, { digits: 4 })} — the unremarkable baseline`
})
</script>

<template>
  <DemoSection
    id="lexicon"
    title="Lookup and matching"
    :api="['matches', 'lookup', 'expectedMatches', 'admissibleWords', 'defaultLexicon']"
    description="matches() goes word → peers, lookup() goes number → words. Only admissible entries count — written in the cipher's script, with at least one letter the cipher scores — and that count is the denominator of every commonness on this page."
  >
    <template #controls>
      <UFormField label="Cipher" size="sm" class="w-full sm:w-72">
        <USelect v-model="cipher" :items="cipherItems" class="w-full" />
      </UFormField>
      <UFormField label="Colel (±1)" size="sm">
        <USwitch v-model="colel" :disabled="tolerance > 0" :label="colel ? 'on' : 'off'" />
      </UFormField>
      <UFormField label="Explicit tolerance ±" size="sm" class="w-full sm:w-40">
        <UInputNumber v-model="tolerance" :min="0" :max="50" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Admissible words"
          :value="admissible.length"
          :digits="0"
          tone="primary"
          :note="`${SCRIPT_LABELS[script]} entries of the 191`"
        />
        <StatTile
          label="Window applied"
          :value="byNumber.result ? `± ${byNumber.result.tolerance}` : '—'"
          :mono="false"
          note="tolerance overrides colel"
        />
        <StatTile
          label="expectedMatches"
          :value="baseline ?? null"
          :digits="3"
          note="matches a random lexicon word gets"
        />
        <StatTile
          label="Your word's matches"
          :value="remarkable?.found ?? null"
          :digits="0"
          :tone="remarkable?.remarkable ? 'warning' : 'neutral'"
          :note="remarkable?.remarkable ? 'above the baseline — still a coincidence' : 'at or below the baseline'"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-3">
          <h4 class="text-xs uppercase tracking-wide text-muted">Number → words (lookup)</h4>
          <div class="flex flex-wrap items-end gap-2">
            <UFormField label="Value" size="sm" class="w-32">
              <UInputNumber v-model="target" :min="0" class="w-full" />
            </UFormField>
            <div class="flex flex-wrap gap-1">
              <UButton
                v-for="q in QUICK_NUMBERS"
                :key="q"
                size="xs"
                variant="soft"
                color="neutral"
                @click="target = q"
              >
                {{ q }}
              </UButton>
            </div>
          </div>
          <ErrorAlert :err="byNumber.error" :dismissible="false" />
          <ul v-if="numberRows.length" class="flex flex-col gap-1">
            <li v-for="row in numberRows" :key="row.word" class="flex flex-wrap items-baseline gap-2 text-sm">
              <span class="text-base" dir="auto">{{ row.word }}</span>
              <span class="font-mono text-xs text-muted">{{ fmtNum(row.value, { digits: 0 }) }}</span>
              <UBadge v-if="!row.exact" color="neutral" variant="outline" size="sm">within tolerance</UBadge>
              <span v-if="row.gloss" class="text-muted">— {{ row.gloss }}</span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted">
            No admissible word has that value under {{ cipher }}. A value with no words is the
            ordinary case: the corpus holds {{ admissible.length }} words, not a language.
          </p>
          <p v-if="byNumber.result" class="text-xs text-muted">
            commonness {{ fmtNum(byNumber.result.commonness * 100, { digits: 2 }) }}% of
            {{ byNumber.result.lexiconSize }} admissible words ·
            {{ byNumber.result.exact.length }} exact,
            {{ byNumber.result.matches.length - byNumber.result.exact.length }} within tolerance.
          </p>
        </div>

        <div class="rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-3">
          <h4 class="text-xs uppercase tracking-wide text-muted">Word → peers (matches)</h4>
          <div class="flex flex-wrap items-end gap-2">
            <UFormField label="Word" size="sm" class="w-40">
              <UInput v-model="text" class="w-full" dir="auto" spellcheck="false" />
            </UFormField>
            <div class="flex flex-wrap gap-1">
              <UButton
                v-for="w in quickWords"
                :key="w"
                size="xs"
                variant="soft"
                color="neutral"
                @click="text = w"
              >
                {{ w }}
              </UButton>
            </div>
          </div>
          <ErrorAlert :err="byWord.error" :dismissible="false" />
          <p v-if="byWord.result" class="text-sm">
            <span dir="auto">{{ text }}</span> =
            <span class="font-mono text-highlighted">{{ fmtNum(byWord.result.value, { digits: 0 }) }}</span>
            under {{ cipher }}
          </p>
          <ul v-if="wordRows.length" class="flex flex-col gap-1">
            <li v-for="row in wordRows" :key="row.word" class="flex flex-wrap items-baseline gap-2 text-sm">
              <span class="text-base" dir="auto">{{ row.word }}</span>
              <span class="font-mono text-xs text-muted">{{ fmtNum(row.value, { digits: 0 }) }}</span>
              <UBadge v-if="!row.exact" color="neutral" variant="outline" size="sm">within tolerance</UBadge>
              <span v-if="row.gloss" class="text-muted">— {{ row.gloss }}</span>
            </li>
          </ul>
          <p v-else-if="byWord.result" class="text-sm text-muted">
            No lexicon word shares that value. Absence of a match is as cheap as a match.
          </p>
          <p v-if="byWord.result" class="text-xs text-muted">
            commonness {{ fmtNum(byWord.result.commonness * 100, { digits: 2 }) }}% ·
            the word itself counts when it is in the corpus.
          </p>
        </div>
      </div>

      <CodeSnippet :code="code" title="what these two panels ran" />

      <HonestNote variant="caveat" title="Read commonness before reading the match">
        An equal value is statistically cheap: in this corpus a random Hebrew entry already shares
        its value with {{ fmtNum(baseline ?? 0, { digits: 2 }) }} entries on average. A “match” at
        commonness 0.02 is what chance looks like, not a discovery — and the price is set by the
        corpus you searched, which is a curated reference dictionary, not a random sample of the
        language.
      </HonestNote>
    </div>

    <template #footer>
      Script-awareness is 0.2.0 behaviour: a Greek or English entry can no longer be a zero-valued
      “match” under a Hebrew cipher, and it is not in the denominator either.
      <code class="font-mono">admissibleWords(lexicon, cipher)</code> lists exactly what counts.
    </template>
  </DemoSection>
</template>
