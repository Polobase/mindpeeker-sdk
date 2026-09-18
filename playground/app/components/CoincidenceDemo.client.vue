<script setup lang="ts">
/**
 * `@mindpeeker/coincidence` — one tab per family of exact probabilities, from
 * the birthday problem to an exact clustering test for event logs.
 *
 * Almost everything on this page is closed-form arithmetic that consumes no
 * entropy; the two tabs that draw bytes (Fisher's card series, the seriality
 * log generator) go through `~/lib/entropy`, so the header's source and DRBG
 * seed govern them. The exact k-fold engine and `seriesClustering` run in a
 * Web Worker, because they are the only calls here that can cost seconds.
 */
import { NONUNIFORM_EXACT_LIMIT } from '@mindpeeker/coincidence'
import { closeCoincidenceWorker } from '~/lib/coincidence/exact-client'
import { sourceSummary } from '~/lib/entropy'

const TABS = [
  { value: 'birthday', label: 'Birthday', icon: 'i-lucide-cake' },
  { value: 'unequal', label: 'Unequal categories', icon: 'i-lucide-bar-chart-3' },
  { value: 'kfold', label: 'k-fold matches', icon: 'i-lucide-layers' },
  { value: 'near', label: 'Near matches', icon: 'i-lucide-move-horizontal' },
  { value: 'attributes', label: 'Several attributes', icon: 'i-lucide-columns-3' },
  { value: 'large', label: 'Truly large numbers', icon: 'i-lucide-infinity' },
  { value: 'fisher', label: 'Fisher 1924', icon: 'i-lucide-spade' },
  { value: 'seriality', label: 'Seriality', icon: 'i-lucide-activity' },
] as const

const tab = useTabQuery('birthday', { tabs: TABS.map((t) => t.value) })
const summary = sourceSummary()

onUnmounted(closeCoincidenceWorker)
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="rounded-lg border border-default bg-elevated/30 p-4 flex flex-col gap-3">
      <p class="text-sm text-muted">
        Two words with the same gematria value, the same hexagram twice in a week, a burst of
        23s in a synchronicity log: each feels improbable when looked at alone. This package
        computes how often chance alone produces such a coincidence — the birthday problem and its
        generalisations, the Diaconis–Mosteller approximations next to the exact numbers, the law
        of truly large numbers, Fisher's 1924 graded-match scores and an exact clustering test for
        event timestamps. The exact non-uniform recursion runs while n × categories ≤
        <span class="font-mono">{{ NONUNIFORM_EXACT_LIMIT.toExponential(0) }}</span>, and every
        result says which method produced it. Only two tabs draw entropy — they use the source
        picked in the header (<span class="font-mono text-highlighted">{{ summary.providerName }}</span>).
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact" title="What these numbers are">
          Exact probabilities, up to floating-point rounding stated per function, under
          <em>explicit</em> null models: independent draws, the stated category probabilities,
          uniform event times. They say how cheap a coincidence is. Every closed form here was
          checked against brute-force enumeration and against independent fixtures computed in
          exact fractions and 60-digit arithmetic before it produced a reference value.
        </HonestNote>
        <HonestNote variant="caveat" title="What they are not">
          They are <strong>not</strong> evidence for or against synchronicity, seriality or any
          other meaning. A small probability shows that chance <em>under that model</em> rarely
          produces the observation. It does not show that something else did — and it means little
          if the match was chosen after the data were seen. The most common error is not in the
          arithmetic but in the choice of what counts as a match. Pre-register that choice, then
          use these functions for the denominator.
        </HonestNote>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton to="/gematria" size="xs" variant="soft" color="neutral" icon="i-lucide-scroll-text">
          Pricing a gematria coincidence
        </UButton>
        <UButton to="/oracle" size="xs" variant="soft" color="neutral" icon="i-lucide-dices">
          Repeated draws — the oracle page
        </UButton>
        <UButton to="/judging" size="xs" variant="soft" color="neutral" icon="i-lucide-gavel">
          Scoring human responses — judging
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

    <template v-if="tab === 'birthday'">
      <CoincidenceBirthday />
    </template>
    <template v-else-if="tab === 'unequal'">
      <CoincidenceUnequal />
      <CoincidenceLemma />
    </template>
    <template v-else-if="tab === 'kfold'">
      <CoincidenceKFold />
      <CoincidenceKFoldTable />
    </template>
    <template v-else-if="tab === 'near'">
      <CoincidenceNear />
    </template>
    <template v-else-if="tab === 'attributes'">
      <CoincidenceMulti />
    </template>
    <template v-else-if="tab === 'large'">
      <CoincidenceLarge />
    </template>
    <template v-else-if="tab === 'fisher'">
      <CoincidenceFisher />
      <CoincidenceFisherSeries />
    </template>
    <template v-else>
      <CoincidenceSeriality />
    </template>
  </div>
</template>
