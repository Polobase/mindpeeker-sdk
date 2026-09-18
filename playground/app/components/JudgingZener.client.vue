<script setup lang="ts">
/**
 * A real 25-card Zener pack, shuffled from the header's entropy source, and a
 * call sequence you make yourself — then the exact score.
 *
 * The pack is a *closed deck*: five cards of each of five symbols, in a uniform
 * random order (`drawWithoutReplacement` over all 25 positions). That is not 25
 * independent draws, and with feedback it is not even chance 5 — which is the
 * whole point of the two nulls printed underneath.
 */
import { readFeedbackExpectation } from '@mindpeeker/judging'
import { drbgSource, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtNum } from '~/lib/format'
import { composition, optimalFeedbackCalls, shuffledPack, uniformSymbols } from '~/lib/judging/draw'
import { ZENER_SYMBOLS } from '~/lib/judging/presets'
import { currentSeedLabel } from '~/utils/sources'

const PACK = [5, 5, 5, 5, 5] as const
const CARDS = 25

const deck = ref<number[]>([])
const calls = ref<number[]>([])
const feedback = ref(false)
const dealt = ref(false)
const announcement = ref('')

const task = useTask<number[]>()
const autoTask = useTask<number[]>()
const summary = sourceSummary()

const position = computed(() => calls.value.length)
const finished = computed(() => dealt.value && calls.value.length >= CARDS)
const remaining = computed(() => {
  const counts = PACK.slice() as number[]
  for (let i = 0; i < calls.value.length; i++) counts[deck.value[i] as number] -= 1
  return counts
})

/** Read's baseline for the pack — the chance level when every card is shown. */
const feedbackBaseline = computed(() => readFeedbackExpectation([...PACK]))

function deal(): void {
  void task
    .run(async (signal) => {
      // A deterministic source is rewound first, so the same seed always deals
      // the same pack — that is what makes a replay a replay.
      if (summary.deterministic) restartSource()
      return await shuffledPack([...PACK], { signal })
    })
    .then((pack) => {
      if (!pack) return
      deck.value = pack
      calls.value = []
      dealt.value = true
      announcement.value = `A new pack is dealt. Call card 1 of ${CARDS}.`
    })
}

function call(symbol: number): void {
  if (!dealt.value || finished.value) return
  const index = calls.value.length
  calls.value = [...calls.value, symbol]
  const card = deck.value[index] as number
  announcement.value = feedback.value
    ? `Card ${index + 1} was ${ZENER_SYMBOLS[card]?.name}. You called ${ZENER_SYMBOLS[symbol]?.name} — ${card === symbol ? 'hit' : 'miss'}.`
    : `Call ${index + 1} of ${CARDS} recorded: ${ZENER_SYMBOLS[symbol]?.name}.`
}

function undo(): void {
  if (!calls.value.length) return
  calls.value = calls.value.slice(0, -1)
  announcement.value = `Last call taken back. ${CARDS - calls.value.length} calls left.`
}

function reset(): void {
  calls.value = []
  announcement.value = 'Calls cleared; the same pack is still face down.'
}

/** Fill the remaining calls with a caller who has no information at all. */
function autoRandom(): void {
  void autoTask
    .run(async (signal) => {
      const need = CARDS - calls.value.length
      const control = drbgSource(`${currentSeedLabel()} / zener caller`)
      return await uniformSymbols(need, 5, { signal, source: control })
    })
    .then((extra) => {
      if (!extra) return
      calls.value = [...calls.value, ...extra]
      announcement.value = 'A seeded no-psi caller finished the pack.'
    })
}

/** Fill the remaining calls with Read's optimal feedback strategy. */
function autoOptimal(): void {
  if (!dealt.value) return
  const already = calls.value.length
  const rest = optimalFeedbackCalls(deck.value.slice(already), remaining.value)
  calls.value = [...calls.value, ...rest]
  feedback.value = true
  announcement.value =
    "Read's optimal feedback strategy finished the pack — it calls a most represented remaining symbol every time."
}

watch(feedback, () => {
  if (calls.value.length > 0 && !finished.value) reset()
})

const cards = computed(() =>
  Array.from({ length: CARDS }, (_, i) => {
    const call = calls.value[i]
    const card = deck.value[i]
    const revealed = dealt.value && (finished.value || (feedback.value && call !== undefined))
    return {
      index: i,
      call,
      card,
      revealed,
      hit: revealed && call !== undefined && call === card,
      current: dealt.value && !finished.value && i === position.value,
    }
  }),
)

const hits = computed(() =>
  calls.value.reduce((total, call, i) => total + (call === deck.value[i] ? 1 : 0), 0),
)

const callComposition = computed(() => composition(calls.value, 5))
</script>

<template>
  <DemoSection
    id="zener-game"
    title="Play a pack: 25 cards, five symbols, one shuffle"
    :api="['drawWithoutReplacement', 'closedDeckTest', 'readFeedbackExpectation']"
    description="The pack is dealt from the source selected in the header and shuffled with an exactly uniform Fisher–Yates draw. Call each card; then the score is computed against the exact closed-deck null — and, if you looked at every card, against Read's much higher feedback baseline."
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :label="dealt ? 'Deal a new pack' : 'Deal a pack'"
        busy-label="Shuffling…"
        icon="i-lucide-shuffle"
        :hint="summary.deterministic ? 'the seeded source is rewound first, so this pack is reproducible' : `shuffled from ${summary.label}`"
        @run="deal"
        @cancel="task.cancel()"
      >
        <UButton
          v-if="dealt && calls.length > 0 && !finished"
          variant="soft"
          color="neutral"
          icon="i-lucide-rotate-ccw"
          @click="undo"
        >
          Take back
        </UButton>
        <UButton v-if="dealt && calls.length > 0" variant="ghost" color="neutral" @click="reset">
          Clear calls
        </UButton>
      </RunControls>
      <USwitch
        v-model="feedback"
        label="Show each card after the call"
        description="trial-by-trial feedback — it changes the chance level from 5 to 8.65"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" title="The pack could not be dealt" @dismiss="task.reset()" />
      <ErrorAlert :err="autoTask.error.value" title="The control caller failed" @dismiss="autoTask.reset()" />

      <p v-if="!dealt" class="text-sm text-muted">
        Nothing has been drawn yet. Dealing consumes about 30 bytes from
        <span class="font-mono text-highlighted">{{ summary.providerName }}</span> — one uniform
        integer per Fisher–Yates swap, rejection-sampled, so every one of the
        25!/(5!)⁵ = 623 360 743 125 120 distinct packs is equally likely.
      </p>

      <div v-if="dealt" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm">
            <template v-if="!finished">
              <span class="text-muted">Card</span>
              <span class="font-mono text-highlighted">{{ position + 1 }}</span>
              <span class="text-muted">of {{ CARDS }} — call a symbol.</span>
            </template>
            <template v-else>
              <span class="text-muted">Pack finished:</span>
              <span class="font-mono text-highlighted">{{ hits }}</span>
              <span class="text-muted">hits in {{ CARDS }} calls.</span>
            </template>
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="!finished"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-dices"
              :loading="autoTask.busy.value"
              @click="autoRandom"
            >
              Let a no-psi caller finish
            </UButton>
            <UButton
              v-if="!finished"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-eye"
              @click="autoOptimal"
            >
              Play Read's optimal feedback strategy
            </UButton>
          </div>
        </div>

        <div class="grid grid-cols-5 gap-1.5 sm:gap-2">
          <div
            v-for="entry in cards"
            :key="entry.index"
            class="rounded-md border p-1.5 text-center min-w-0"
            :class="[
              entry.current ? 'border-primary bg-primary/10' : 'border-default bg-elevated/40',
              entry.revealed && entry.hit ? 'ring-1 ring-success' : '',
            ]"
          >
            <div class="text-[10px] text-dimmed tabular-nums">{{ entry.index + 1 }}</div>
            <div class="text-xl leading-none" :class="entry.revealed ? 'text-highlighted' : 'text-dimmed'">
              <span v-if="entry.revealed">{{ ZENER_SYMBOLS[entry.card as number]?.glyph }}</span>
              <span v-else aria-hidden="true">·</span>
              <span class="sr-only">
                {{ entry.revealed ? `card ${ZENER_SYMBOLS[entry.card as number]?.name}` : 'card face down' }}
              </span>
            </div>
            <div class="mt-0.5 text-xs" :class="entry.call === undefined ? 'text-dimmed' : 'text-muted'">
              <span v-if="entry.call !== undefined">{{ ZENER_SYMBOLS[entry.call]?.glyph }}</span>
              <span v-else>—</span>
            </div>
            <div v-if="entry.revealed && entry.call !== undefined" class="text-[10px]" :class="entry.hit ? 'text-success' : 'text-dimmed'">
              {{ entry.hit ? 'hit' : 'miss' }}
            </div>
          </div>
        </div>

        <div v-if="!finished" class="flex flex-wrap gap-2">
          <UButton
            v-for="symbol in ZENER_SYMBOLS"
            :key="symbol.id"
            size="lg"
            variant="outline"
            color="neutral"
            :aria-label="`Call ${symbol.name}`"
            class="min-w-16 justify-center"
            @click="call(symbol.id)"
          >
            <span class="text-xl" aria-hidden="true">{{ symbol.glyph }}</span>
            <span class="ml-1.5 text-xs">{{ symbol.name }}</span>
          </UButton>
        </div>

        <p class="sr-only" aria-live="polite">{{ announcement }}</p>

        <p v-if="feedback && !finished" class="text-sm text-warning">
          With every card shown, a guesser who simply calls a most represented remaining symbol
          expects
          <span class="font-mono">{{ fmtNum(feedbackBaseline.expected, { digits: 4 }) }}</span>
          hits per pack and nothing paranormal has happened. Your score has to beat that, not 5.
        </p>
      </div>

      <JudgingZenerScore
        v-if="finished"
        :calls="calls"
        :hits="hits"
        :call-counts="callComposition"
        :feedback="feedback"
      />

      <HonestNote variant="caveat">
        This is a demonstration of a null, not an experiment. Your calls and the pack come from the
        same browser; nothing here is blinded, pre-registered or shielded, and you can deal again
        until a pack looks good — which is exactly the optional-stopping error the last tab prices.
        Read the numbers as "this is what chance looks like", never as a result.
      </HonestNote>
    </div>

    <template #footer>
      The shuffle is <span class="font-mono">drawWithoutReplacement(reader, 25, 25)</span> from
      <span class="font-mono">@mindpeeker/oracle</span>: uniform swap indices by rejection sampling,
      so the mapping adds no bias of its own.
    </template>
  </DemoSection>
</template>
