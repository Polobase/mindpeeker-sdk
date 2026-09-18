<script setup lang="ts">
/**
 * The inverse oracle: entropy draws the *number*, and the lexicon answers with
 * whatever happens to share it (`castByValue`), or you name the number and
 * entropy picks among the words that have it (`drawByValue`).
 */
import type { CipherId } from '@mindpeeker/gematria'
import type { DrawByValueResult, ValueCast } from '@mindpeeker/gematria/oracle'
import { castByValue, drawByValue } from '@mindpeeker/gematria/oracle'
import { cipherSelectItems } from '~/lib/gematria/ciphers'
import { glossOf, SEPHER_SEPHIROTH, wordsFor } from '~/lib/gematria/lexicon'
import { restartSource, sourceSummary, withReader } from '~/lib/entropy'
import { fmtNum } from '~/lib/format'

type Kind = 'lexicon' | 'range' | 'target'

const cipherItems = cipherSelectItems({ scripts: ['hebrew', 'greek', 'latin'] })
const KIND_ITEMS = [
  { label: 'castByValue — draw among the values the lexicon realizes', value: 'lexicon' },
  { label: 'castByValue — draw anywhere in a numeric range', value: 'range' },
  { label: 'drawByValue — you name the number, entropy picks the word', value: 'target' },
]

const cipher = ref<CipherId>('he-hechrachi')
const kind = ref<Kind>('lexicon')
const min = ref(1)
const max = ref(500)
const target = ref(358)
const tolerance = ref(0)
const colel = ref(false)

const valueTask = useTask<ValueCast>()
const targetTask = useTask<DrawByValueResult>()
const summary = sourceSummary()

const options = computed(() =>
  tolerance.value > 0 ? { tolerance: tolerance.value } : colel.value ? { colel: true } : {},
)

const pool = computed(() => {
  try {
    return wordsFor(cipher.value)
  } catch {
    return []
  }
})

function go(): void {
  const id = cipher.value
  const extra = options.value
  if (kind.value === 'target') {
    const n = Math.max(0, Math.trunc(target.value || 0))
    void targetTask.run(async (signal) => {
      if (summary.deterministic) restartSource()
      return await withReader(
        (reader) => drawByValue(SEPHER_SEPHIROTH, id, n, reader, { signal, ...extra }),
        { signal },
      )
    })
    return
  }
  const mode: 'lexicon' | 'range' = kind.value === 'range' ? 'range' : 'lexicon'
  const lo = Math.max(0, Math.trunc(min.value || 0))
  const hi = Math.max(lo, Math.trunc(max.value || 0))
  void valueTask.run(async (signal) => {
    if (summary.deterministic) restartSource()
    return await withReader(
      (reader) =>
        castByValue(SEPHER_SEPHIROTH, id, reader, {
          signal,
          mode,
          ...(mode === 'range' ? { min: lo, max: hi } : {}),
          ...extra,
        }),
      { signal },
    )
  })
}

const busy = computed(() => (kind.value === 'target' ? targetTask.busy.value : valueTask.busy.value))
const error = computed(() =>
  kind.value === 'target' ? targetTask.error.value : valueTask.error.value,
)
const cast = computed(() => (kind.value === 'target' ? undefined : valueTask.result.value))
const drawn = computed(() => (kind.value === 'target' ? targetTask.result.value : undefined))

function cancel(): void {
  valueTask.cancel()
  targetTask.cancel()
}
function reset(): void {
  valueTask.reset()
  targetTask.reset()
}

const words = computed(() => {
  const result = cast.value
  if (!result) return []
  const exact = new Set(result.exact)
  return result.words.map((word) => ({ word, gloss: glossOf(word), exact: exact.has(word) }))
})

const factorization = computed(() =>
  (cast.value?.numbers.factorization ?? [])
    .map((f) => (f.exponent === 1 ? `${f.prime}` : `${f.prime}^${f.exponent}`))
    .join(' · '),
)

const code = computed(() => {
  const opts =
    tolerance.value > 0
      ? `, tolerance: ${tolerance.value}`
      : colel.value
        ? ', colel: true'
        : ''
  if (kind.value === 'target') {
    return `import { drawByValue } from '@mindpeeker/gematria/oracle'
import { SEPHER_SEPHIROTH } from '@mindpeeker/gematria/lexicon'

// Rejects with GematriaError('no_match') when no admissible word is in the window.
const drawn = await drawByValue(SEPHER_SEPHIROTH, '${cipher.value}', ${Math.trunc(target.value || 0)}, source${opts ? `, {${opts.slice(1)} }` : ''})
drawn.word    // ${drawn.value ? `'${drawn.value.word}'` : 'one of the words at that value'}
drawn.result  // its full analyze() breakdown`
  }
  return `import { castByValue } from '@mindpeeker/gematria/oracle'
import { SEPHER_SEPHIROTH } from '@mindpeeker/gematria/lexicon'

const cast = await castByValue(SEPHER_SEPHIROTH, '${cipher.value}', source, {
  mode: '${kind.value}',${kind.value === 'range' ? `\n  min: ${Math.trunc(min.value || 0)}, max: ${Math.trunc(max.value || 0)},` : ''}${opts ? `\n ${opts.slice(1)},` : ''}
})
cast.value       // ${cast.value?.value ?? 'the drawn number — entropy, nothing more'}
cast.words       // whichever entries happen to share it${kind.value === 'range' ? ' (possibly none)' : ''}
cast.numbers     // its exact numberProperties portrait
cast.commonness  // ${fmtNum(cast.value?.commonness ?? 0, { digits: 4 })} of ${cast.value?.lexiconSize ?? pool.value}`
})
</script>

<template>
  <DemoSection
    id="value-cast"
    title="Entropy → number → words"
    :api="['castByValue', 'drawByValue', 'ValueCast', 'DrawByValueResult']"
    description="castGematria draws a word and the value follows. This inverts it: the entropy draws the value, and the lexicon answers with whatever shares it — a reflection, not a message. Range mode may land on a number no word has, which is the honest case."
  >
    <template #controls>
      <UFormField label="Draw" size="sm" class="w-full sm:w-96">
        <USelect v-model="kind" :items="KIND_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Cipher" size="sm" class="w-full sm:w-56">
        <USelect v-model="cipher" :items="cipherItems" class="w-full" />
      </UFormField>
      <template v-if="kind === 'range'">
        <UFormField label="min" size="sm" class="w-full sm:w-28">
          <UInputNumber v-model="min" :min="0" class="w-full" />
        </UFormField>
        <UFormField label="max" size="sm" class="w-full sm:w-32">
          <UInputNumber v-model="max" :min="0" class="w-full" />
        </UFormField>
      </template>
      <UFormField v-if="kind === 'target'" label="Target value" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="target" :min="0" class="w-full" />
      </UFormField>
      <UFormField label="Colel (±1)" size="sm">
        <USwitch v-model="colel" :disabled="tolerance > 0" :label="colel ? 'on' : 'off'" />
      </UFormField>
      <UFormField label="Tolerance ±" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="tolerance" :min="0" :max="50" class="w-full" />
      </UFormField>
      <RunControls
        :busy="busy"
        label="Draw"
        busy-label="Drawing…"
        icon="i-lucide-dice-5"
        :hint="`1–4 bytes from ${summary.providerName}`"
        @run="go"
        @cancel="cancel"
      />
    </template>

    <ErrorAlert :err="error" title="The draw failed" @dismiss="reset()" />

    <div class="flex flex-col gap-4">
      <p v-if="!cast && !drawn && !busy" class="text-sm text-muted">
        Nothing drawn yet. In <strong>lexicon</strong> mode the draw is uniform over the
        {{ pool.length ? 'realized' : '' }} distinct values, so the answer always has at least one
        word; in <strong>range</strong> mode it is uniform over [min, max] and may have none.
        <strong>drawByValue</strong> rejects with
        <code class="font-mono">no_match</code> when your number has no word — try 999 to see the
        typed error.
      </p>

      <template v-if="cast">
        <div class="flex flex-wrap items-baseline gap-3">
          <span class="text-5xl leading-none font-mono text-highlighted">{{ fmtNum(cast.value, { digits: 0 }) }}</span>
          <span class="text-sm text-muted">drawn from {{ summary.providerName }}</span>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Words at that value" :value="cast.words.length" :digits="0" :note="`${cast.exact.length} exactly equal`" />
          <StatTile
            label="Commonness"
            :value="cast.commonness"
            :digits="4"
            :tone="cast.commonness > 0.02 ? 'warning' : 'neutral'"
            :note="`of ${cast.lexiconSize} admissible words`"
          />
          <StatTile label="Digital root" :value="cast.numbers.digitalRoot" :digits="0" :note="`digit sum ${cast.numbers.digitSum}`" />
          <StatTile
            label="Arithmetic"
            :value="cast.numbers.isPrime ? 'prime' : factorization || '—'"
            :mono="true"
            :note="cast.numbers.isTriangular ? `triangular T(${cast.numbers.triangularIndex})` : cast.numbers.isSquare ? 'a perfect square' : 'no figurate property'"
          />
        </div>

        <ul v-if="words.length" class="flex flex-wrap gap-1.5">
          <li
            v-for="row in words"
            :key="row.word"
            class="rounded border border-default bg-elevated/40 px-2 py-1 text-sm"
            :title="row.gloss"
          >
            <span dir="auto">{{ row.word }}</span>
            <span v-if="!row.exact" class="ml-1 text-dimmed">±</span>
            <span v-if="row.gloss" class="ml-1.5 text-muted">{{ row.gloss }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted">
          No lexicon word has that value — exactly what a uniform draw over a range should do most
          of the time. An empty answer is as informative as a full one.
        </p>

        <AccountingBadge
          :bytes-consumed="cast.bytesConsumed"
          :bytes-fetched="cast.bytesFetched"
          :bits-used="cast.bitsUsed"
          :source="summary.providerName"
        />
      </template>

      <template v-if="drawn">
        <div class="flex flex-wrap items-baseline gap-3">
          <span class="text-4xl leading-none text-highlighted" dir="auto">{{ drawn.word }}</span>
          <span v-if="glossOf(drawn.word)" class="text-muted">{{ glossOf(drawn.word) }}</span>
        </div>
        <div class="grid gap-3 sm:grid-cols-3">
          <StatTile label="Target" :value="drawn.targetValue" :digits="0" :note="`± ${drawn.tolerance}`" />
          <StatTile label="Its value" :value="drawn.result.value" :digits="0" tone="primary" :note="drawn.cipher" />
          <StatTile label="Reduced" :value="drawn.result.reduced" :digits="0" note="digital root" />
        </div>
        <p class="text-sm text-muted">
          Letters:
          <span class="font-mono">
            {{ drawn.result.byLetter.map((l) => `${l.char}=${l.value}`).join('  +  ') }}
          </span>
        </p>
        <AccountingBadge
          :bytes-consumed="drawn.bytesConsumed"
          :bytes-fetched="drawn.bytesFetched"
          :bits-used="drawn.bitsUsed"
          :source="summary.providerName"
        />
      </template>

      <CodeSnippet :code="code" title="what this button ran" />

      <HonestNote variant="contested" title="Be honest about what this is">
        The drawn number is random entropy and nothing more; the returned words are merely whichever
        lexicon entries happen to share that value. <code class="font-mono">commonness</code> says
        how cheap the coincidence is. Nothing here is evidence of anything — the package documents
        exactly that, in those words.
      </HonestNote>
    </div>

    <template #footer>
      Bounds are checked before any entropy is read: min and max must be integers in [0, 2⁴⁸]
      spanning at most 2⁴⁸ values, and an already-aborted signal rejects the draw before it reads a
      byte. In 0.2.0 every failure here is a <code class="font-mono">GematriaError</code> — reader
      failures keep their <code class="font-mono">aborted</code> /
      <code class="font-mono">insufficient_entropy</code> / <code class="font-mono">source_error</code>
      code and carry the original <code class="font-mono">OracleError</code> as
      <code class="font-mono">cause</code>.
    </template>
  </DemoSection>
</template>
