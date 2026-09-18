<script setup lang="ts">
/**
 * `@mindpeeker/judging` — one tab per family of scores, from a ganzfeld hit
 * count to the price of looking twice.
 *
 * Most of this page is exact arithmetic that consumes no entropy. Three tabs
 * draw bytes — the Zener pack you play against, the null sequences in the
 * displacement tab, the random judging matrices — and they all go through
 * `~/lib/entropy`, so the header's source and DRBG seed govern them.
 */
import { MAX_CLOSED_DECK_CARDS, MAX_ENUMERATION_SIZE } from '@mindpeeker/judging'
import { sourceSummary } from '~/lib/entropy'

const TABS = [
  { value: 'forced', label: 'Forced choice', icon: 'i-lucide-target' },
  { value: 'zener', label: 'Zener game', icon: 'i-lucide-layers' },
  { value: 'decks', label: 'Closed-deck nulls', icon: 'i-lucide-sigma' },
  { value: 'ranks', label: 'Rank judging', icon: 'i-lucide-list-ordered' },
  { value: 'matrix', label: 'Judging matrices', icon: 'i-lucide-grid-3x3' },
  { value: 'displacement', label: 'Displacement', icon: 'i-lucide-move-horizontal' },
  { value: 'looks', label: 'Many looks', icon: 'i-lucide-list-checks' },
] as const

const tab = useTabQuery('forced', { tabs: TABS.map((t) => t.value) })
const summary = sourceSummary()
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="rounded-lg border border-default bg-elevated/30 p-4 flex flex-col gap-3">
      <p class="text-sm text-muted">
        RNG experiments score bits; card guessing, the ganzfeld and remote viewing score
        <em>people's responses against targets</em>. This package computes the null those designs
        actually imply — exact binomial tails, the matching distribution of a shuffled pack
        (up to <span class="font-mono">{{ MAX_CLOSED_DECK_CARDS }}</span> cards), Read's
        feedback baseline, the exact sum-of-ranks convolution, a direct count over all
        <span class="font-mono">k!</span> pairings of a judging matrix (exact enumeration to
        k&nbsp;=&nbsp;<span class="font-mono">{{ MAX_ENUMERATION_SIZE }}</span>, further with the
        integer DP), Soal's pattern-exact displacement variance, and the price of extra looks.
        Every classic critique in the README is something you can compute here. Entropy, where a tab
        draws it, comes from the header source
        (<span class="font-mono text-highlighted">{{ summary.providerName }}</span>).
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact" title="What these numbers are">
          Exact mathematics under a stated design: targets drawn uniformly, a shuffled pack, a
          random pairing of transcripts to targets. The tails are integer or rational arithmetic
          wherever that is possible, and each package value on this page is printed next to the
          number published for it.
        </HonestNote>
        <HonestNote variant="contested" title="What they are not">
          Whether psi exists is contested, and nothing on this page tests it. A small p-value is a
          fact about calls versus targets <em>under the design's null</em>. It becomes evidence only
          if the design really held — targets drawn after the response was fixed, blind judging,
          sensory shielding, no feedback that moves the null, and the statistic, sample size and
          scoring rule fixed in advance. No library can check those, and this one does not claim to.
        </HonestNote>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton to="/psi" size="xs" variant="soft" color="neutral" icon="i-lucide-brain">
          Protocols and anytime-valid monitoring — psi
        </UButton>
        <UButton to="/coincidence" size="xs" variant="soft" color="neutral" icon="i-lucide-sparkles">
          Pricing a coincidence
        </UButton>
        <UButton to="/oracle" size="xs" variant="soft" color="neutral" icon="i-lucide-dices">
          Where the shuffles come from — oracle
        </UButton>
      </div>
    </div>

    <UTabs
      v-model="tab"
      :items="TABS"
      :content="false"
      variant="link"
      size="sm"
      class="w-full"
      :ui="{ list: 'overflow-x-auto', trigger: 'shrink-0' }"
    />

    <template v-if="tab === 'forced'">
      <JudgingForcedChoice />
      <JudgingBayes />
      <JudgingRuns />
    </template>
    <template v-else-if="tab === 'zener'">
      <JudgingZener />
    </template>
    <template v-else-if="tab === 'decks'">
      <JudgingClosedDeck />
      <JudgingCapacity />
    </template>
    <template v-else-if="tab === 'ranks'">
      <JudgingRanks />
      <JudgingConsensus />
      <JudgingMerit />
    </template>
    <template v-else-if="tab === 'matrix'">
      <JudgingMatrix />
    </template>
    <template v-else-if="tab === 'displacement'">
      <JudgingDisplacement />
      <JudgingCarington />
    </template>
    <template v-else>
      <JudgingLooks />
      <JudgingStopping />
    </template>
  </div>
</template>
