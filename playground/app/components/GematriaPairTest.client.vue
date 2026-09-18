<script setup lang="ts">
/**
 * `pairMatchTest` — the Bible-code critique (McKay, Bar-Natan, Bar-Hillel &
 * Kalai) applied to a list of equal-value pairs: compare the agreements of
 * *your* pairing with random re-pairings of the same words.
 */
import type { CipherId, PairMatchTestResult, PairTestMethod } from '@mindpeeker/gematria'
import { equalValue, pairMatchTest, value } from '@mindpeeker/gematria'
import { cipherSelectItems } from '~/lib/gematria/ciphers'
import { CLASSIC_PAIRS, CONTROL_PAIRS, type WordPair } from '~/lib/gematria/lexicon'
import { nextMacrotask } from '~/lib/async'
import { fmtNum } from '~/lib/format'

const cipherItems = cipherSelectItems({ scripts: ['hebrew', 'greek', 'latin'] })

const cipher = ref<CipherId>('he-hechrachi')
const method = ref<PairTestMethod>('auto')
const permutations = ref(9999)
const seed = ref(0)
const colel = ref(false)
const pairs = ref<WordPair[]>(CLASSIC_PAIRS.map((p) => ({ ...p })))

const METHOD_ITEMS = [
  { label: 'auto — exact up to 12 pairs, else Monte Carlo', value: 'auto' },
  { label: 'exact — all n! pairings (n ≤ 16)', value: 'exact' },
  { label: 'permutation — seeded Monte Carlo', value: 'permutation' },
]

const task = useTask<PairMatchTestResult>()
const result = computed(() => task.result.value)

const rows = computed(() =>
  pairs.value.map((pair) => {
    const left = safeValue(pair.a)
    const right = safeValue(pair.b)
    return { ...pair, left, right, agree: agrees(pair.a, pair.b) }
  }),
)

/** The package's own comparison, window and all — not a hand-rolled subtraction. */
function agrees(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false
  try {
    return equalValue(a, b, cipher.value, colel.value ? { colel: true } : {})
  } catch {
    return false
  }
}

function safeValue(word: string): number | undefined {
  try {
    return value(word, cipher.value)
  } catch {
    return undefined
  }
}

function addPair(): void {
  pairs.value.push({ a: '', b: '' })
}
function removePair(index: number): void {
  pairs.value.splice(index, 1)
}
function load(preset: readonly WordPair[]): void {
  pairs.value = preset.map((p) => ({ ...p }))
  task.reset()
}

function run(): void {
  const list = pairs.value
    .filter((pair) => pair.a.trim() && pair.b.trim())
    .map((pair) => [pair.a.trim(), pair.b.trim()] as [string, string])
  void task.run(async () => {
    // Yield once so the button paints its busy state before the (short but
    // synchronous) enumeration runs.
    await nextMacrotask()
    return pairMatchTest(list, cipher.value, {
      method: method.value,
      permutations: permutations.value,
      seed: seed.value,
      ...(colel.value ? { colel: true } : {}),
    })
  })
}

const code = computed(
  () => `import { pairMatchTest } from '@mindpeeker/gematria'

pairMatchTest(
  [${pairs.value
    .slice(0, 3)
    .map((p) => `['${p.a}', '${p.b}']`)
    .join(', ')}, …],
  '${cipher.value}',
  { method: '${method.value}', permutations: ${permutations.value}, seed: ${seed.value}${colel.value ? ', colel: true' : ''} },
)
// { observed: ${result.value?.observed ?? '—'}, expected: ${fmtNum(result.value?.expected ?? 0, { digits: 3 })}, pValue: ${fmtNum(result.value?.pValue ?? 0, { digits: 5 })},
//   method: '${result.value?.method ?? '—'}', pairings: ${fmtNum(result.value?.pairings ?? 0, { digits: 0 })}, atLeastObserved: ${fmtNum(result.value?.atLeastObserved ?? 0, { digits: 0 })} }`,
)
</script>

<template>
  <DemoSection
    id="pair-test"
    title="A list of striking equalities is not evidence"
    :api="['pairMatchTest', 'equalValue', 'PairMatchTestResult']"
    description="The statistic is how many of your pairs agree; the null re-pairs the second column at random. Exact by subset dynamic programming over all n! pairings, or a seeded Monte Carlo estimate — the seed belongs in a pre-registration."
  >
    <template #controls>
      <UFormField label="Cipher" size="sm" class="w-full sm:w-64">
        <USelect v-model="cipher" :items="cipherItems" class="w-full" />
      </UFormField>
      <UFormField label="Method" size="sm" class="w-full sm:w-72">
        <USelect v-model="method" :items="METHOD_ITEMS" class="w-full" />
      </UFormField>
      <UFormField v-if="method !== 'exact'" label="Permutations" size="sm" class="w-full sm:w-40">
        <UInputNumber v-model="permutations" :min="99" :max="99999" :step="1000" class="w-full" />
      </UFormField>
      <UFormField label="Seed" size="sm" class="w-full sm:w-28">
        <UInputNumber v-model="seed" :min="0" class="w-full" />
      </UFormField>
      <UFormField label="Colel (±1)" size="sm">
        <USwitch v-model="colel" :label="colel ? 'on' : 'off'" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        label="Run the test"
        busy-label="Enumerating…"
        icon="i-lucide-shuffle"
        :hint="`${pairs.length} pairs`"
        @run="run"
        @cancel="task.cancel()"
      >
        <UButton size="sm" variant="soft" color="neutral" @click="load(CLASSIC_PAIRS)">
          Crowley's five
        </UButton>
        <UButton size="sm" variant="soft" color="neutral" @click="load(CONTROL_PAIRS)">
          Unselected control
        </UButton>
      </RunControls>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" title="pairMatchTest rejected that list" @dismiss="task.reset()" />

      <div class="flex flex-col gap-2">
        <div
          v-for="(pair, i) in pairs"
          :key="i"
          class="flex flex-wrap items-end gap-2 rounded-md border border-default bg-elevated/30 p-2"
        >
          <UFormField :label="`Pair ${i + 1} — word A`" size="sm" class="w-32">
            <UInput v-model="pair.a" dir="auto" class="w-full" spellcheck="false" />
          </UFormField>
          <UFormField :label="`Pair ${i + 1} — word B`" size="sm" class="w-32">
            <UInput v-model="pair.b" dir="auto" class="w-full" spellcheck="false" />
          </UFormField>
          <p class="text-sm font-mono text-muted pb-1.5">
            {{ rows[i]?.left ?? '—' }} · {{ rows[i]?.right ?? '—' }}
          </p>
          <UBadge v-if="rows[i]?.agree" color="success" variant="subtle" class="mb-1.5">agree</UBadge>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-trash-2"
            class="mb-1"
            :aria-label="`Remove pair ${i + 1}`"
            @click="removePair(i)"
          />
        </div>
        <div>
          <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-plus" @click="addPair">
            Add a pair
          </UButton>
        </div>
      </div>

      <template v-if="result">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Pairs that agree" :value="result.observed" :digits="0" tone="primary" :note="`of ${result.n}`" />
          <StatTile
            label="Expected under re-pairing"
            :value="result.expected"
            :digits="3"
            note="E[S] over random pairings"
          />
          <StatTile
            label="Pairings evaluated"
            :value="result.pairings"
            :digits="0"
            :note="result.method === 'exact' ? 'every n! pairing' : 'seeded Monte Carlo'"
          />
          <StatTile
            label="At least as many agreements"
            :value="result.atLeastObserved"
            :digits="0"
            note="the numerator of the p-value"
          />
        </div>

        <div class="flex flex-wrap items-center gap-3 rounded-md border border-default bg-elevated/40 p-3">
          <PValue :p="result.pValue" :kind="result.method === 'exact' ? 'exact' : 'pointwise'" />
          <span class="text-sm text-muted">
            {{ result.method === 'exact'
              ? 'exact: every pairing was enumerated by subset dynamic programming'
              : `add-one Monte Carlo estimate from ${fmtNum(result.pairings, { digits: 0 })} seeded shuffles — replay it from seed ${seed}` }}
          </span>
        </div>
      </template>

      <p v-else-if="!task.busy.value" class="text-sm text-muted">
        Nothing run yet — press <strong>Run the test</strong>. With Crowley's five the answer is
        p = 1/120: the pairs beat every other re-pairing of those same ten words.
      </p>

      <CodeSnippet :code="code" title="what this button ran" />

      <HonestNote variant="contested" title="What a tiny p-value here means">
        It means the pairs were <em>selected</em> for equal values — nothing else. That is the whole
        point of the test: Witztum, Rips &amp; Rosenberg's Genesis result had an extreme permutation
        rank, and McKay et al. reproduced a comparable result in <em>War and Peace</em> by tuning the
        name lists the same way. A small p here is a fact about your list, not about the words. The
        honest procedure is the reverse order: fix the list (and the seed) first, then run this.
      </HonestNote>
    </div>

    <template #footer>
      Sources: McKay, Bar-Natan, Bar-Hillel &amp; Kalai,
      <em>Solving the Bible Code Puzzle</em> (Statistical Science 14, 1999); Witztum, Rips &amp;
      Rosenberg (Statistical Science 9, 1994); North, Curtis &amp; Sham (AJHG 71, 2002) for the
      add-one rule that keeps a Monte Carlo p-value valid.
    </template>
  </DemoSection>
</template>
