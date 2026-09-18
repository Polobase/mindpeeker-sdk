<script setup lang="ts">
/**
 * Commonness 2.0 — how cheap equal values are in a lexicon *before* any word is
 * looked up: the collision probability of its value histogram, its Rényi-2
 * entropy, the equal pairs it already contains, and the birthday curve.
 *
 * The curve itself comes from `@mindpeeker/coincidence` (cookbook recipe 6), so
 * the exact non-uniform probabilities are the package's, not a re-derivation.
 */
import { birthdayMatch, noMatchNonUniform, peopleForKWayMatch, peopleForMatch } from '@mindpeeker/coincidence'
import type { CipherId, CollisionProfile } from '@mindpeeker/gematria'
import { birthdayBound, collisionProfile, expectedMatches, getCipher, value } from '@mindpeeker/gematria'
import { cipherSelectItems, SCRIPT_LABELS } from '~/lib/gematria/ciphers'
import { SEPHER_SEPHIROTH, wordsFor } from '~/lib/gematria/lexicon'
import { fmtNum } from '~/lib/format'

const cipherItems = cipherSelectItems({ scripts: ['hebrew', 'greek', 'latin'] })
const cipher = ref<CipherId>('he-hechrachi')
const colel = ref(false)
const tolerance = ref(0)
const maxDraws = 40

const options = computed(() =>
  tolerance.value > 0 ? { tolerance: tolerance.value } : colel.value ? { colel: true } : {},
)

const outcome = computed<{ profile?: CollisionProfile; error?: unknown }>(() => {
  try {
    return { profile: collisionProfile(SEPHER_SEPHIROTH, cipher.value, options.value) }
  } catch (error) {
    return { error }
  }
})
const profile = computed(() => outcome.value.profile)

const baseline = computed(() => {
  try {
    return expectedMatches(SEPHER_SEPHIROTH, cipher.value, options.value)
  } catch {
    return undefined
  }
})

const probs = computed(() => (profile.value?.histogram ?? []).map((bin) => bin.probability))

/** P(at least one shared value) among k draws: this corpus vs equal values. */
const curve = computed(() => {
  const p = probs.value
  const distinct = profile.value?.distinct ?? 0
  if (p.length === 0 || distinct === 0) return undefined
  const ks: number[] = []
  const uneven: number[] = []
  const even: number[] = []
  for (let k = 2; k <= maxDraws; k++) {
    ks.push(k)
    uneven.push(noMatchNonUniform(k, p).match)
    even.push(birthdayMatch(k, distinct))
  }
  return { ks, uneven, even }
})

const crowding = computed(() => {
  const histogram = profile.value?.histogram ?? []
  return [...histogram]
    .sort((a, b) => b.count - a.count || a.value - b.value)
    .slice(0, 12)
    .map((bin) => ({ value: bin.value, count: bin.count }))
})

const words = computed(() => {
  try {
    return wordsFor(cipher.value)
  } catch {
    return []
  }
})
const allValues = computed(() => words.value.map((word) => value(word, cipher.value)))

const halfWay = computed(() => {
  const p = probs.value
  const distinct = profile.value?.distinct
  if (p.length === 0 || !distinct) return undefined
  try {
    return { uneven: peopleForKWayMatch(0.5, p, 2), even: peopleForMatch(0.5, distinct) }
  } catch {
    return undefined
  }
})

/** The same bound at another target probability — √(2 ln(1/(1−P)) / q). */
const bound95 = computed(() => {
  const q = profile.value?.collisionProbability
  if (!q) return undefined
  try {
    return birthdayBound(q, 0.95)
  } catch {
    return undefined
  }
})

/** The identity that separates the i.i.d. expectation from the exact pair count. */
const pairGap = computed(() => {
  const p = profile.value
  if (!p) return undefined
  return {
    gap: p.expectedEqualPairs - p.observedEqualPairs,
    predicted: (p.n * (1 - p.collisionProbability)) / 2,
  }
})

const script = computed(() => SCRIPT_LABELS[getCipher(cipher.value).script])

const code = computed(() => {
  const opts =
    tolerance.value > 0
      ? `, { tolerance: ${tolerance.value} }`
      : colel.value
        ? ', { colel: true }'
        : ''
  return `import { collisionProfile, expectedMatches, birthdayBound } from '@mindpeeker/gematria'
import { SEPHER_SEPHIROTH } from '@mindpeeker/gematria/lexicon'
import { noMatchNonUniform, birthdayMatch } from '@mindpeeker/coincidence'

const p = collisionProfile(SEPHER_SEPHIROTH, '${cipher.value}'${opts})
p.n / p.distinct            // ${profile.value?.n ?? '—'} words, ${profile.value?.distinct ?? '—'} distinct values
p.collisionProbability      // ${fmtNum(profile.value?.collisionProbability ?? 0, { digits: 6 })} = q
p.collisionEntropyBits      // ${fmtNum(profile.value?.collisionEntropyBits ?? 0, { digits: 3 })} bits = −log₂ q
p.observedEqualPairs        // ${profile.value?.observedEqualPairs ?? '—'} equal pairs already in the corpus
p.birthdayBound50           // ${fmtNum(profile.value?.birthdayBound50 ?? 0, { digits: 2 })} draws ≈ even odds

const probs = p.histogram.map((bin) => bin.probability)
noMatchNonUniform(10, probs).match  // ${fmtNum(curve.value ? (curve.value.uneven[8] as number) : 0, { digits: 4 })} — exact, this histogram
birthdayMatch(10, p.distinct)       // ${fmtNum(curve.value ? (curve.value.even[8] as number) : 0, { digits: 4 })} — if every value were equally likely
expectedMatches(SEPHER_SEPHIROTH, '${cipher.value}'${opts}) // ${fmtNum(baseline.value ?? 0, { digits: 4 })}`
})
</script>

<template>
  <DemoSection
    id="commonness"
    title="How cheap is an equal value?"
    :api="['collisionProfile', 'expectedMatches', 'birthdayBound', 'noMatchNonUniform', 'birthdayMatch']"
    description="One commonness says how crowded a single value is. These statistics price equal values for the whole lexicon before any word is looked up — the honest denominator behind every “match” on this page."
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
      <ErrorAlert :err="outcome.error" title="collisionProfile rejected that" :dismissible="false" />

      <template v-if="profile">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Admissible words"
            :value="profile.n"
            :digits="0"
            :note="`${script} entries — the denominator`"
          />
          <StatTile label="Distinct values" :value="profile.distinct" :digits="0" note="among those words" />
          <StatTile
            label="Collision probability q"
            :value="profile.collisionProbability"
            :digits="5"
            tone="primary"
            note="two random entries share a value"
          />
          <StatTile
            label="Collision entropy"
            :value="profile.collisionEntropyBits"
            :digits="3"
            note="−log₂ q, in bits"
          />
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Equal pairs in the corpus"
            :value="profile.observedEqualPairs"
            :digits="0"
            tone="warning"
            note="exact count, not an estimate"
          />
          <StatTile
            label="Expected pairs among n draws"
            :value="profile.expectedEqualPairs"
            :digits="1"
            note="C(n,2)·q — i.i.d., so it repeats entries"
          />
          <StatTile
            label="Birthday bound (50%)"
            :value="profile.birthdayBound50"
            :digits="2"
            note="√(2 ln 2 / q) draws"
          />
          <StatTile
            label="Birthday bound (95%)"
            :value="bound95 ?? null"
            :digits="2"
            :note="`expectedMatches: ${fmtNum(baseline ?? 0, { digits: 3 })} per random entry`"
          />
        </div>

        <LineChart
          v-if="curve"
          :series="[
            { name: 'this corpus (exact, uneven values)', y: curve.uneven },
            { name: 'if every value were equally likely', y: curve.even, color: 2, dashed: true },
          ]"
          :x="curve.ks"
          :hlines="[{ value: 0.5, label: 'more likely than not' }]"
          :vlines="[{ value: profile.birthdayBound50, label: 'birthday bound', color: 'warning' }]"
          x-label="random entries drawn"
          y-label="P(some two share a value)"
          :y-domain="[0, 1]"
          :height="280"
          aria-label="Probability that some two drawn entries share a gematria value, exact versus equal-value idealization"
          :format="(v) => fmtNum(v, { digits: 4 })"
        />

        <p v-if="halfWay" class="text-sm text-muted">
          {{ halfWay.uneven }} entries make a shared value more likely than not in this corpus;
          {{ halfWay.even }} would be needed if the {{ profile.distinct }} values were equally
          likely. Unevenness always makes coincidences <em>cheaper</em> — that is Haigh's lemma, not
          a property of gematria.
        </p>

        <BarChart
          v-if="crowding.length"
          :categories="crowding.map((row) => String(row.value))"
          :values="crowding.map((row) => row.count)"
          :expected="profile.n / profile.distinct"
          expected-label="average words per value"
          y-label="words at this value"
          x-label="the most crowded values"
          :height="220"
          aria-label="The most crowded values of the lexicon under the selected cipher"
          :format="(v) => fmtNum(v, { digits: 0 })"
        />

        <Histogram
          v-if="allValues.length >= 8"
          :values="allValues"
          :bins="32"
          x-label="gematria value"
          y-label="entries"
          :height="220"
          aria-label="Distribution of the lexicon's values under the selected cipher"
        />

        <p v-if="pairGap" class="text-sm text-muted">
          The i.i.d. expectation exceeds the exact pair count by
          <span class="font-mono">{{ fmtNum(pairGap.gap, { digits: 2 }) }}</span>, and
          n(1 − q)/2 predicts <span class="font-mono">{{ fmtNum(pairGap.predicted, { digits: 2 }) }}</span> —
          the draws that simply repeat the same entry. Two ways of counting, one identity.
        </p>

        <CodeSnippet :code="code" title="what this section ran" />

        <HonestNote variant="exact">
          Every number above is exact for the corpus and cipher named: the histogram is a count, q is
          a ratio of integers until the final division, and the curve is the package's exact
          recursion P(all different) = k!·e<sub>k</sub>(p), not a simulation. The birthday bound
          alone is the standard leading-order approximation.
        </HonestNote>

        <HonestNote variant="caveat" title="What a small commonness does not buy">
          A rare value is still a value. The price is for <em>this</em> curated corpus, a reference
          dictionary rather than a sample of the language, and a pair you found by searching is
          priced by the search, not by one draw. For the exact coincidence arithmetic — k-way
          matches, near matches, the law of truly large numbers —
          <ULink to="/coincidence" class="text-primary">see the coincidence page</ULink>.
        </HonestNote>
      </template>
    </div>

    <template #footer>
      Cookbook recipe 6 runs exactly this, and checks the exact number by drawing words from an
      entropy source: 0.3812 collisions over 20 000 draws of ten words against the exact 0.3845.
      Sources: Diaconis &amp; Mosteller, <em>Methods for studying coincidences</em> (JASA 84, 1989);
      Rényi (1961); Haigh (1999) on non-uniformity.
    </template>
  </DemoSection>
</template>
