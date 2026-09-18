<script setup lang="ts">
/**
 * Fisher's (1924) method of scoring coincidences: partial credit for partial
 * agreement, priced by how rare that agreement or a better one is.
 *
 * Every score here is −log₁₀ P(this grade or better) summed over independent
 * attributes and standardized to mean 0, SD 10 — pure arithmetic, so the whole
 * section is live.
 */
import type { FisherMatchScore, PlayingCard } from '@mindpeeker/coincidence'
import {
  fisherClosenessScore,
  fisherMatchScore,
  PLAYING_CARD_SCHEME,
  playingCardGrades,
} from '@mindpeeker/coincidence'
import { cardLabel, rankItems, SUIT_GRADES, suitItems, VALUE_GRADES } from '~/lib/coincidence/cards'
import { fmtNum } from '~/lib/format'

/** Fisher's printed scores, as the README tabulates them. */
const PUBLISHED: Readonly<Record<string, number>> = {
  OO: -11.18,
  OR: -6.11,
  ON: 18.5,
  CO: -3.16,
  CR: 1.91,
  CN: 26.53,
  SO: 4.86,
  SR: 9.94,
  SN: 34.55,
}

const GRADE_MEANING: Readonly<Record<string, string>> = {
  O: 'no agreement',
  C: 'same colour, other suit',
  S: 'same suit',
  R: 'both spot cards or both pictures, different value',
  N: 'the same value',
}

const called = ref<PlayingCard>({ suit: 'hearts', rank: 11 })
const drawn = ref<PlayingCard>({ suit: 'diamonds', rank: 12 })

const suits = suitItems()
const ranks = rankItems()

interface Pair {
  grades?: readonly string[]
  score?: FisherMatchScore
  error?: unknown
}

const pair = computed<Pair>(() => {
  try {
    const grades = playingCardGrades(called.value, drawn.value)
    return { grades, score: fisherMatchScore(PLAYING_CARD_SCHEME, grades) }
  } catch (error) {
    return { error }
  }
})

const table = computed(() =>
  SUIT_GRADES.map((suit) => ({
    suit,
    cells: VALUE_GRADES.map((value) => {
      const key = `${suit}${value}`
      const score = fisherMatchScore(PLAYING_CARD_SCHEME, [suit, value])
      return {
        key,
        value,
        live: score.score,
        published: PUBLISHED[key] as number,
        raw: score.raw,
        tail: score.tailProbability,
        agrees: Math.abs(score.score - (PUBLISHED[key] as number)) < 0.005,
        current: pair.value.grades?.[0] === suit && pair.value.grades?.[1] === value,
      }
    }),
  })),
)

const allAgree = computed(() => table.value.every((row) => row.cells.every((cell) => cell.agrees)))

/* Fisher's closeness score, for attributes with no natural cutoff. */
const dayA = ref(200)
const dayB = ref(203)
const circleC = ref(365)

interface Closeness {
  distance: number
  c: number
  score?: number
  tail?: number
  error?: unknown
}

const closeness = computed<Closeness>(() => {
  const c = Math.max(1, Math.trunc(Number(circleC.value) || 1))
  const a = Math.max(1, Math.min(c, Math.trunc(Number(dayA.value) || 1)))
  const b = Math.max(1, Math.min(c, Math.trunc(Number(dayB.value) || 1)))
  const raw = Math.abs(a - b)
  const distance = Math.min(raw, c - raw)
  try {
    return {
      distance,
      c,
      score: fisherClosenessScore(distance, c),
      tail: Math.min(1, (1 + 2 * distance) / c),
    }
  } catch (error) {
    return { distance, c, error }
  }
})

const code = computed(() => {
  const grades = pair.value.grades ?? ['C', 'R']
  const score = pair.value.score
  return `import {
  PLAYING_CARD_SCHEME, playingCardGrades, fisherMatchScore, fisherClosenessScore,
} from '@mindpeeker/coincidence'

const grades = playingCardGrades(
  { suit: '${called.value.suit}', rank: ${called.value.rank} },
  { suit: '${drawn.value.suit}', rank: ${drawn.value.rank} },
)                                       // ['${grades[0]}', '${grades[1]}']

fisherMatchScore(PLAYING_CARD_SCHEME, grades)
// { raw: ${score ? fmtNum(score.raw, { digits: 6 }) : '…'},
//   score: ${score ? fmtNum(score.score, { digits: 4 }) : '…'},
//   tailProbability: ${score ? fmtNum(score.tailProbability, { digits: 6 }) : '…'} }

fisherClosenessScore(${closeness.value.distance}, ${closeness.value.c})
// ${closeness.value.score === undefined ? '…' : fmtNum(closeness.value.score, { digits: 6 })}`
})
</script>

<template>
  <DemoSection
    id="fisher"
    title="Fisher 1924 — scoring a partial coincidence"
    :api="['PLAYING_CARD_SCHEME', 'playingCardGrades', 'fisherMatchScore', 'fisherScheme', 'fisherClosenessScore']"
    description="A called card and a drawn card agree in degrees. Fisher scored each attribute by −log₁₀ P(this grade or better), summed over independent attributes and standardized to null mean 0 and SD 10, so partial hits count for what they are worth and nothing more."
  >
    <div class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Null mean of the raw score"
          :value="PLAYING_CARD_SCHEME.mean"
          :digits="8"
          size="sm"
          note="exact, from the grade probabilities"
        />
        <StatTile
          label="Null SD of the raw score"
          :value="PLAYING_CARD_SCHEME.sd"
          :digits="8"
          size="sm"
          note="the scale the ±10 standardization uses"
        />
        <StatTile
          label="Attributes"
          :value="PLAYING_CARD_SCHEME.attributes.length"
          :digits="0"
          size="sm"
          :note="PLAYING_CARD_SCHEME.attributes.map((a) => a.name).join(' · ')"
        />
      </div>

      <div>
        <h3 class="text-sm font-semibold text-highlighted">The nine scores, recomputed here</h3>
        <p class="mt-1 text-sm text-muted">
          Suit grades <span class="font-mono">O</span> (different colour, ½),
          <span class="font-mono">C</span> (same colour, other suit, ¼),
          <span class="font-mono">S</span> (same suit, ¼); value grades
          <span class="font-mono">O</span> (60/169), <span class="font-mono">R</span> (96/169),
          <span class="font-mono">N</span> (13/169). The grey number is what Fisher printed.
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th scope="col" class="text-left py-1.5 pr-3 font-medium">suit \ value</th>
                <th v-for="value in VALUE_GRADES" :key="value" scope="col" class="text-right py-1.5 px-3 font-medium">
                  {{ value }} — {{ GRADE_MEANING[value] }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in table" :key="row.suit" class="border-t border-default">
                <th scope="row" class="py-1.5 pr-3 text-left font-normal">
                  <span class="font-mono">{{ row.suit }}</span>
                  <span class="text-muted text-xs"> — {{ GRADE_MEANING[row.suit] }}</span>
                </th>
                <td
                  v-for="cell in row.cells"
                  :key="cell.key"
                  class="py-1.5 px-3 text-right font-mono tabular-nums"
                  :class="cell.current ? 'bg-primary/10 text-primary rounded' : ''"
                >
                  {{ cell.live > 0 ? '+' : '' }}{{ fmtNum(cell.live, { digits: 2 }) }}
                  <span class="text-dimmed text-xs">({{ cell.published > 0 ? '+' : '' }}{{ cell.published.toFixed(2) }})</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <UBadge :color="allAgree ? 'success' : 'warning'" variant="subtle" size="sm" class="mt-2">
          {{ allAgree ? 'all nine reproduce Fisher’s printed scores' : 'a cell disagrees — report it' }}
        </UBadge>
      </div>

      <div class="rounded-md border border-default bg-elevated/30 p-3">
        <h3 class="text-sm font-semibold text-highlighted">Score one pair</h3>
        <div class="mt-3 flex flex-wrap items-end gap-3">
          <UFormField label="Called — suit" size="sm" class="w-full sm:w-44">
            <USelect v-model="called.suit" :items="suits" class="w-full" />
          </UFormField>
          <UFormField label="Called — rank" size="sm" class="w-full sm:w-28">
            <USelect v-model="called.rank" :items="ranks" class="w-full" />
          </UFormField>
          <UFormField label="Drawn — suit" size="sm" class="w-full sm:w-44">
            <USelect v-model="drawn.suit" :items="suits" class="w-full" />
          </UFormField>
          <UFormField label="Drawn — rank" size="sm" class="w-full sm:w-28">
            <USelect v-model="drawn.rank" :items="ranks" class="w-full" />
          </UFormField>
          <p class="pb-1.5 font-mono text-lg text-highlighted">
            {{ cardLabel(called) }} vs {{ cardLabel(drawn) }}
          </p>
        </div>

        <ErrorAlert :err="pair.error" title="That pair was rejected" class="mt-3" />

        <div v-if="pair.score" class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Grades"
            size="sm"
            :note="`${GRADE_MEANING[pair.grades?.[0] ?? 'O']} · ${GRADE_MEANING[pair.grades?.[1] ?? 'O']}`"
          >
            <template #value>
              <span class="font-mono">{{ pair.grades?.[0] }} {{ pair.grades?.[1] }}</span>
            </template>
          </StatTile>
          <StatTile
            label="Raw score"
            :value="pair.score.raw"
            :digits="6"
            size="sm"
            note="Σ −log₁₀ P(grade or better)"
          />
          <StatTile
            label="Standardized score"
            :value="pair.score.score"
            :digits="2"
            size="sm"
            tone="primary"
            note="10·(raw − μ)/σ — null mean 0, SD 10"
          />
          <StatTile
            label="Tail probability"
            :value="pair.score.tailProbability"
            :digits="6"
            size="sm"
            note="10^−raw = P(this agreement or better) under the null"
          />
        </div>
      </div>

      <div class="rounded-md border border-default bg-elevated/30 p-3">
        <h3 class="text-sm font-semibold text-highlighted">Closeness, without choosing a cutoff</h3>
        <p class="mt-1 text-sm text-muted">
          Diaconis &amp; Mosteller's §6 alternative to “within d days”: score the observed circular
          distance itself, −log₁₀((1 + 2d)/c). Nothing has to be decided in advance about how near
          is near — which is exactly the choice the near-match tab warns about.
        </p>
        <div class="mt-3 flex flex-wrap items-end gap-3">
          <UFormField label="Day of year A" size="sm" class="w-full sm:w-36">
            <UInputNumber v-model="dayA" :min="1" :step="1" class="w-full" />
          </UFormField>
          <UFormField label="Day of year B" size="sm" class="w-full sm:w-36">
            <UInputNumber v-model="dayB" :min="1" :step="1" class="w-full" />
          </UFormField>
          <UFormField label="c — positions on the circle" size="sm" class="w-full sm:w-48">
            <UInputNumber v-model="circleC" :min="1" :step="1" class="w-full" />
          </UFormField>
        </div>
        <ErrorAlert
          :err="closeness.error"
          title="fisherClosenessScore rejected that distance"
          class="mt-3"
        />
        <div v-if="closeness.score !== undefined" class="mt-3 grid gap-3 sm:grid-cols-3">
          <StatTile label="Circular distance d" :value="closeness.distance" :digits="0" size="sm" note="min(|a−b|, c−|a−b|)" />
          <StatTile
            label="Closeness score"
            :value="closeness.score"
            :digits="6"
            size="sm"
            tone="primary"
            note="−log₁₀((1 + 2d)/c) — surprisal in decades"
          />
          <StatTile
            label="P(at least this close)"
            :value="closeness.tail ?? null"
            :digits="6"
            size="sm"
            note="the probability the score is the logarithm of"
          />
        </div>
      </div>

      <CodeSnippet :code="code" title="what this section ran" />

      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact">
          The scheme's null moments are exact sums over the grade probabilities: mean
          {{ fmtNum(PLAYING_CARD_SCHEME.mean, { digits: 8 }) }} and SD
          {{ fmtNum(PLAYING_CARD_SCHEME.sd, { digits: 8 }) }}. The tests enumerate all 52 × 52 card
          pairs, and `fisherScheme` will build the same machinery for any list of graded attributes
          whose grade probabilities sum to 1.
        </HonestNote>
        <HonestNote variant="caveat" title="Whose randomness is assumed">
          This null assumes <em>both</em> cards are drawn at random. In a real guessing test the
          guesser's calls are not random — people avoid repeats and favour certain cards — so the
          scores are biased unless the analysis conditions on the call, as Fisher did in 1928.
          Fisher's own printed example of 49 draws is internally inconsistent as published: the
          listed counts total −23.21 where the page prints −31.21 (the conclusion, chance, holds
          either way). No p-value is claimed for a score, because its null distribution is discrete.
        </HonestNote>
      </div>
    </div>

    <template #footer>
      R. A. Fisher, <em>A Method of Scoring Coincidences in Tests with Playing Cards</em>,
      Proceedings of the Society for Psychical Research 34 (1924), 181–185; reviewed in Diaconis
      &amp; Mosteller (1989), Table 2 and §6. The scores are recomputed from first principles; no
      text is reproduced.
    </template>
  </DemoSection>
</template>
