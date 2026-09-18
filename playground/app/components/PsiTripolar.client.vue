<script setup lang="ts">
/**
 * Section 1 — the PEAR-style tripolar protocol: build a plan, register it,
 * preview the committed schedule, run it against the header-selected source
 * with an optional yoked DRBG control arm, then analyze it against the
 * registration. The readout lives in `PsiTripolarResult`.
 */
import {
  type Intention,
  PEAR_BITS_PER_TRIAL,
  PEAR_RUN_TRIALS,
  type RegisteredTripolar,
  registerTripolar,
  type RunTripolarOptions,
  runTripolar,
  type TripolarOrder,
  type TripolarPlan,
  type TripolarRun,
  tripolarSchedule,
  verifyTripolarRegistration,
} from '@mindpeeker/psi'
import { abortPromise, createYielder } from '~/lib/async'
import { drbgSource, provider, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { bytesFor, shortHash } from '~/lib/psi/synthetic'

const ORDERS: { label: string; value: TripolarOrder }[] = [
  { label: 'fixed — H…H L…L B…B (maximally confounded)', value: 'fixed' },
  { label: 'interleaved — (H L B) × R (default)', value: 'interleaved' },
  { label: 'counterbalanced — H L B | B L H (ABBA)', value: 'counterbalanced' },
  { label: 'instructed — seeded balanced permutation', value: 'instructed' },
  { label: 'volitional — you declare each run', value: 'volitional' },
]

const runsPerIntention = ref(2)
const trialsPerRun = ref(PEAR_RUN_TRIALS)
const bitsPerTrial = ref(PEAR_BITS_PER_TRIAL)
const order = ref<TripolarOrder>('interleaved')
const seed = ref('c0ffee')
const xorSafeguard = ref(false)
const useControl = ref(true)
const eps0 = ref(0.02)
const priorSd = ref(1e-4)
const edit = ref<'none' | 'drop-last' | 'relabel' | 'truncate'>('none')

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
const registrationOk = ref<boolean>()

watch(
  plan,
  async (next) => {
    try {
      const reg = await registerTripolar(next)
      registration.value = reg
      planError.value = undefined
      registrationOk.value = await verifyTripolarRegistration(reg)
    } catch (err) {
      registration.value = undefined
      registrationOk.value = undefined
      planError.value = err
    }
  },
  { immediate: true },
)

const totalRuns = computed(() => 3 * runsPerIntention.value)
const totalTrials = computed(() => totalRuns.value * trialsPerRun.value)
const armBytes = computed(() => bytesFor(totalTrials.value, bitsPerTrial.value))
const totalBytes = computed(() => armBytes.value * (useControl.value ? 2 : 1))
const source = computed(() => sourceSummary())
const beaconRounds = computed(() => Math.ceil(totalBytes.value / 32))
const hint = computed(() =>
  source.value.network
    ? `${fmtBytes(totalBytes.value)} from ${source.value.label} — about ${beaconRounds.value} beacon rounds, one fetch each. Pick a local source for a plan this size.`
    : `${fmtBytes(totalBytes.value)} from ${source.value.providerName}${useControl.value ? ' (half of it from the control DRBG)' : ''}`,
)

const INTENTION_LIST: readonly Intention[] = ['high', 'low', 'baseline']
const SCHEDULE_TONE: Record<Intention, string> = {
  high: 'text-success border-success/50 bg-success/10',
  low: 'text-error border-error/50 bg-error/10',
  baseline: 'text-muted border-default bg-elevated',
}
const LETTER: Record<Intention, string> = { high: 'H', low: 'L', baseline: 'B' }
/** The committed order, straight from `tripolarSchedule` — it exists before any data. */
const schedule = computed<readonly Intention[] | null>(() => {
  try {
    return tripolarSchedule(plan.value)
  } catch {
    return null // 'volitional' has no precomputed schedule, and invalid plans are reported above
  }
})

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

// ── the run ───────────────────────────────────────────────────────────────
const task = useTask<TripolarRun[]>()
const runsResult = computed<TripolarRun[]>(() => task.result.value ?? [])

function go(): void {
  void task.run(async (signal, setProgress) => {
    const reg = registration.value
    if (!reg) throw planError.value ?? new Error('the plan is not registrable')
    edit.value = 'none'
    restartSource()
    const tick = createYielder(8, signal)
    const control = useControl.value
      ? drbgSource(`${currentSeedLabel()} / tripolar control arm`)
      : undefined
    const declare = (next: { sequence: number; remaining: Readonly<Record<Intention, number>> }) =>
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
    const opts: RunTripolarOptions = {
      signal,
      chunkBytes: Math.ceil(reg.plan.bitsPerTrial / 8),
      ...(control ? { control } : {}),
      ...(reg.plan.order === 'volitional' ? { declare } : {}),
    }
    const expected = 3 * reg.plan.runsPerIntention * (control ? 2 : 1)
    const collected: TripolarRun[] = []
    try {
      for await (const run of runTripolar(provider, reg.plan, opts)) {
        collected.push(run)
        setProgress(collected.length / expected)
        await tick()
      }
    } finally {
      pending.value = null
      settle = null
    }
    return collected
  })
}

function reset(): void {
  task.cancel()
  task.reset()
  edit.value = 'none'
}

const snippet = computed(
  () => `import {
  analyzeTripolar, controlContrast, registerTripolar, runTripolar,
  tostEquivalence, tripolarBayesFactor,
} from '@mindpeeker/psi'

// 1. freeze and publish the plan BEFORE any byte is drawn
const registration = await registerTripolar({
  runsPerIntention: ${runsPerIntention.value},
  trialsPerRun: ${trialsPerRun.value},          // PEAR_RUN_TRIALS
  bitsPerTrial: ${bitsPerTrial.value},          // PEAR_BITS_PER_TRIAL
  order: '${order.value}',${order.value === 'instructed' ? `\n  seed: '${seed.value}',` : ''}
  xorSafeguard: ${xorSafeguard.value},
})
console.log(registration.hash, registration.scheduleDigest)

// 2. collect both arms on the same schedule
const runs = []
for await (const run of runTripolar(source, registration.plan${
    useControl.value ? ', { control }' : ''
  })) runs.push(run)

// 3. analyze each arm against the registration
const exp = analyzeTripolar(runs.filter((r) => r.arm !== 'control'), { registration })${
    useControl.value
      ? `\nconst ctl = analyzeTripolar(runs.filter((r) => r.arm === 'control'), { registration })
const contrast = controlContrast(exp, ctl)
const tost = tostEquivalence(ctl, { eps0: ${eps0.value} })`
      : ''
  }
const bayes = tripolarBayesFactor(exp, { perBitEffectSd: ${priorSd.value} })`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="tripolar-plan"
      title="1 · Plan, register, preview"
      description="The plan is hashed before any data exist. Its schedule digest commits to the exact order of intentions, so a reader can check later that no run was added, dropped or relabelled."
      :api="[
        'registerTripolar',
        'tripolarSchedule',
        'tripolarScheduleDigest',
        'verifyTripolarRegistration',
        'PEAR_RUN_TRIALS',
      ]"
    >
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UFormField label="Runs per intention" help="3 × this many runs in total">
          <UInputNumber v-model="runsPerIntention" :min="1" :max="12" class="w-full" />
        </UFormField>
        <UFormField label="Trials per run" help="PEAR's automatic mode: a block of 50">
          <UInputNumber v-model="trialsPerRun" :min="1" :max="200" class="w-full" />
        </UFormField>
        <UFormField label="Bits per trial" help="200 = the PEAR / GCP convention">
          <UInputNumber v-model="bitsPerTrial" :min="8" :max="1024" :step="8" class="w-full" />
        </UFormField>
        <UFormField label="Order" class="lg:col-span-2">
          <USelect v-model="order" :items="ORDERS" class="w-full" />
        </UFormField>
        <UFormField
          v-if="order === 'instructed'"
          label="Schedule seed"
          help="hex or an integer — part of the registration"
        >
          <UInput v-model="seed" class="w-full" />
        </UFormField>
        <div class="flex flex-col gap-3 justify-end">
          <USwitch
            v-model="xorSafeguard"
            label="XOR safeguard"
            description="record odd trials as k − x (a constant bias cancels)"
          />
          <USwitch
            v-model="useControl"
            label="Yoked control arm"
            description="one seeded-DRBG trial per experimental trial"
          />
        </div>
      </div>

      <ErrorAlert :err="planError" :dismissible="false" title="This plan cannot be registered" />

      <div v-if="registration" class="mt-4 flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="registration hash"
            :value="shortHash(registration.hash)"
            size="sm"
            tone="primary"
            note="publish this before collecting"
          />
          <StatTile
            label="schedule digest"
            :value="shortHash(registration.scheduleDigest)"
            size="sm"
            note="sha256 of plan + schedule"
          />
          <StatTile
            label="recomputes"
            :value="registrationOk === undefined ? '—' : registrationOk ? 'verified' : 'MISMATCH'"
            size="sm"
            :tone="registrationOk ? 'success' : 'error'"
            note="verifyTripolarRegistration"
          />
          <StatTile
            label="budget"
            :value="`${totalTrials} trials · ${fmtBytes(totalBytes)}`"
            size="sm"
            mono
            :note="`${totalRuns} runs${useControl ? ' per arm' : ''}`"
          />
        </div>

        <div>
          <h3 class="text-sm font-medium text-highlighted">Committed schedule</h3>
          <div v-if="schedule" class="mt-2 flex flex-wrap gap-1">
            <span
              v-for="(intention, i) in schedule.slice(0, 72)"
              :key="i"
              class="inline-flex size-6 items-center justify-center rounded border font-mono text-[11px]"
              :class="SCHEDULE_TONE[intention]"
              :title="`run ${i}: ${intention}`"
            >{{ LETTER[intention] }}</span>
            <span v-if="schedule.length > 72" class="text-xs text-muted self-center">
              +{{ schedule.length - 72 }} more
            </span>
          </div>
          <p v-else class="mt-2 text-sm text-muted">
            Volitional mode has no precomputed schedule — you declare each run as it starts, and the
            digest commits to <code class="font-mono">schedule: null</code> instead.
          </p>
        </div>
      </div>

      <template #footer>
        PEAR's benchmark trials were 200 binary samples; automatic mode collected "a block of fifty
        trials" per run, operators worked in volitional or instructed mode, and baseline runs were
        "interspersed in some reasonable fashion". Interleaved cycling is an SDK convenience, not
        the PEAR protocol.
      </template>
    </DemoSection>

    <DemoSection
      id="tripolar-run"
      title="2 · Run the protocol"
      description="Runs stream from the header-selected source; the control arm consumes one seeded-DRBG trial per experimental trial on the same schedule."
      :api="['runTripolar', 'TripolarRun', 'drbgProvider']"
    >
      <template #controls>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          :disabled="!registration"
          :label="`Run ${totalRuns} runs`"
          busy-label="Collecting…"
          :hint="hint"
          @run="go"
          @cancel="task.cancel()"
        >
          <UButton
            variant="soft"
            color="neutral"
            icon="i-lucide-refresh-cw"
            :disabled="task.busy.value"
            @click="reset"
          >
            Reset
          </UButton>
        </RunControls>
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <UAlert
        v-if="pending"
        color="primary"
        variant="subtle"
        icon="i-lucide-hand"
        :title="`Declare the intention for run ${pending.sequence + 1} of ${totalRuns}`"
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
          <p class="mt-2 text-xs">
            PEAR's volitional mode: the operator chooses the direction. Balance is enforced — an
            intention with no runs left cannot be declared.
          </p>
        </template>
      </UAlert>

      <div v-if="runsResult.length" class="flex flex-col gap-3">
        <AccountingBadge
          :bytes-consumed="armBytes * (useControl ? 2 : 1)"
          :bits-used="totalTrials * bitsPerTrial * (useControl ? 2 : 1)"
          :source="source.providerName"
        />
        <p class="text-sm text-muted">
          {{ runsResult.length }} runs collected
          <template v-if="useControl">(experimental + control)</template>
          · {{ fmtNum(runsResult[0]?.series.sums.length ?? 0, { digits: 0 }) }} trials each ·
          assignment <code class="font-mono">{{ runsResult[0]?.assignment }}</code>
        </p>
      </div>
      <p v-else-if="!task.busy.value" class="text-sm text-muted">
        Nothing has been collected yet. On a fair source the expected result is nothing: Δz inside
        ±2 and a Bayes factor near 1.
      </p>

      <template #footer>
        Aborting is prompt — Cancel closes both streams and raises
        <code class="font-mono">PsiError('aborted')</code>, which is caught, not thrown into the
        console.
      </template>
    </DemoSection>

    <PsiTripolarResult
      v-if="runsResult.length && registration"
      v-model:edit="edit"
      v-model:eps0="eps0"
      v-model:prior-sd="priorSd"
      :runs="runsResult"
      :registration="registration"
    />

    <DemoSection title="The code behind this section" :api="['@mindpeeker/psi']">
      <CodeSnippet :code="snippet" title="what the buttons above run" />
      <template #footer>
        Effect sizes in the PEAR corpus are of order 10⁻⁴ per bit. A plan of
        {{ fmtNum(totalTrials * bitsPerTrial, { digits: 0 }) }} bits per arm cannot resolve that
        scale in either direction — which is why the Bayes factor below sits near 1 rather than
        supporting anything.
      </template>
    </DemoSection>
  </div>
</template>
