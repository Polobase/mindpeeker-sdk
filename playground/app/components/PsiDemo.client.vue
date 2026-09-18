<script setup lang="ts">
/**
 * @mindpeeker/psi — seven explorable protocol families, one per tab.
 *
 * Every tab is its own client-only component; switching tabs unmounts the
 * previous one, which aborts its in-flight run (useTask disposes on unmount).
 */
const TABS = [
  { value: 'tripolar', label: 'Tripolar', icon: 'i-lucide-target' },
  { value: 'bayes', label: 'Bayes', icon: 'i-lucide-scale' },
  { value: 'surrogates', label: 'Surrogates', icon: 'i-lucide-shuffle' },
  { value: 'multiplicity', label: 'Multiplicity', icon: 'i-lucide-list-checks' },
  { value: 'event', label: 'GCP events', icon: 'i-lucide-globe' },
  { value: 'record', label: 'Recording', icon: 'i-lucide-file-json' },
  { value: 'presentiment', label: 'Presentiment', icon: 'i-lucide-hourglass' },
] as const

const tab = useTabQuery('tripolar', { tabs: TABS.map((t) => t.value) })
</script>

<template>
  <div class="flex flex-col gap-6">
    <HonestNote variant="contested">
      The mind–matter hypothesis — that intention or collective attention correlates with the output
      of a physical random source — is contested, and the mainstream reading is that the reported
      anomalies come from selection effects, publication bias and analytic flexibility. PEAR's
      primary effect was not reproduced in the three-laboratory consortium replication (Jahn et al.
      2000); GCP's own analyst concluded after 17 years that the correlations look more like
      goal-oriented experimenter effects than a global field (Bancel 2017). Everything below is a
      protocol and a null distribution, not a verdict: nothing on this page can establish an effect,
      and a small p is a fact about bytes, never an explanation of them.
    </HonestNote>

    <UTabs
      v-model="tab"
      :items="TABS"
      :content="false"
      class="w-full"
      :ui="{ root: 'w-full min-w-0', list: 'w-full overflow-x-auto', trigger: 'shrink-0' }"
    />

    <PsiTripolar v-if="tab === 'tripolar'" />
    <PsiBayes v-else-if="tab === 'bayes'" />
    <PsiSurrogates v-else-if="tab === 'surrogates'" />
    <PsiMultiplicity v-else-if="tab === 'multiplicity'" />
    <PsiEvent v-else-if="tab === 'event'" />
    <PsiRecord v-else-if="tab === 'record'" />
    <PsiPresentiment v-else-if="tab === 'presentiment'" />
  </div>
</template>
