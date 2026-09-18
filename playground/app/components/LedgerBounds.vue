<script setup lang="ts">
/**
 * The two directions in time, and what each piece of evidence trusts. SSR-safe
 * (no SDK import) — it is a table of claims, not a computation.
 */
interface Bound {
  readonly evidence: string
  readonly direction: 'no earlier than' | 'no later than'
  readonly bound: string
  readonly trusts: string
}

const BOUNDS: readonly Bound[] = [
  {
    evidence: 'beacon value inside the record',
    direction: 'no earlier than',
    bound: "the round's publication time",
    trusts:
      'a genuine value you fetched yourself, that nobody could predict. drand: a 3 s round from a threshold of League of Entropy operators; NIST: a 60 s pulse from one operator.',
  },
  {
    evidence: 'VDF seal over the record',
    direction: 'no earlier than',
    bound: '≈ T sequential squarings after the seal input was fixed',
    trusts:
      'sequential squaring, an unfactored modulus, and the fastest hardware anyone owns — not this browser. T here is a demo value.',
  },
  {
    evidence: 'transparency-log inclusion (C2SP checkpoint, Sigstore Rekor)',
    direction: 'no later than',
    bound: 'the signed checkpoint',
    trusts: 'the log operator and its witnesses, with checkpoints that stay consistent.',
  },
  {
    evidence: 'OpenTimestamps attestation',
    direction: 'no later than',
    bound: 'the Bitcoin block',
    trusts:
      'Bitcoin consensus. Block times are loose by about two hours and confirmation takes hours.',
  },
  {
    evidence: 'a later beacon round that committed to the hash',
    direction: 'no later than',
    bound: 'that round',
    trusts: 'the beacon operator.',
  },
]
</script>

<template>
  <div class="rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-2">
    <h3 class="text-sm font-semibold text-highlighted">
      No single mechanism bounds a record from both sides
    </h3>
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead class="text-muted uppercase">
          <tr>
            <th class="text-left py-1.5 pr-3 font-medium">evidence</th>
            <th class="text-left py-1.5 px-3 font-medium">direction</th>
            <th class="text-left py-1.5 px-3 font-medium">bound</th>
            <th class="text-left py-1.5 pl-3 font-medium">what it trusts</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in BOUNDS" :key="row.evidence" class="border-t border-default align-top">
            <td class="py-1.5 pr-3 text-highlighted">{{ row.evidence }}</td>
            <td class="py-1.5 px-3">
              <UBadge
                size="sm"
                :color="row.direction === 'no earlier than' ? 'info' : 'primary'"
                variant="subtle"
                class="whitespace-nowrap"
              >
                {{ row.direction }}
              </UBadge>
            </td>
            <td class="py-1.5 px-3 text-muted">{{ row.bound }}</td>
            <td class="py-1.5 pl-3 text-muted max-w-md">{{ row.trusts }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-[11px] text-muted">
      For a pre-registered study the halves answer different questions: a no-later-than witness on
      the registration hash, obtained before data collection, shows the plan came first; a
      no-earlier-than bound on beacon-derived assignments shows they could not have shaped the plan.
      Neither shows that the data came from where they claim.
    </p>
  </div>
</template>
