<script setup lang="ts">
/**
 * Scoring a finished pack three ways: the exact closed-deck null, the binomial
 * shortcut that Rhine's tables used, and — when the cards were shown — Read's
 * optimal-feedback baseline, under which 5 hits is not chance at all.
 */
import {
  closedDeckTest,
  forcedChoiceTest,
  guessingCapacity,
  readFeedbackExpectation,
} from '@mindpeeker/judging'
import { fmtNum, fmtP } from '~/lib/format'
import { groupBigInt, upperTailOf } from '~/lib/judging/math'
import { ZENER_SYMBOLS } from '~/lib/judging/presets'

const props = defineProps<{
  calls: readonly number[]
  hits: number
  callCounts: readonly number[]
  feedback: boolean
}>()

const PACK = [5, 5, 5, 5, 5]

const outcome = computed(() => {
  try {
    const closed = closedDeckTest(props.hits, PACK, { callCounts: [...props.callCounts] })
    const binomial = forcedChoiceTest(props.hits, 25, 0.2)
    const read = readFeedbackExpectation(PACK)
    return {
      closed,
      binomial,
      read,
      feedbackTail: upperTailOf(read.pmf, props.hits),
      capacity: guessingCapacity(props.hits / 25, 5),
    }
  } catch (error) {
    return { error }
  }
})

const closed = computed(() => ('closed' in outcome.value ? outcome.value.closed : undefined))
const binomial = computed(() => ('binomial' in outcome.value ? outcome.value.binomial : undefined))
const read = computed(() => ('read' in outcome.value ? outcome.value.read : undefined))

/** Both nulls over the same axis, 0 … 15 hits (above that the mass is invisible). */
const chart = computed(() => {
  const c = closed.value
  const r = read.value
  if (!c || !r) return undefined
  const top = Math.max(15, props.hits + 1)
  const categories: string[] = []
  const values: number[] = []
  const reference: number[] = []
  for (let k = 0; k <= top; k++) {
    categories.push(String(k))
    values.push(c.distribution.pmf[k] ?? 0)
    reference.push(r.pmf[k] ?? 0)
  }
  return { categories, values, reference, highlight: [props.hits] }
})

const balanced = computed(() => props.callCounts.every((count) => count === 5))

const code = computed(() => {
  const c = closed.value
  const b = binomial.value
  const r = read.value
  if (!c || !b || !r) return ''
  return `import { closedDeckTest, forcedChoiceTest, readFeedbackExpectation } from '@mindpeeker/judging'

const pack  = [5, 5, 5, 5, 5]
const calls = [${props.callCounts.join(', ')}]   // your call composition

const exact = closedDeckTest(${props.hits}, pack, { callCounts: calls })
exact.mean                    // ${fmtNum(c.mean, { digits: 4 })}
exact.sd                      // ${fmtNum(c.sd, { digits: 6 })}  (the pack's own SD)
exact.criticalRatio           // ${fmtNum(c.criticalRatio, { digits: 4 })}
exact.openDeckCriticalRatio   // ${fmtNum(c.openDeckCriticalRatio, { digits: 4 })}  ← the binomial shortcut
exact.pOneSided               // ${fmtP(c.pOneSided)}  exact, in integer arithmetic

forcedChoiceTest(${props.hits}, 25, 0.2).pOneSided  // ${fmtP(b.pOneSided)}  the open-deck p
readFeedbackExpectation(pack).expected   // ${fmtNum(r.expected, { digits: 4 })} hits, with feedback`
})
</script>

<template>
  <div class="flex flex-col gap-4 rounded-lg border border-default bg-elevated/30 p-4">
    <h3 class="text-sm font-semibold text-highlighted">Your score, against three different chances</h3>

    <ErrorAlert :err="'error' in outcome ? outcome.error : undefined" title="The score was rejected" />

    <div v-if="closed && binomial" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label="Hits" :value="hits" :digits="0" tone="primary" note="out of 25 calls" />
      <StatTile label="Closed-deck mean" :value="closed.mean" :digits="4" note="Σ cₛtₛ/N — 5 for a uniform pack" />
      <StatTile
        label="Closed-deck SD"
        :value="closed.sd"
        :digits="6"
        tone="info"
        :note="`open-deck SD ${fmtNum(Math.sqrt(closed.distribution.openDeckVariance), { digits: 4 })}`"
      />
      <StatTile
        label="Critical ratio"
        :value="closed.criticalRatio"
        :digits="4"
        :note="`binomial shortcut says ${fmtNum(closed.openDeckCriticalRatio, { digits: 4 })}`"
      />
    </div>

    <div v-if="closed && binomial" class="grid gap-3 sm:grid-cols-2">
      <div class="rounded-md border border-default bg-default/60 p-3 flex flex-col gap-1.5">
        <div class="text-[11px] uppercase tracking-wide text-muted">Exact closed-deck null</div>
        <PValue :p="closed.pOneSided" kind="exact" label="P(X ≥ hits)" />
        <p class="text-xs text-muted">
          Counted over all {{ groupBigInt(closed.distribution.arrangements) }} distinct orders of
          the pack, in bigint arithmetic — no normal approximation anywhere.
        </p>
      </div>
      <div class="rounded-md border border-default bg-default/60 p-3 flex flex-col gap-1.5">
        <div class="text-[11px] uppercase tracking-wide text-muted">Binomial shortcut (wrong null)</div>
        <PValue :p="binomial.pOneSided" kind="exact" label="P(X ≥ hits)" />
        <p class="text-xs text-muted">
          <span class="font-mono">forcedChoiceTest(hits, 25, 0.2)</span> treats the pack as 25
          independent draws. It understates the SD (2.000 against
          {{ fmtNum(closed.distribution.sd, { digits: 4 }) }}) and so inflates the ratio by about
          2 % in favour of ESP.
        </p>
      </div>
    </div>

    <div v-if="read" class="rounded-md border p-3 flex flex-col gap-1.5" :class="feedback ? 'border-warning/60 bg-warning/5' : 'border-default bg-default/60'">
      <div class="text-[11px] uppercase tracking-wide text-muted">
        Read's optimal-feedback baseline{{ feedback ? ' — the null that applies to your game' : '' }}
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <span class="font-mono text-highlighted">E = {{ fmtNum(read.expected, { digits: 4 }) }} hits</span>
        <span class="font-mono text-muted">SD = {{ fmtNum(read.sd, { digits: 4 }) }}</span>
        <span class="font-mono text-muted">without feedback: {{ read.withoutFeedback }}</span>
        <PValue v-if="feedback" :p="('feedbackTail' in outcome ? outcome.feedbackTail : undefined)" kind="exact" label="P(X ≥ hits | optimal strategy)" />
      </div>
      <p class="text-xs text-muted">
        <template v-if="feedback">
          You saw every card, so the right chance level is
          <span class="font-mono">{{ fmtNum(read.expected, { digits: 4 }) }}</span>, not 5: the
          closed-deck p above is <strong>not</strong> a valid p-value for this game. A guesser who
          simply names a most represented remaining symbol gets there with no psi at all
          (Read 1962; Diaconis &amp; Graham 1981).
        </template>
        <template v-else>
          You were not shown the cards, so chance stays at 5 and the closed-deck p applies. Had every
          card been revealed, the same pack would have had a chance level of
          <span class="font-mono">{{ fmtNum(read.expected, { digits: 4 }) }}</span> hits — the
          moderator that Honorton &amp; Ferrari found in the forced-choice meta-analysis.
        </template>
      </p>
    </div>

    <BarChart
      v-if="chart"
      :categories="chart.categories"
      :values="chart.values"
      :expected="chart.reference"
      expected-label="Read's feedback baseline pmf"
      :highlight="chart.highlight"
      x-label="hits in one pack"
      y-label="probability"
      :height="260"
      :format="(v) => fmtNum(v, { digits: 5 })"
      aria-label="Exact closed-deck distribution of hits per pack with the feedback baseline as reference ticks, your score highlighted"
    />

    <div class="text-sm text-muted flex flex-col gap-1">
      <p>
        Your calls were
        <span class="font-mono text-highlighted">{{
          callCounts.map((count, s) => `${count}×${ZENER_SYMBOLS[s]?.glyph}`).join('  ')
        }}</span>
        — {{ balanced ? 'a balanced sequence, like the pack itself' : 'an unbalanced sequence' }}.
        The call composition does not move the mean for a uniform pack, but it does change the
        variance, which is why <span class="font-mono">closedDeckTest</span> takes
        <span class="font-mono">callCounts</span> rather than assuming them.
      </p>
      <p v-if="'capacity' in outcome">
        As an information rate this score is
        <span class="font-mono text-highlighted">{{ fmtNum(outcome.capacity, { digits: 5 }) }}</span>
        bits per call (<span class="font-mono">guessingCapacity</span>) — a size, not a mechanism,
        and a single pack is far too short to estimate one.
      </p>
    </div>

    <CodeSnippet :code="code" title="what your pack scored" />
  </div>
</template>
