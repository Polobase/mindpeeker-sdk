<script setup lang="ts">
/**
 * @mindpeeker/scan — six explorable surfaces, one per tab.
 *
 * Every tab is its own client-only component; switching tabs unmounts the
 * previous one, which aborts its in-flight run (useTask disposes on unmount).
 */
const TABS = [
  { value: 'catalog', label: 'Catalog scan', icon: 'i-lucide-scan-search' },
  { value: 'null', label: 'Honest null', icon: 'i-lucide-scale' },
  { value: 'broadcast', label: 'Broadcast', icon: 'i-lucide-radio' },
  { value: 'signature', label: 'Signatures', icon: 'i-lucide-signature' },
  { value: 'sweep', label: 'Classical sweep', icon: 'i-lucide-gauge' },
  { value: 'tripolar', label: 'Tripolar scan', icon: 'i-lucide-target' },
] as const

const tab = useTabQuery('catalog', { tabs: TABS.map((t) => t.value) })
</script>

<template>
  <div class="flex flex-col gap-6">
    <HonestNote variant="contested">
      Radionics as medicine is pseudoscience: there is no plausible mechanism, no controlled trial
      has shown diagnostic or therapeutic validity, and regulators have acted against radionic
      devices. Drown's instrument tested under AMA auspices in 1950 was "completely negative".
      Nothing here is a medical, diagnostic or efficacy claim. The one part of the premise a random
      source can test — that intention biases an RNG — is itself contested and most likely null:
      Bösch, Steinkamp &amp; Boller (2006) attribute the pooled effect to publication bias, and
      Maier, Dechamps &amp; Pflitsch (2018, n = 12 571) report evidence <em>against</em> micro-PK at
      BF₀₁ = 10.07. What this package adds to AetherOne is the missing null model: every number
      below either has an exact chance baseline stated next to it, or is labelled as having none.
    </HonestNote>

    <UTabs
      v-model="tab"
      :items="TABS"
      :content="false"
      class="w-full"
      :ui="{ root: 'w-full min-w-0', list: 'w-full overflow-x-auto', trigger: 'shrink-0' }"
    />

    <ScanCatalog v-if="tab === 'catalog'" />
    <ScanNull v-else-if="tab === 'null'" />
    <ScanBroadcast v-else-if="tab === 'broadcast'" />
    <ScanSignature v-else-if="tab === 'signature'" />
    <ScanSweep v-else-if="tab === 'sweep'" />
    <ScanTripolar v-else-if="tab === 'tripolar'" />

    <HonestNote variant="caveat" title="The anti-manipulation ethic">
      AetherOnePi ships an explicit ethic — dowsing-permission questions, "for the best and good of
      all". It is ported here as documentation: do not use this to target, profile or act upon a
      person without their knowledge and consent. A broadcast has no physical effect; the intent to
      covertly influence is what the ethic guards against.
    </HonestNote>
  </div>
</template>
