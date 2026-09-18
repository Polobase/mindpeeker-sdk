<script setup lang="ts">
/** Section 7b — CURBy and the NIST IR 8213 family, including the verification
 * that currently fails and why that is the correct outcome. */
import {
  type BeaconDraw,
  type BeaconId,
  BEACON_DRAWS,
  type BeaconOutcome,
  drawBeacon,
  NIST_EXPLANATION,
} from '~/lib/entropy/beacons'
import { isAbortError } from '~/lib/errors'
import { fmtDuration } from '~/lib/format'

type Entry = { ok: true; outcome: BeaconOutcome } | { ok: false; err: unknown }

const DRAWS = BEACON_DRAWS.filter((d) => d.id !== 'drand')

const results = ref<Partial<Record<BeaconId, Entry>>>({})
const running = ref<BeaconId | undefined>(undefined)
const task = useTask<void>()

function run(draw: BeaconDraw): void {
  void task.run(async (signal) => {
    running.value = draw.id
    try {
      results.value = { ...results.value, [draw.id]: { ok: true, outcome: await drawBeacon(draw, signal) } }
    } catch (err) {
      if (isAbortError(err)) throw err
      results.value = { ...results.value, [draw.id]: { ok: false, err } }
    } finally {
      running.value = undefined
    }
  })
}

const iso = (ms?: number) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '—')
</script>

<template>
  <DemoSection
    title="Pulse beacons — CURBy, NIST and NQSN"
    :level="3"
    :api="['curby', 'nistBeacon', 'nqsn', 'verify']"
    description="The NIST IR 8213 family publishes one signed 512-bit pulse per minute, each linked to the previous one. Opt-in verification recomputes the output hash, the certificate id, the RSA signature and the chain linkage — and throws EntropyError('verification') when a check fails."
  >
    <div class="grid gap-4 xl:grid-cols-2">
      <div
        v-for="draw in DRAWS"
        :key="draw.id"
        class="rounded-md border border-default p-3 flex flex-col gap-2"
      >
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-sm font-semibold text-highlighted">{{ draw.title }}</h3>
          <UButton
            size="xs"
            color="primary"
            variant="soft"
            icon="i-lucide-radio"
            :loading="running === draw.id"
            :disabled="task.busy.value"
            @click="run(draw)"
          >
            Fetch
          </UButton>
        </div>
        <p class="text-sm text-muted">{{ draw.note }}</p>
        <p class="text-xs text-dimmed">
          <UIcon name="i-lucide-target" class="size-3 inline-block" /> expected: {{ draw.expect }}
        </p>

        <div
          v-if="results[draw.id]?.ok"
          class="rounded border border-default bg-elevated/40 p-2 flex flex-col gap-1.5"
        >
          <div class="flex flex-wrap items-center gap-2">
            <UBadge size="sm" color="success" variant="subtle">
              {{ fmtDuration(results[draw.id]?.outcome?.ms ?? 0) }}
            </UBadge>
            <UBadge size="sm" color="warning" variant="subtle">
              privacy: {{ results[draw.id]?.outcome?.privacy }}
            </UBadge>
            <code class="font-mono text-[11px] text-muted">
              {{ results[draw.id]?.outcome?.providerName }}
            </code>
          </div>
          <div
            v-for="round in results[draw.id]?.outcome?.rounds"
            :key="`${round.chain ?? 0}-${round.round}`"
            class="text-xs text-muted"
          >
            pulse <span class="font-mono text-highlighted">{{ round.round }}</span>
            <span v-if="round.chain !== undefined"> · chain {{ round.chain }}</span>
            · {{ iso(round.timestamp) }}
            <span v-if="round.signature" class="font-mono">
              · sig {{ round.signature.slice(0, 12) }}… ({{ round.signature.length / 2 }} B)
            </span>
          </div>
          <code class="block font-mono text-[11px] break-all text-highlighted">
            {{ results[draw.id]?.outcome?.hex }}
          </code>
        </div>

        <ErrorAlert
          v-else-if="results[draw.id] && !results[draw.id]?.ok"
          :err="results[draw.id]?.err"
          :dismissible="false"
        />

        <CodeSnippet :code="draw.code" />
      </div>
    </div>

    <HonestNote variant="caveat" class="mt-4" title="Why NIST’s verify: true fails right now">
      {{ NIST_EXPLANATION }}
    </HonestNote>

    <HonestNote variant="exact" class="mt-3">
      What a passing NIST-family check does establish: the pulse's outputValue is the SHA-512 of its
      own fields, consecutive pulses link (previous value, precommitment), and — with
      <code class="font-mono">verify: true</code> — the signature matches the certificate the beacon
      itself names. There is no X.509 chain, validity or revocation checking, so it proves integrity
      relative to the operator, not unpredictability. The serialization is pinned by checked-in live
      pulses because the deployed layout differs from the IR 8213 draft, which is still an initial
      public draft of a service NIST labels a beta.
    </HonestNote>

    <template #footer>
      Two more beacons of this family ship but are not fetched here:
      <code class="font-mono">uchile()</code> (cipherSuite 1 — unverifiable, try it in the Sources
      tab) and <code class="font-mono">inmetro()</code>, whose
      <code class="font-mono">verify: 'hash'</code> passes live while its certificate route answers
      HTTP 400. NIST's own warning applies to every value on this page:
      <strong>never use beacon values as secret keys</strong>.
    </template>
  </DemoSection>
</template>
