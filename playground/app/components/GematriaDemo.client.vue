<script setup lang="ts">
/**
 * `@mindpeeker/gematria` — six tabs: the calculator, the cipher registry, the
 * Hebrew literal-Kabbalah tools, number lore, the lexicon with its collision
 * statistics, and the entropy bridge.
 *
 * Everything but the last tab is pure arithmetic and consumes no entropy; the
 * oracle tab draws from the source selected in the header.
 */
import { CIPHERS } from '@mindpeeker/gematria'
import { SEPHER_SEPHIROTH } from '~/lib/gematria/lexicon'
import { scriptCounts } from '~/lib/gematria/ciphers'
import { sourceSummary } from '~/lib/entropy'

const TABS = [
  { value: 'calculator', label: 'Calculator', icon: 'i-lucide-calculator' },
  { value: 'ciphers', label: 'Ciphers', icon: 'i-lucide-table-2' },
  { value: 'hebrew', label: 'Hebrew tools', icon: 'i-lucide-scroll-text' },
  { value: 'numbers', label: 'Numbers', icon: 'i-lucide-sigma' },
  { value: 'lexicon', label: 'Lexicon & matches', icon: 'i-lucide-library' },
  { value: 'oracle', label: 'Oracle', icon: 'i-lucide-dices' },
] as const

const tab = useTabQuery('calculator', { tabs: TABS.map((t) => t.value) })
const summary = sourceSummary()
const scripts = scriptCounts().length
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="rounded-lg border border-default bg-elevated/30 p-4 flex flex-col gap-3">
      <p class="text-sm text-muted">
        <span class="font-mono text-highlighted">{{ CIPHERS.length }}</span> ciphers across
        <span class="font-mono text-highlighted">{{ scripts }}</span> scripts, each mirroring on
        demand — reverse is a parameter, not a separate cipher. A value is the sum of a word's
        letters after normalization: exact integer arithmetic that consumes
        <strong>zero entropy</strong> and always returns the same number. The
        <span class="font-mono">{{ SEPHER_SEPHIROTH.length }}</span>-entry public-domain lexicon
        makes lookups work out of the box, and the collision statistics say what an equal value is
        worth before you look one up. Only the Oracle tab touches the header's entropy source
        (<span class="font-mono text-highlighted">{{ summary.providerName }}</span>).
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact">
          The computation is rigorous: a fixed table per cipher, a fixed normalization per script,
          integer sums with no rounding, and reverse defined over each cipher's canonical alphabet.
          The collision statistics, the permutation test and the number-lore portraits are exact
          too — counts and closed forms, not simulations.
        </HonestNote>
        <HonestNote variant="contested" title="What equal values mean is not asserted">
          That words of equal value are <em>meaningfully related</em> is a contested hermeneutic and
          contemplative tradition, not a scientific claim. Nothing in this package — or on this page
          — asserts hidden significance, and the Latin ciphers are explicitly modern: Latin never had
          native alphabetic numerals. R. Eleazar of Worms told his students to “do gematria, so that
          people should not deride you”; even proponents held the method loosely.
        </HonestNote>
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

    <template v-if="tab === 'calculator'">
      <GematriaCalculator />
      <GematriaProfile />
    </template>
    <template v-else-if="tab === 'ciphers'">
      <GematriaCipherTable />
      <GematriaCatalogue />
    </template>
    <template v-else-if="tab === 'hebrew'">
      <GematriaTemurah />
      <GematriaTziruph />
      <GematriaChambers />
      <GematriaMilui />
      <GematriaNumeral />
    </template>
    <template v-else-if="tab === 'numbers'">
      <GematriaNumbers />
    </template>
    <template v-else-if="tab === 'lexicon'">
      <GematriaLexicon />
      <GematriaCommonness />
      <GematriaPairTest />
      <GematriaCorpus />
    </template>
    <template v-else>
      <GematriaWordDraw />
      <GematriaCast />
      <GematriaValueCast />
    </template>
  </div>
</template>
