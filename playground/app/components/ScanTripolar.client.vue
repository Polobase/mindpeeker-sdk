<script setup lang="ts">
/**
 * Tab 6 — the rigorous version: a pre-registered PEAR tripolar protocol with a
 * yoked control arm, followed by catalog scoring in the protocol's own
 * intention sequence. If you actually want to test Reading B, this is the
 * honest way to do it.
 */
import {
  type Intention,
  PEAR_BITS_PER_TRIAL,
  type RegisteredTripolar,
  registerTripolar,
  type TripolarOrder,
  type TripolarPlan,
} from '@mindpeeker/psi'
import type { TripolarScanReport } from '@mindpeeker/scan'
import { scanTripolar } from '@mindpeeker/scan'
import { abortPromise } from '~/lib/async'
import { drbgSource, provider, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { buildCatalog, catalogLines, DEFAULT_CATALOG_TEXT } from '~/lib/scan/catalog'
import { BEACON_ROUND_BYTES, shortHash } from '~/lib/scan/stats'

const ORDERS: { label: string; value: TripolarOrder }[] = [
  { label: 'interleaved — (H L B) × R (default)', value: 'interleaved' },
  { label: 'fixed — H…H L…L B…B (maximally confounded)', value: 'fixed' },
  { label: 'counterbalanced — H L B | B L H (ABBA)', value: 'counterbalanced' },
  { label: 'instructed — seeded balanced permutation', value: 'instructed' },
  { label: 'volitional — you declare each run', value: 'volitional' },
]
const LETTER: Record<Intention, string> = { high: 'H', low: 'L', baseline: 'B' }
const TONE: Record<Intention, string> = {
  high: 'text-success border-success/50 bg-success/10',
  low: 'text-error border-error/50 bg-error/10',
  baseline: 'text-muted border-default bg-elevated',
}
const INTENTION_LIST: readonly Intention[] = ['high', 'low', 'baseline']

const runsPerIntention = ref(2)
const trialsPerRun = ref(15)
const bitsPerTrial = ref(PEAR_BITS_PER_TRIAL)
const order = ref<TripolarOrder>('interleaved')
const seed = ref('c0ffee')
const xorSafeguard = ref(false)
const useControl = ref(true)
const rounds = ref(64)
const alpha = ref(0.05)

const catalog = computed(() =>
  buildCatalog('tripolar', 'Tripolar catalog', catalogLines(DEFAULT_CATALOG_TEXT).slice(0, 8)),
)

const plan = computed<TripolarPlan>(() => ({
  runsPerIntention: runsPerIntention.value,
  trialsPerRun: trialsPerRun.value,
  bitsPerTrial: bitsPerTrial.value,
  order: order.value,
  ...(order.value === 'instructed' ? { seed: seed.value } : {}),
  xorSafeguard: xorSafeguard.value,
}))

const registration = shallowRef<RegisteredTripolar>()
const planError = ref<unknown>()
watch(
  plan,
  async (next) => {
    try {
      registration.value = await registerTripolar(next)
      planError.value = undefined
    } catch (error) {
      registration.value = undefined
      planError.value = error
    }
  },
  { immediate: true },
)

const protocolBits = computed(
  () => 3 * runsPerIntention.value * trialsPerRun.value * bitsPerTrial.value,
)
const scoringBits = computed(() => 3 * rounds.value * catalog.value.items.length)
const experimentalBytes = computed(() => Math.ceil((protocolBits.value + scoringBits.value) / 8))
const source = computed(() => sourceSummary())
const hint = computed(() =>
  source.value.network
    ? `${fmtBytes(experimentalBytes.value)} from ${source.value.label} — about ${Math.ceil(experimentalBytes.value / BEACON_ROUND_BYTES)} beacon rounds${useControl.value ? ', plus the control DRBG' : ''}.`
    : `${fmtBytes(experimentalBytes.value)} from ${source.value.providerName}${useControl.value ? ' plus as much again from the control DRBG' : ''}`,
)
const heavy = computed(() => protocolBits.value * (useControl.value ? 2 : 1) > 200_000)

// ── volitional declaration ────────────────────────────────────────────────
interface Pending {
  sequence: number
  remaining: Readonly<Record<Intention, number>>
}
const pending = ref<Pending | null>(null)
let settle: ((intention: Intention) => void) | null = null
function declareIntention(intention: Intention): void {
  settle?.(intention)
}

const task = useTask<TripolarScanReport>()
const report = computed(() => task.result.value)

function go(): void {
  void task.run(async (signal, setProgress) => {
    const reg = registration.value
    if (!reg) throw planError.value ?? new Error('the plan is not registrable')
    setProgress(null)
    restartSource()
    const control = useControl.value
      ? drbgSource(`${currentSeedLabel()} / tripolar scan control`)
      : undefined
    const declare = (next: Pending) =>
      new Promise<Intention>((resolve, reject) => {
        pending.value = { sequence: next.sequence, remaining: next.remaining }
        settle = (intention) => {
          pending.value = null
          settle = null
          resolve(intention)
        }
        abortPromise(signal).catch((err) => {
          pending.value = null
          settle = null
          reject(err)
        })
      })
    try {
      return await scanTripolar(catalog.value, provider, reg.plan, {
        rounds: rounds.value,
        alpha: alpha.value,
        registration: reg,
        ...(control ? { control } : {}),
        ...(order.value === 'volitional' ? { declare } : {}),
        signal,
      })
    } finally {
      pending.value = null
      settle = null
    }
  })
}

const snippet = computed(
  () => `import { registerTripolar } from '@mindpeeker/psi'
import { defineCatalog, scanTripolar } from '@mindpeeker/scan'

const plan = {
  runsPerIntention: ${runsPerIntention.value},
  trialsPerRun: ${trialsPerRun.value},
  bitsPerTrial: ${bitsPerTrial.value},
  order: '${order.value}',${order.value === 'instructed' ? `\n  seed: '${seed.value}',` : ''}
  xorSafeguard: ${xorSafeguard.value},
} as const

// publish registration.hash BEFORE any byte is drawn
const registration = await registerTripolar(plan)

const tri = await scanTripolar(catalog, source, plan, {
  rounds: ${rounds.value},          // deviation rounds per intention
  alpha: ${alpha.value},
  registration,${useControl.value ? '\n  control,           // a yoked seeded DRBG on the same schedule' : ''}
})

tri.deltaZ                  // high − low, ~N(0,1) under H0
tri.analysis.deltaP         // one-sided p in the pre-stated direction
tri.control?.contrast.z     // does the operator's source separate more than the control?
tri.perIntention.high       // the catalog, scored under 'high'
tri.phaseAccounting         // protocol bytes vs scoring bytes, one stream`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="scan-tripolar"
      title="1 · Pre-register, then collect"
      description="Intentions, schedule, bit budget and p₀ are fixed before the data exist. One stream serves both phases in order, so a replayable source never hands phase 2 the bytes phase 1 already used."
      :api="['registerTripolar', 'scanTripolar', 'TripolarScanOptions', 'TripolarPlan']"
    >
      <template #controls>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          :disabled="!registration"
          :label="`Run ${3 * runsPerIntention} runs + scoring`"
          busy-label="Collecting…"
          :hint="hint"
          @run="go"
          @cancel="task.cancel()"
        />
      </template>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UFormField label="runsPerIntention" help="3 × this many runs in total">
          <UInputNumber v-model="runsPerIntention" :min="1" :max="8" class="w-full" />
        </UFormField>
        <UFormField label="trialsPerRun" help="PEAR's automatic mode: 50">
          <UInputNumber v-model="trialsPerRun" :min="1" :max="60" class="w-full" />
        </UFormField>
        <UFormField label="bitsPerTrial" help="200 = the PEAR / GCP convention">
          <UInputNumber v-model="bitsPerTrial" :min="8" :max="400" :step="8" class="w-full" />
        </UFormField>
        <UFormField label="rounds" help="catalog deviation rounds per intention">
          <UInputNumber v-model="rounds" :min="1" :max="512" :step="16" class="w-full" />
        </UFormField>
        <UFormField label="Order" class="sm:col-span-2">
          <USelect v-model="order" :items="ORDERS" class="w-full" />
        </UFormField>
        <UFormField v-if="order === 'instructed'" label="Schedule seed" help="part of the registration">
          <UInput v-model="seed" class="w-full font-mono" />
        </UFormField>
        <UFormField label="alpha" help="family level over all 3M item tests">
          <UInputNumber v-model="alpha" :min="0.001" :max="0.5" :step="0.01" class="w-full" />
        </UFormField>
        <div class="flex flex-col gap-2 justify-end sm:col-span-2">
          <USwitch
            v-model="xorSafeguard"
            label="XOR safeguard"
            description="odd trials recorded as k − x, so a constant bias cancels"
          />
          <USwitch
            v-model="useControl"
            label="Yoked control arm"
            description="a seeded DRBG on the same schedule; controlContrast compares the two"
          />
        </div>
      </div>

      <ErrorAlert :err="planError" :dismissible="false" title="This plan cannot be registered" />
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <UAlert
        v-if="heavy"
        color="warning"
        variant="subtle"
        icon="i-lucide-hourglass"
        title="That is a large bit budget"
        :description="`${fmtNum(protocolBits * (useControl ? 2 : 1), { digits: 0 })} protocol bits run inside one scanTripolar() call, which cannot be chunked; the page will not repaint while it does. Keep it under ~200 000.`"
      />

      <div v-if="registration" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="registration hash"
          :value="shortHash(registration.hash, 12)"
          size="sm"
          tone="primary"
          note="publish this before collecting"
        />
        <StatTile
          label="schedule digest"
          :value="shortHash(registration.scheduleDigest, 12)"
          size="sm"
          note="commits to the exact intention order"
        />
        <StatTile
          label="protocol bits"
          :value="protocolBits"
          :digits="0"
          size="sm"
          :note="`${3 * runsPerIntention} runs × ${trialsPerRun} trials × ${bitsPerTrial} bits`"
        />
        <StatTile
          label="scoring bits"
          :value="scoringBits"
          :digits="0"
          size="sm"
          :note="`3 × ${rounds} rounds × ${catalog.items.length} items`"
        />
      </div>

      <div v-if="registration?.schedule" class="mt-1">
        <h3 class="text-sm font-medium text-highlighted">Committed schedule</h3>
        <div class="mt-2 flex flex-wrap gap-1">
          <span
            v-for="(intention, i) in registration.schedule"
            :key="i"
            class="inline-flex size-6 items-center justify-center rounded border font-mono text-[11px]"
            :class="TONE[intention]"
            :title="`run ${i}: ${intention}`"
          >{{ LETTER[intention] }}</span>
        </div>
      </div>
      <p v-else-if="registration" class="text-sm text-muted">
        Volitional mode has no precomputed schedule — you declare each run as it starts, and the
        digest commits to <code class="font-mono">schedule: null</code> instead.
      </p>

      <UAlert
        v-if="pending"
        color="primary"
        variant="subtle"
        icon="i-lucide-hand"
        :title="`Declare the intention for run ${pending.sequence + 1} of ${3 * runsPerIntention}`"
      >
        <template #description>
          <div class="flex flex-wrap gap-2 mt-2">
            <UButton
              v-for="intention in INTENTION_LIST"
              :key="intention"
              size="sm"
              :variant="pending.remaining[intention] > 0 ? 'solid' : 'outline'"
              :disabled="pending.remaining[intention] <= 0"
              @click="declareIntention(intention)"
            >
              {{ intention }} ({{ pending.remaining[intention] }} left)
            </UButton>
          </div>
        </template>
      </UAlert>

      <HonestNote variant="contested">
        What pre-registration buys is detectability, not truth: a non-zero Δz is a fact about your
        bytes, not proof of a mechanism, and a separation the control arm reproduces indicts the
        pipeline rather than the operator. The effect sizes in the PEAR corpus are of order 10⁻⁴ per
        bit; a plan of {{ fmtNum(protocolBits, { digits: 0 }) }} bits cannot resolve that scale in
        either direction.
      </HonestNote>

      <template #footer>
        The catalog scored here is the demo list, eight items deep. Scoring follows the protocol's
        <em>own</em> intention sequence — not one fixed high → low → baseline block — so drift is
        balanced as far as the chosen order balances it.
      </template>
    </DemoSection>

    <ScanTripolarResult v-if="report" :report="report" :alpha="alpha" />

    <DemoSection title="The code behind this tab" :api="['@mindpeeker/scan', '@mindpeeker/psi']">
      <CodeSnippet :code="snippet" title="what the Run button runs" />
      <template #footer>
        Both streams are closed when the scan ends, fails or is aborted; a rejected plan or a
        registration mismatch surfaces as
        <code class="font-mono">ScanError('invalid_options')</code>, never as a silent re-analysis.
      </template>
    </DemoSection>
  </div>
</template>
