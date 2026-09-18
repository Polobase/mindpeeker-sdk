<script setup lang="ts">
/**
 * @mindpeeker/ledger — six explorable primitives, one per tab.
 *
 * Every tab is its own client-only component; switching tabs unmounts the
 * previous one, which aborts its in-flight run (useTask disposes on unmount).
 */
const TABS = [
  { value: 'canonical', label: 'Canonical JSON', icon: 'i-lucide-braces' },
  { value: 'chain', label: 'Hash chain', icon: 'i-lucide-link' },
  { value: 'merkle', label: 'Merkle proofs', icon: 'i-lucide-git-fork' },
  { value: 'checkpoint', label: 'Checkpoints', icon: 'i-lucide-signature' },
  { value: 'commit', label: 'Commit–reveal', icon: 'i-lucide-dices' },
  { value: 'bracket', label: 'Registration & time', icon: 'i-lucide-hourglass' },
] as const

const tab = useTabQuery('canonical', { tabs: TABS.map((t) => t.value) })
</script>

<template>
  <div class="flex flex-col gap-6">
    <HonestNote variant="exact" title="Exact mathematics, narrow claims">
      Everything on this page is exact and third-party checkable: RFC 8785 canonical bytes, SHA-256
      digests, RFC 6962 proofs, Ed25519 signatures. What the mathematics supports is much narrower
      than what a “tamper-evident log” sounds like. A chain proves that lines were not edited
      <em>relative to a head you published earlier</em>; a Merkle proof proves membership in a tree
      <em>whose size and root came from a signed checkpoint</em>; a beacon or a VDF seal bounds a
      record from <strong class="text-highlighted">below</strong> in time only. None of it shows
      that the data came from where the log says, that the experimenter behaved well off the record,
      or that a hypothesis is true.
    </HonestNote>

    <UTabs
      v-model="tab"
      :items="TABS"
      :content="false"
      class="w-full"
      :ui="{ root: 'w-full min-w-0', list: 'w-full overflow-x-auto', trigger: 'shrink-0' }"
    />

    <LedgerCanonical v-if="tab === 'canonical'" />
    <template v-else-if="tab === 'chain'">
      <LedgerChain />
      <LedgerPsi />
    </template>
    <LedgerMerkle v-else-if="tab === 'merkle'" />
    <LedgerCheckpoint v-else-if="tab === 'checkpoint'" />
    <template v-else-if="tab === 'commit'">
      <LedgerCommit />
      <LedgerCommitBias />
    </template>
    <template v-else-if="tab === 'bracket'">
      <LedgerRegistration />
      <LedgerBracket />
    </template>
  </div>
</template>
