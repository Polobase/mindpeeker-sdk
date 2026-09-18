<script setup lang="ts">
/**
 * §5a — Blum commit–reveal as a two-party coin flip: commit, reveal, combine.
 * The two ways it goes wrong (an equivocating party, an aborting last
 * revealer) are run here, not described.
 */
import { COMBINE_DOMAIN, COMMIT_DOMAIN, fromHex, MIN_NONCE_BYTES, toHex } from '@mindpeeker/ledger'
import { sourceSummary } from '~/lib/entropy'
import { drawDrandAnchor, futureRound } from '~/lib/ledger/bracket'
import { drawShare, forgeShare, type RoundOutcome, reveal, type Share } from '~/lib/ledger/coin'

type BeaconMode = 'none' | 'past' | 'future'

const beaconMode = ref<BeaconMode>('none')
const cheat = ref(false)
const abort = ref(false)

interface Committed {
  readonly alice: Share
  readonly bob: Share
  readonly beaconHex?: string
  readonly beaconNote?: string
  readonly future?: { round: number; publishesAt: string }
}

const commitTask = useTask<Committed>()
const committed = computed(() => commitTask.result.value)
const outcome = shallowRef<RoundOutcome>()
const revealError = ref<unknown>()

function commitBoth(): void {
  outcome.value = undefined
  void commitTask.run(async (signal, setProgress) => {
    setProgress(0.2)
    const alice = await drawShare('selected', signal)
    setProgress(0.5)
    const bob = await drawShare('local', signal)
    setProgress(0.7)
    if (beaconMode.value === 'past') {
      const draw = await drawDrandAnchor(signal)
      setProgress(1)
      return {
        alice,
        bob,
        beaconHex: draw.anchor.valueHex,
        beaconNote: `drand round ${draw.anchor.round}, published ${draw.anchor.timestamp} — already public when the parties reveal`,
      }
    }
    if (beaconMode.value === 'future') {
      const future = futureRound(90)
      setProgress(1)
      return {
        alice,
        bob,
        future,
        beaconNote: `drand round ${future.round}, due ${future.publishesAt} — fixed now, published only after the reveal deadline`,
      }
    }
    setProgress(1)
    return { alice, bob }
  })
}

async function revealBoth(): Promise<void> {
  const current = committed.value
  if (!current) return
  try {
    const bob = cheat.value
      ? forgeShare(current.bob, current.alice.value, 'heads')
      : current.bob
    outcome.value = await reveal([current.alice, bob], {
      ...(current.beaconHex !== undefined ? { beacon: fromHex(current.beaconHex) } : {}),
      ...(abort.value ? { missing: [1] } : {}),
    })
    revealError.value = undefined
  } catch (error) {
    revealError.value = error
  }
}

watch([cheat, abort], () => {
  if (outcome.value) void revealBoth()
})

const parties = computed(() => {
  const current = committed.value
  if (!current) return []
  const bob = cheat.value ? forgeShare(current.bob, current.alice.value, 'heads') : current.bob
  return [
    {
      name: 'Party A',
      note: sourceSummary().providerName,
      commitment: toHex(current.alice.commitment),
      value: toHex(current.alice.value),
      nonce: toHex(current.alice.nonce),
      opened: outcome.value?.opened[0],
      swapped: false,
    },
    {
      name: 'Party B',
      note: 'browser CSPRNG',
      commitment: toHex(bob.commitment),
      value: abort.value ? '— never opened —' : toHex(bob.value),
      nonce: abort.value ? '—' : toHex(bob.nonce),
      opened: outcome.value?.opened[1],
      swapped: cheat.value,
    },
  ]
})

const snippet = computed(
  () => `import { commit, openCommitment, combineReveals } from '@mindpeeker/ledger'

const nonce = crypto.getRandomValues(new Uint8Array(32))   // ≥ ${MIN_NONCE_BYTES} bytes is enforced
const c = await commit(value, nonce)
// SHA-256("${COMMIT_DOMAIN}" ‖ u64be(|v|) ‖ v ‖ u64be(|r|) ‖ r)

// …after the deadline, everyone opens…
await openCommitment(c, value, nonce)          // ${String(outcome.value?.opened[0] ?? true)} / ${String(
    outcome.value?.opened[1] ?? true,
  )}
const seed = await combineReveals([a, b]${beaconMode.value === 'past' ? ', beaconValue' : ''})
${
  beaconMode.value === 'past'
    ? `// SHA-256("${COMBINE_DOMAIN}" ‖ u64be(|⊕vᵢ|) ‖ ⊕vᵢ ‖ u64be(|b|) ‖ b)`
    : '// the plain XOR: one honest uniform share makes it uniform'
}
// coin = seed[0] & 1 → ${outcome.value?.face ?? '…'}`,
)
</script>

<template>
  <DemoSection
    id="commit-reveal"
    title="A coin two strangers can agree on"
    description="Each party commits to a 32-byte value with a 32-byte nonce before the deadline, then everybody opens. The XOR of the reveals is uniform as long as one party drew uniformly and independently — and the commitments are what guarantee nobody could look first."
    :api="['commit', 'openCommitment', 'combineReveals', 'COMMIT_DOMAIN', 'COMBINE_DOMAIN', 'MIN_NONCE_BYTES']"
  >
    <template #controls>
      <RunControls
        :busy="commitTask.busy.value"
        :progress="commitTask.progress.value"
        label="Both parties commit"
        icon="i-lucide-lock"
        hint="A draws from the selected source, B from the browser CSPRNG"
        @run="commitBoth"
        @cancel="commitTask.cancel()"
      >
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-eye"
          :disabled="!committed || commitTask.busy.value"
          @click="revealBoth"
        >
          Reveal
        </UButton>
      </RunControls>
      <UFormField
        label="Bind a beacon round (applies at commit time)"
        size="sm"
        class="w-full sm:w-72"
      >
        <USelect
          v-model="beaconMode"
          :items="[
            { label: 'none — the plain XOR', value: 'none' },
            { label: 'a drand round already published (fetched)', value: 'past' },
            { label: 'a FUTURE drand round, fixed now', value: 'future' },
          ]"
          size="sm"
          class="w-full"
        />
      </UFormField>
      <UFormField label="B swaps its value after seeing A" size="sm">
        <USwitch v-model="cheat" />
      </UFormField>
      <UFormField label="B never opens (last-revealer abort)" size="sm">
        <USwitch v-model="abort" />
      </UFormField>
    </template>

    <ErrorAlert :err="commitTask.error.value" @dismiss="commitTask.reset()" />
    <ErrorAlert :err="revealError" title="The reveal step refused the input" :dismissible="false" />

    <p v-if="!committed" class="text-sm text-muted">
      Press <strong class="text-highlighted">Both parties commit</strong>, then
      <strong class="text-highlighted">Reveal</strong>. Flip either switch afterwards to see what the
      protocol does about it.
    </p>

    <div v-else class="flex flex-col gap-4">
      <p v-if="committed.beaconNote" class="text-sm text-muted">
        <UIcon name="i-lucide-radio" class="size-3.5 inline-block align-middle" />
        {{ committed.beaconNote }}
      </p>

      <div class="grid gap-3 sm:grid-cols-2">
        <div
          v-for="party in parties"
          :key="party.name"
          class="rounded-md border p-3 flex flex-col gap-1.5"
          :class="
            party.opened === false ? 'border-error/50 bg-error/5' : 'border-default bg-elevated/40'
          "
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">{{ party.name }}</h3>
            <UBadge
              v-if="party.opened !== undefined"
              size="sm"
              :color="party.opened ? 'success' : 'error'"
              variant="subtle"
            >
              openCommitment → {{ String(party.opened) }}
            </UBadge>
          </div>
          <p class="text-[11px] text-dimmed">{{ party.note }}</p>
          <dl class="text-[11px] font-mono flex flex-col gap-1">
            <div>
              <dt class="text-muted">commitment (published first)</dt>
              <dd class="break-all text-highlighted">{{ party.commitment }}</dd>
            </div>
            <div>
              <dt class="text-muted">value revealed</dt>
              <dd class="break-all" :class="party.swapped ? 'text-error' : 'text-highlighted'">
                {{ party.value }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">nonce</dt>
              <dd class="break-all text-dimmed">{{ party.nonce }}</dd>
            </div>
          </dl>
          <p v-if="party.swapped" class="text-[11px] text-error">
            B recomputed its value as a ⊕ target after seeing A's reveal. The commitment it published
            before the deadline is unchanged — which is exactly what gives it away.
          </p>
        </div>
      </div>

      <div
        v-if="outcome"
        class="rounded-md border p-3 flex flex-col gap-2"
        :class="outcome.failure ? 'border-error/50 bg-error/5' : 'border-success/40 bg-success/5'"
      >
        <div v-if="outcome.failure" class="flex items-start gap-2">
          <UIcon name="i-lucide-circle-x" class="size-4 text-error mt-0.5 shrink-0" />
          <div>
            <div class="text-sm font-semibold text-highlighted">No seed. The round is void.</div>
            <p class="text-xs text-muted">{{ outcome.failure }}</p>
          </div>
        </div>
        <div v-else class="flex flex-wrap items-center gap-3">
          <UBadge size="lg" color="success" variant="subtle" class="font-mono uppercase">
            {{ outcome.face }}
          </UBadge>
          <div class="min-w-0">
            <div class="text-[11px] uppercase tracking-wide text-muted">combined seed</div>
            <div class="font-mono text-[11px] break-all text-highlighted">{{ outcome.seedHex }}</div>
          </div>
        </div>
      </div>

      <div
        v-if="beaconMode === 'future' && committed.future"
        class="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs text-muted"
      >
        <strong class="text-highlighted">Why a future round helps.</strong>
        Round {{ committed.future.round }} is fixed in the registration now and published at
        {{ committed.future.publishesAt }}, after the reveal deadline. At the moment B decides
        whether to open, the beacon term is unknown, so B cannot tell which outcome its silence
        would buy — and aborting gains nothing. This demo does not wait for the round; it shows the
        commitment, which is the part that has to happen up front (NIST IR 8213 §7.2).
      </div>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <template #footer>
      <HonestNote variant="caveat" title="Commit–reveal is not fair against the last revealer">
        Binding rests on SHA-256 collision resistance; hiding rests on the nonce being secret and
        unpredictable — both exact. What no amount of XOR fixes is a party that opens last, sees the
        outcome, and refuses: each abort buys up to one bit. Record every missing reveal as a
        protocol failure and never retry silently. To remove the advantage, fix a future beacon round
        in the registration, or seal the reveals with a VDF.
      </HonestNote>
    </template>
  </DemoSection>
</template>
