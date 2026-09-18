<script setup lang="ts">
/**
 * §6b — the time bracket: a beacon anchor, an optional VDF seal, an optional
 * no-later-than witness, and verifyTimeBracket run five ways so it is obvious
 * what each option actually buys.
 */
import {
  type BeaconAnchor,
  type TimeBracket,
  type TimeBracketVerification,
  TIME_BRACKET_SCHEMA,
  TIME_BRACKET_SEAL_SCHEMA,
  timeBracketHash,
  timeBracketSealInput,
  validateTimeBracket,
  verifyTimeBracket,
} from '@mindpeeker/ledger'
import { verifySealBytes } from '@mindpeeker/vdf'
import { nextMacrotask } from '~/lib/async'
import { fmtBytes, fmtDuration } from '~/lib/format'
import {
  type AnchorDraw,
  drawDrandAnchor,
  drawStandInAnchor,
  refetchRound,
  sealBracket,
  selfWitness,
  T_CHOICES,
  witnessVerifier,
} from '~/lib/ledger/bracket'
import { currentRegistrationHash, currentRegistrationTitle } from '~/lib/ledger/state'

const mode = ref<'drand' | 'standin'>('drand')
const T = ref(5000)
const withWitness = ref(true)

interface Sealed {
  readonly draw: AnchorDraw
  readonly bracket: TimeBracket
  readonly sealedHash: string
  readonly final: TimeBracket
  readonly sealInputBytes: number
  readonly sealBytes: number
  readonly sealMs: number
  readonly sealHex: string
}

const task = useTask<Sealed>()
const sealed = computed(() => task.result.value)

function build(): void {
  const registrationHash = currentRegistrationHash.value
  if (registrationHash === undefined) return
  void task.run(async (signal, setProgress) => {
    setProgress(0.05)
    const draw = mode.value === 'drand' ? await drawDrandAnchor(signal) : await drawStandInAnchor(signal)
    const bracket = validateTimeBracket({
      registrationHash,
      notBefore: { beacon: draw.anchor },
    })
    const sealInput = timeBracketSealInput(bracket)
    const seal = await sealBracket(bracket, T.value, {
      ...(signal ? { signal } : {}),
      onProgress: (fraction) => setProgress(0.1 + fraction * 0.85),
    })
    const withSeal: TimeBracket = {
      ...bracket,
      seal: { kind: 'vdf-pietrzak', bytesHex: seal.bytesHex },
    }
    const sealedHash = await timeBracketHash(withSeal)
    const final = withWitness.value
      ? { ...withSeal, notAfter: await selfWitness(sealedHash) }
      : withSeal
    setProgress(1)
    return {
      draw,
      bracket: withSeal,
      sealedHash,
      final,
      sealInputBytes: sealInput.length,
      sealBytes: seal.bytes,
      sealMs: seal.ms,
      sealHex: seal.bytesHex,
    }
  })
}

/** A verifier's independent copy of the anchored round. */
const replay = ref<{ hex: string; matches: boolean }>()
const replayTask = useTask<void>()
function refetch(): void {
  const current = sealed.value
  if (!current || !current.draw.public) return
  void replayTask.run(async (signal) => {
    const hex = await refetchRound(current.draw.anchor.round, signal)
    replay.value = { hex, matches: hex === current.draw.anchor.valueHex }
  })
}

interface Run {
  readonly label: string
  readonly options: string
  readonly note: string
  readonly result: TimeBracketVerification
}

const runs = shallowRef<Run[]>([])
const runError = ref<unknown>()

function otherHash(hash: string): string {
  const last = hash.slice(-1)
  return `${hash.slice(0, -1)}${last === '0' ? '1' : '0'}`
}

let seq = 0
watch(
  [sealed, replay],
  () => {
    const mine = ++seq
    void (async () => {
      const current = sealed.value
      const registrationHash = currentRegistrationHash.value
      if (!current || registrationHash === undefined) {
        runs.value = []
        return
      }
      const anchor: BeaconAnchor = current.draw.anchor
      const fetched = replay.value?.hex ?? anchor.valueHex
      try {
        const tampered: TimeBracket = { ...current.final, registrationHash: otherHash(registrationHash) }
        const jobs: (() => Promise<TimeBracketVerification>)[] = [
          () => verifyTimeBracket(current.final),
          () =>
            verifyTimeBracket(current.final, {
              registrationHash,
              minRound: anchor.round,
              beacon: { valueHex: fetched, round: anchor.round, chain: anchor.chain },
            }),
          () =>
            verifyTimeBracket(current.final, {
              registrationHash,
              minRound: anchor.round,
              beacon: { valueHex: fetched },
              verifySeal: verifySealBytes,
              requireSeal: true,
              ...(current.final.notAfter
                ? { verifyNotAfter: witnessVerifier(current.sealedHash) }
                : { requireNotAfter: true }),
            }),
          () => verifyTimeBracket(current.final, { registrationHash, minRound: anchor.round + 1 }),
          () =>
            verifyTimeBracket(tampered, {
              registrationHash,
              beacon: { valueHex: fetched },
              verifySeal: verifySealBytes,
            }),
        ]
        // Two of these verify a VDF proof. Run them one at a time with a
        // macrotask in between so the page keeps painting.
        const results: TimeBracketVerification[] = []
        for (const job of jobs) {
          results.push(await job())
          await nextMacrotask()
          if (mine !== seq) return
        }
        if (mine !== seq) return
        const meta = [
          {
            label: 'no options at all',
            options: 'verifyTimeBracket(bracket)',
            note: 'structure only. Everything present but unchecked is reported unverified — never verified.',
          },
          {
            label: 'compare the beacon you fetched',
            options: '{ registrationHash, minRound, beacon }',
            note: 'each supplied beacon field is compared one by one against the record.',
          },
          {
            label: 'run the seal and witness hooks',
            options: '{ …, verifySeal: verifySealBytes, requireSeal, verifyNotAfter }',
            note: withWitness.value
              ? 'the VDF proof is checked here in the browser; the witness hook parses the checkpoint reference.'
              : 'requireNotAfter is on and there is no witness, so the bracket is not ok — correctly.',
          },
          {
            label: 'require a later round than the record has',
            options: `{ minRound: ${anchor.round + 1} }`,
            note: 'a registration that named a later round would not accept this anchor.',
          },
          {
            label: 'change the registration hash after sealing',
            options: '{ registrationHash, beacon, verifySeal }',
            note: 'the seal covers the registration hash, so editing it breaks the proof as well as the comparison.',
          },
        ]
        runs.value = meta.map((entry, i) => ({
          ...entry,
          result: results[i] as TimeBracketVerification,
        }))
        runError.value = undefined
      } catch (error) {
        if (mine !== seq) return
        runError.value = error
        runs.value = []
      }
    })()
  },
  { immediate: true },
)

const statusColor = (status: string) =>
  status === 'verified' || status === 'match' || status === 'ok'
    ? 'success'
    : status === 'failed' || status === 'mismatch'
      ? 'error'
      : 'neutral'

const snippet = computed(
  () => `import { timeBracketSealInput, validateTimeBracket, verifyTimeBracket, toHex } from '@mindpeeker/ledger'
import { sealBeacon, sealToBytes, verifySealBytes } from '@mindpeeker/vdf'
import { DRAND_CHAINS, drand } from '@mindpeeker/entropy/providers'

const pulse = await drand().getRound(${sealed.value?.draw.anchor.round ?? 'round'})   // a round published AFTER the plan was frozen
const bracket = validateTimeBracket({
  registrationHash,                       // ${(currentRegistrationHash.value ?? '').slice(0, 16)}…
  notBefore: { beacon: { source: 'drand', chain: DRAND_CHAINS.quicknet.hash, round, timestamp, valueHex } },
})

const input = timeBracketSealInput(bracket)   // canonicalize({ schema: '${TIME_BRACKET_SEAL_SCHEMA}', registrationHash, notBefore })
const sealed = { ...bracket, seal: { kind: 'vdf-pietrzak', bytesHex: toHex(sealToBytes(await sealBeacon(input, ${T.value}), input)) } }

const replay = await drand().getRound(sealed.notBefore.beacon.round)   // fetch it yourself
await verifyTimeBracket(sealed, {
  registrationHash,
  beacon: { valueHex: toHex(replay.bytes) },
  verifySeal: verifySealBytes,
  requireSeal: true,
})`,
)
</script>

<template>
  <DemoSection
    id="time-bracket"
    title="Bracket the record in time"
    description="A time bracket binds a registration hash to a public beacon round (no earlier than its publication), optionally seals it with a VDF (no earlier than T squarings after the input was fixed), and optionally names an outside witness (no later than that witness saw it). verifyTimeBracket does no network I/O at all: you fetch the round, you pass the hooks."
    :api="['validateTimeBracket', 'timeBracketSealInput', 'timeBracketHash', 'verifyTimeBracket', 'TIME_BRACKET_SCHEMA']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Build & seal the bracket"
        icon="i-lucide-hourglass"
        :disabled="!currentRegistrationHash"
        :hint="`T = ${T} squarings — a demo value; a real bracket sizes T with the vdf package's calibrate().suggestT`"
        @run="build"
        @cancel="task.cancel()"
      />
      <UFormField label="Beacon anchor" size="sm" class="w-full sm:w-72">
        <USelect
          v-model="mode"
          :items="[
            { label: 'drand quicknet — the latest round (network)', value: 'drand' },
            { label: 'offline stand-in — proves nothing about time', value: 'standin' },
          ]"
          size="sm"
          class="w-full"
        />
      </UFormField>
      <UFormField label="VDF work" size="sm" class="w-56">
        <USelect v-model="T" :items="T_CHOICES" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Add a no-later-than witness" size="sm">
        <USwitch v-model="withWitness" />
      </UFormField>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
    <ErrorAlert :err="replayTask.error.value" @dismiss="replayTask.reset()" />
    <ErrorAlert :err="runError" title="Verification refused the record" :dismissible="false" />

    <UAlert
      v-if="!currentRegistrationHash"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="The registration above is not valid"
      description="A bracket binds a registration hash, so fix the form first — the Break it on purpose control is probably still set."
    />

    <p v-else-if="!sealed" class="text-sm text-muted">
      Binding
      <code class="text-primary">{{ currentRegistrationHash.slice(0, 24) }}…</code>
      <span v-if="currentRegistrationTitle"> — “{{ currentRegistrationTitle }}”</span>. Press
      <strong class="text-highlighted">Build &amp; seal the bracket</strong>.
    </p>

    <div v-else class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge
          size="sm"
          :color="sealed.draw.public ? 'success' : 'warning'"
          variant="subtle"
          :icon="sealed.draw.public ? 'i-lucide-radio' : 'i-lucide-triangle-alert'"
        >
          {{ sealed.draw.anchor.source }} · round {{ sealed.draw.anchor.round }}
        </UBadge>
        <UBadge size="sm" color="neutral" variant="subtle" class="font-mono">
          {{ sealed.draw.anchor.timestamp }}
        </UBadge>
        <UBadge size="sm" color="neutral" variant="subtle">
          seal {{ fmtBytes(sealed.sealBytes) }} in {{ fmtDuration(sealed.sealMs) }} (T = {{ T }})
        </UBadge>
        <UButton
          v-if="sealed.draw.public"
          size="xs"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="replayTask.busy.value"
          @click="refetch"
        >
          Re-fetch the round as a verifier would
        </UButton>
      </div>

      <p class="text-xs text-muted">{{ sealed.draw.note }}</p>

      <div v-if="replay" class="rounded-md border p-3 text-xs" :class="replay.matches ? 'border-success/40 bg-success/5' : 'border-error/50 bg-error/5'">
        <strong class="text-highlighted">Independent fetch:</strong>
        <span class="font-mono break-all"> {{ replay.hex }}</span>
        — {{ replay.matches ? 'identical to the value in the record' : 'DIFFERENT from the record' }}
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile label="Beacon value in the record" size="sm">
          <template #value>
            <span class="block text-[11px] break-all">{{ sealed.draw.anchor.valueHex }}</span>
          </template>
          <template #note>chain {{ sealed.draw.anchor.chain.slice(0, 20) }}…</template>
        </StatTile>
        <StatTile label="Seal input" size="sm" :value="sealed.sealInputBytes" :digits="0">
          <template #note>
            canonical bytes of {{ TIME_BRACKET_SEAL_SCHEMA }} — the seal cannot cover itself
          </template>
        </StatTile>
        <StatTile label="timeBracketHash(sealed)" size="sm">
          <template #value>
            <span class="block text-[11px] break-all">{{ sealed.sealedHash }}</span>
          </template>
          <template #note>{{ TIME_BRACKET_SCHEMA }} — this is what a witness attests</template>
        </StatTile>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="text-muted uppercase">
            <tr>
              <th class="text-left py-1.5 pr-3 font-medium">what the verifier passes</th>
              <th class="text-left py-1.5 px-3 font-medium">ok</th>
              <th class="text-left py-1.5 px-3 font-medium">registration</th>
              <th class="text-left py-1.5 px-3 font-medium">beacon</th>
              <th class="text-left py-1.5 px-3 font-medium">seal</th>
              <th class="text-left py-1.5 pl-3 font-medium">notAfter</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in runs" :key="run.label" class="border-t border-default align-top">
              <td class="py-2 pr-3 max-w-sm">
                <div class="font-semibold text-highlighted">{{ run.label }}</div>
                <code class="block text-[11px] text-primary break-all">{{ run.options }}</code>
                <div class="text-[11px] text-muted mt-0.5">{{ run.note }}</div>
                <div v-if="run.result.issues.length" class="text-[11px] text-error mt-0.5">
                  {{ run.result.issues.join(' · ') }}
                </div>
              </td>
              <td class="py-2 px-3">
                <UBadge
                  size="sm"
                  :color="run.result.ok ? 'success' : 'error'"
                  variant="subtle"
                  class="font-mono"
                >
                  {{ String(run.result.ok) }}
                </UBadge>
              </td>
              <td class="py-2 px-3">
                <UBadge size="sm" :color="statusColor(run.result.registration)" variant="subtle" class="font-mono">
                  {{ run.result.registration }}
                </UBadge>
              </td>
              <td class="py-2 px-3">
                <UBadge size="sm" :color="statusColor(run.result.beacon)" variant="subtle" class="font-mono">
                  {{ run.result.beacon }}
                </UBadge>
              </td>
              <td class="py-2 px-3">
                <UBadge size="sm" :color="statusColor(run.result.seal)" variant="subtle" class="font-mono">
                  {{ run.result.seal }}
                </UBadge>
              </td>
              <td class="py-2 pl-3">
                <UBadge size="sm" :color="statusColor(run.result.notAfter)" variant="subtle" class="font-mono">
                  {{ run.result.notAfter }}
                </UBadge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <LedgerBounds />

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <template #footer>
      <HonestNote variant="caveat" title="The witness here is self-issued">
        The no-later-than reference in this demo is a checkpoint this page signs over the bracket's
        own hash, so the hook has something real to check. A self-issued witness attests nothing: the
        upper bound comes from a party you do not control — an OpenTimestamps attestation in a
        Bitcoin block, a Rekor entry, a transparency-log checkpoint with witnesses, or a later beacon
        round that committed to the hash. The ledger stores the reference and runs your verifier; it
        has no network code, so the trust in each outside party stays visible.
      </HonestNote>
    </template>
  </DemoSection>
</template>
