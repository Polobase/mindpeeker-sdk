<script setup lang="ts">
/** Section 7a — drand: the round clock as arithmetic, a live round with
 * structural verification, and a historical round anyone can re-fetch. */
import {
  type BeaconOutcome,
  BEACON_DRAWS,
  CHAIN,
  CHAIN_ROWS,
  clockNow,
  type ClockReading,
  drawBeacon,
  lookupDrandRound,
  ROUND_SNIPPET,
  type RoundLookup,
} from '~/lib/entropy/beacons'
import { fmtDuration } from '~/lib/format'

const drandDraw = BEACON_DRAWS.find((d) => d.id === 'drand')!

const clock = ref<ClockReading>(clockNow())
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => {
    clock.value = clockNow()
  }, 1000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const latestTask = useTask<BeaconOutcome>()
const latest = computed(() => latestTask.result.value)

function fetchLatest(): void {
  void latestTask.run(async (signal) => {
    const outcome = await drawBeacon(drandDraw, signal)
    const round = outcome.rounds[0]?.round
    if (round && round > 1) roundInput.value = round - 1
    return outcome
  })
}

const roundInput = ref(1)
const lookupTask = useTask<RoundLookup>()
const lookup = computed(() => lookupTask.result.value)

function fetchRound(): void {
  void lookupTask.run(async (signal) => await lookupDrandRound(roundInput.value, signal))
}

onMounted(() => {
  roundInput.value = Math.max(1, clock.value.round - 1)
})

const iso = (ms?: number) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '—')
const drift = computed(() => {
  const round = latest.value?.rounds[0]?.round
  const clockRound = latest.value?.clockRound
  return round !== undefined && clockRound !== undefined ? clockRound - round : undefined
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      title="drand — a clock made of rounds"
      :api="['drandRoundAt', 'drandRoundTime', 'DRAND_CHAINS']"
      description="drand rounds are not a sequence you have to look up: they are arithmetic on the chain's genesis time and period. Round r of quicknet is published at (1692803367 + 3(r − 1)) seconds since the Unix epoch — this clock runs entirely offline."
    >
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Round right now"
          :value="clock.round"
          :digits="0"
          tone="primary"
          note="drandRoundAt(Date.now(), DRAND_CHAINS.quicknet)"
        />
        <StatTile
          label="Published at"
          :value="iso(clock.publishedMs)"
          note="drandRoundTime(round, chain) — UTC"
        />
        <StatTile
          label="Next round"
          :value="iso(clock.nextMs)"
          :note="`every ${CHAIN.period} s, by the ${CHAIN.beaconId} chain`"
        />
        <StatTile
          label="Your clock vs the beacon"
          :value="drift === undefined ? '—' : `${drift >= 0 ? '+' : ''}${drift} rounds`"
          :tone="drift === undefined ? 'neutral' : Math.abs(drift) <= 1 ? 'success' : 'warning'"
          note="fetch a round below to compare"
        />
      </div>

      <CodeSnippet class="mt-4" :code="ROUND_SNIPPET" title="the round clock and a replay" />

      <template #footer>
        The “future round” check inside <code class="font-mono">verify: 'structural'</code> uses
        <em>your local clock</em>: a machine whose time is far off will reject honest rounds.
      </template>
    </DemoSection>

    <DemoSection
      title="A live round, structurally verified"
      :level="3"
      :api="['drand', 'verify: structural', 'sources[].rounds']"
      description="32 bytes from the League of Entropy, with the round they came from."
    >
      <template #controls>
        <RunControls
          :busy="latestTask.busy.value"
          label="Fetch the latest round"
          busy-label="Asking the mirrors…"
          icon="i-lucide-radio-tower"
          hint="A live HTTPS request from your browser to api.drand.sh — it can be blocked by CORS or a network policy."
          @run="fetchLatest"
          @cancel="latestTask.cancel()"
        />
      </template>

      <ErrorAlert :err="latestTask.error.value" @dismiss="latestTask.reset()" />

      <div v-if="latest" class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-3">
          <StatTile label="Round" :value="latest.rounds[0]?.round ?? null" :digits="0" />
          <StatTile label="Published" :value="iso(latest.rounds[0]?.timestamp)" />
          <StatTile label="Round trip" :value="fmtDuration(latest.ms)" note="structural checks included" />
        </div>
        <div class="flex flex-wrap gap-2">
          <UBadge size="sm" color="success" variant="subtle">structural checks passed</UBadge>
          <UBadge size="sm" color="warning" variant="subtle">privacy: {{ latest.privacy }}</UBadge>
          <UBadge size="sm" color="neutral" variant="subtle">{{ latest.providerName }}</UBadge>
        </div>
        <code class="block font-mono text-[11px] break-all text-highlighted">{{ latest.hex }}</code>
        <p v-if="latest.rounds[0]?.signature" class="text-xs text-muted font-mono break-all">
          signature {{ latest.rounds[0]?.signature?.slice(0, 48) }}…
        </p>
      </div>

      <HonestNote variant="caveat" class="mt-4">
        A passing structural check means the response is <em>shaped</em> like the pinned chain — the
        chain hash, genesis, period and scheme match, the signature has the scheme's length, the
        round is not from the future, and the served randomness equals SHA-256(signature). The BLS
        signature itself is <strong>not</strong> verified (that needs a pairing library), so this
        does not prove the League of Entropy signed it. And the value is public: everyone in the
        world gets these same 32 bytes for this round.
      </HonestNote>

      <CodeSnippet class="mt-3" :code="drandDraw.code" title="what the button ran" />
    </DemoSection>

    <DemoSection
      title="Look up any round"
      :level="3"
      :api="['getRound', 'BeaconRoundResult', 'bad_response']"
      description="Every beacon result names its rounds, and getRound re-fetches any of them — the basis of an auditable draw."
    >
      <template #controls>
        <UFormField label="Round number" size="sm">
          <UInputNumber v-model="roundInput" :min="1" :step="1" size="sm" class="w-44" />
        </UFormField>
        <RunControls
          :busy="lookupTask.busy.value"
          label="getRound(n)"
          busy-label="Fetching…"
          icon="i-lucide-search"
          @run="fetchRound"
          @cancel="lookupTask.cancel()"
        />
      </template>

      <ErrorAlert :err="lookupTask.error.value" @dismiss="lookupTask.reset()" />

      <div v-if="lookup" class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-4">
          <StatTile label="Requested" :value="lookup.requested" :digits="0" />
          <StatTile
            label="Server answered"
            :value="lookup.round.round"
            :digits="0"
            :tone="lookup.matches ? 'success' : 'error'"
            :note="lookup.matches ? 'the round that was asked for' : 'WRONG ROUND — this throws'"
          />
          <StatTile label="Published (arithmetic)" :value="iso(lookup.publishedMs)" />
          <StatTile label="Round trip" :value="fmtDuration(lookup.ms)" />
        </div>
        <code class="block font-mono text-[11px] break-all text-highlighted">{{ lookup.hex }}</code>
      </div>

      <template #footer>
        Every historical fetch checks that the server answered the round that was asked for: a
        caching proxy serving the latest pulse for every path fails with
        <code class="font-mono">bad_response</code> instead of silently repeating bytes. The same
        guard covers the NIST family, CURBy, Tezos and Bitcoin.
      </template>
    </DemoSection>

    <DemoSection
      title="The pinned chains"
      :level="3"
      :api="['DRAND_CHAINS', 'DRAND_SIGNATURE_BYTES']"
      description="Chain parameters checked in on 2026-09-17. verify: 'structural' compares the mirror's /v2/beacons/{id}/info against exactly these values."
    >
      <div class="overflow-x-auto rounded-md border border-default">
        <table class="w-full text-sm border-collapse">
          <caption class="sr-only">League of Entropy chains pinned by the package</caption>
          <thead class="bg-elevated/60 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" class="text-left font-medium px-3 py-2">Beacon</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Chain hash</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Genesis (UTC)</th>
              <th scope="col" class="text-right font-medium px-3 py-2">Period</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Scheme</th>
              <th scope="col" class="text-right font-medium px-3 py-2">Signature</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="chain in CHAIN_ROWS" :key="chain.beaconId" class="border-t border-default">
              <td class="px-3 py-2 font-mono text-xs text-primary">{{ chain.beaconId }}</td>
              <td class="px-3 py-2 font-mono text-[11px] text-muted">
                {{ chain.hash.slice(0, 16) }}…
              </td>
              <td class="px-3 py-2 font-mono text-xs">{{ iso(chain.genesisTime * 1000) }}</td>
              <td class="px-3 py-2 text-right font-mono text-xs">{{ chain.period }} s</td>
              <td class="px-3 py-2 font-mono text-[11px]">{{ chain.scheme }}</td>
              <td class="px-3 py-2 text-right font-mono text-xs">
                {{ chain.signatureBytes ? `${chain.signatureBytes} B` : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </DemoSection>

    <EntropyBeaconPulses />
  </div>
</template>
