<script setup lang="ts">
/**
 * §4 — the pre-registration layer: a config form, the canonical RFC 8785
 * envelope it hashes to, and an analysis of freshly drawn bytes under exactly
 * that registration.
 */
import {
  analyzeBytes,
  analyzeTrials,
  bonferroni,
  type EventStatistic,
  EXPERIMENT_SCHEMA,
  type ExperimentConfig,
  type ExperimentResult,
  registerExperiment,
  type RegisteredExperiment,
} from '@mindpeeker/negentropy'
import { getBytes, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'

const STATISTICS: { label: string; value: EventStatistic }[] = (
  ['netvar', 'devvar', 'correlation', 'covar'] as const
).map((s) => ({ label: s, value: s }))
const WIDTHS = [200, 64, 32].map((n) => ({ label: `${n} bits`, value: n }))
const MISSING = [
  { label: "'error' — fail closed", value: 'error' },
  { label: "'skip' — combine over whoever answered", value: 'skip' },
]
const CALIBRATIONS = [
  { label: "'theoretical' — Binomial(k, ½)", value: 'theoretical' },
  { label: '{ trials: n } — burn-in window', value: 'trials' },
]
/** A published drand pulse, committed as a no-earlier-than bound. */
const ANCHOR = {
  source: 'drand',
  chainId: '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce',
  round: 5000000,
  timestamp: '2025-01-01T00:00:00Z',
  valueHex: 'ab12cd34ef567890ab12cd34ef567890ab12cd34ef567890ab12cd34ef567890',
}

interface EventRow {
  id: string
  label: string
  statistic: EventStatistic
  start: number
  end: number
}

const sources = ref(3)
const bitsPerTrial = ref(200)
const analysisSteps = ref(240)
const calibrationMode = ref('theoretical')
const calibrationTrials = ref(500)
const missing = ref('error')
const intervalClock = ref(false)
const withAnchor = ref(false)
const events = ref<EventRow[]>([
  { id: 'window-a', label: 'first 120 steps', statistic: 'netvar', start: 0, end: 120 },
  { id: 'window-b', label: 'overlapping device variance', statistic: 'devvar', start: 60, end: 200 },
  { id: 'covar-all', label: 'variances co-moving, whole run', statistic: 'covar', start: 0, end: 240 },
  { id: 'beyond-data', label: 'window past the recording', statistic: 'netvar', start: 240, end: 400 },
])

const recordedPerSource = computed(
  () => analysisSteps.value + (calibrationMode.value === 'trials' ? calibrationTrials.value : 0),
)
const costBytes = computed(() => sources.value * recordedPerSource.value * (bitsPerTrial.value / 8))

function buildConfig(): ExperimentConfig {
  return {
    trial: {
      bitsPerTrial: bitsPerTrial.value,
      clock: intervalClock.value ? { mode: 'interval', intervalMs: 1000 } : { mode: 'count' },
    },
    calibration:
      calibrationMode.value === 'trials' ? { trials: calibrationTrials.value } : 'theoretical',
    missing: missing.value === 'skip' ? 'skip' : 'error',
    events: events.value.map((event) => ({
      id: event.id,
      ...(event.label ? { label: event.label } : {}),
      statistic: event.statistic,
      start: event.start,
      end: event.end,
    })),
    ...(withAnchor.value ? { anchors: { beacons: [ANCHOR] } } : {}),
  }
}

const registration = shallowRef<RegisteredExperiment>()
const registrationError = ref<unknown>()
const history = ref<{ hash: string; at: string }[]>([])

async function register(): Promise<void> {
  const config = buildConfig()
  try {
    const result = await registerExperiment(config)
    registrationError.value = undefined
    if (registration.value?.hash === result.hash) return
    registration.value = result
    history.value = [
      { hash: result.hash, at: new Date().toLocaleTimeString() },
      ...history.value,
    ].slice(0, 5)
  } catch (error) {
    registrationError.value = error
    registration.value = undefined
  }
}

watch(
  () => JSON.stringify(buildConfig()),
  () => {
    void register()
  },
  { immediate: true },
)

function addEvent(): void {
  const n = events.value.length + 1
  events.value = [
    ...events.value,
    {
      id: `event-${n}`,
      label: '',
      statistic: 'netvar',
      start: 0,
      end: Math.max(1, analysisSteps.value),
    },
  ]
}

function removeEvent(index: number): void {
  events.value = events.value.filter((_, i) => i !== index)
}

interface Analysis {
  result: ExperimentResult
  reproduced: boolean
  bonferroniAlpha: number
  bytes: number
}

const analysis = useTask<Analysis>()
const report = computed(() => analysis.result.value)

function runAnalysis(): void {
  void analysis.run(async (signal, setProgress) => {
    const current = registration.value
    if (!current) throw new Error('register a valid configuration first')
    const perSource = recordedPerSource.value
    const perTrial = bitsPerTrial.value / 8
    setProgress(0.1)
    const bytes = await getBytes(sources.value * perSource * perTrial, { signal })
    const recordings = Array.from({ length: sources.value }, (_, i) => ({
      source: `egg-${i + 1}`,
      bytes: bytes.subarray(i * perSource * perTrial, (i + 1) * perSource * perTrial),
    }))
    setProgress(0.6)
    const result = analyzeBytes(recordings, current)
    // The documented exact-reproduction call: no second burn-in, same numbers.
    const again = analyzeTrials(result.series, {
      registration: current,
      calibration: result.calibration,
    })
    const reproduced =
      Object.is(again.composite.z, result.composite.z) &&
      again.events.every((event, i) => Object.is(event.value, result.events[i]?.value))
    setProgress(1)
    return {
      result,
      reproduced,
      bonferroniAlpha: bonferroni(0.05, Math.max(1, result.events.length)),
      bytes: bytes.length,
    }
  })
}

const canonicalPretty = computed(() => {
  const current = registration.value
  if (!current) return ''
  return JSON.stringify(JSON.parse(current.canonical), null, 2)
})

const statisticKind = (statistic: EventStatistic): 'exact' | 'pointwise' =>
  statistic === 'netvar' || statistic === 'devvar' ? 'exact' : 'pointwise'

const snippet = computed(
  () => `import { analyzeBytes, analyzeTrials, registerExperiment } from '@mindpeeker/negentropy'

const registration = await registerExperiment(${JSON.stringify(
    {
      trial: { bitsPerTrial: bitsPerTrial.value, clock: { mode: intervalClock.value ? 'interval' : 'count' } },
      calibration: calibrationMode.value === 'trials' ? { trials: calibrationTrials.value } : 'theoretical',
      missing: missing.value,
      events: events.value.slice(0, 2),
    },
    null,
    2,
  )})
registration.hash        // ${registration.value?.hash.slice(0, 32) ?? '…'}…
registration.canonical   // the exact bytes hashed (RFC 8785)

const result = analyzeBytes(recordings, registration)   // hash embedded in the result
const again = analyzeTrials(result.series, { registration, calibration: result.calibration })
// again.composite.z === result.composite.z — re-analysis without a second burn-in`,
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      id="registration"
      title="Register the hypothesis before the data"
      description="registerExperiment validates the config strictly, fills in every default, serializes the versioned envelope as RFC 8785 canonical JSON and hashes it. Change any field below — the hash changes with it, and the old hash still describes exactly the old config."
      :api="['registerExperiment', 'canonicalJson', 'EXPERIMENT_SCHEMA']"
    >
      <template #controls>
        <UFormField label="Sources" size="sm" class="w-28">
          <UInputNumber v-model="sources" :min="2" :max="6" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Analysis steps" size="sm" class="w-36">
          <UInputNumber v-model="analysisSteps" :min="10" :max="2000" :step="20" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Bits per trial" size="sm" class="w-32">
          <USelect v-model="bitsPerTrial" :items="WIDTHS" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Calibration" size="sm" class="w-56">
          <USelect v-model="calibrationMode" :items="CALIBRATIONS" size="sm" class="w-full" />
        </UFormField>
        <UFormField v-if="calibrationMode === 'trials'" label="Burn-in trials" size="sm" class="w-36">
          <UInputNumber v-model="calibrationTrials" :min="2" :max="2000" :step="50" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Missing policy" size="sm" class="w-64">
          <USelect v-model="missing" :items="MISSING" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Interval clock (1 s)" size="sm">
          <USwitch v-model="intervalClock" />
        </UFormField>
        <UFormField label="Commit a drand pulse" size="sm">
          <USwitch v-model="withAnchor" />
        </UFormField>
      </template>

      <ErrorAlert :err="registrationError" title="Registration refused" :dismissible="false" />

      <div class="flex flex-col gap-4">
        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">Events</h3>
            <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addEvent">
              Add event
            </UButton>
          </div>
          <div class="mt-3 flex flex-col gap-2">
            <div
              v-for="(event, index) in events"
              :key="index"
              class="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_9rem_6rem_6rem_2.5rem] sm:items-end"
            >
              <UFormField :label="index === 0 ? 'id' : undefined" size="xs">
                <UInput v-model="event.id" size="xs" class="w-full" :aria-label="`event ${index + 1} id`" />
              </UFormField>
              <UFormField :label="index === 0 ? 'label' : undefined" size="xs">
                <UInput v-model="event.label" size="xs" class="w-full" :aria-label="`event ${index + 1} label`" />
              </UFormField>
              <UFormField :label="index === 0 ? 'statistic' : undefined" size="xs">
                <USelect v-model="event.statistic" :items="STATISTICS" size="xs" class="w-full" :aria-label="`event ${index + 1} statistic`" />
              </UFormField>
              <UFormField :label="index === 0 ? 'start' : undefined" size="xs">
                <UInputNumber v-model="event.start" :min="0" size="xs" class="w-full" :aria-label="`event ${index + 1} start step`" />
              </UFormField>
              <UFormField :label="index === 0 ? 'end' : undefined" size="xs">
                <UInputNumber v-model="event.end" :min="1" size="xs" class="w-full" :aria-label="`event ${index + 1} end step`" />
              </UFormField>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                :aria-label="`remove event ${event.id}`"
                @click="removeEvent(index)"
              />
            </div>
          </div>
          <p class="mt-2 text-xs text-muted">
            Windows are [start, end) step indices into the post-calibration data. Overlapping
            complete events switch the composite to Brown's correction; a window past the recording
            comes back <code class="text-primary">status: 'incomplete'</code> instead of throwing.
          </p>
        </div>

        <div v-if="registration" class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-highlighted mb-2">
              Canonical envelope (what gets hashed)
            </h3>
            <CodeSnippet :code="canonicalPretty" lang="json" :title="EXPERIMENT_SCHEMA" />
          </div>
          <div class="flex flex-col gap-3">
            <StatTile label="SHA-256 of the canonical bytes" size="sm">
              <template #value>
                <span class="block text-xs break-all leading-relaxed">{{ registration.hash }}</span>
              </template>
              <template #note>
                {{ registration.canonical.length }} bytes hashed · cite this next to the result
              </template>
            </StatTile>
            <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
              <div class="text-[11px] uppercase tracking-wide text-muted">Recent hashes</div>
              <ul class="mt-1 flex flex-col gap-1">
                <li
                  v-for="entry in history"
                  :key="entry.hash"
                  class="font-mono text-[11px] text-muted truncate"
                >
                  <span class="text-dimmed">{{ entry.at }}</span> {{ entry.hash.slice(0, 24) }}…
                </li>
              </ul>
              <p class="mt-1.5 text-xs text-dimmed">
                Every edit above produces a new entry: a config written with or without explicit
                defaults hashes identically, but no two different configs do.
              </p>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <HonestNote variant="fixed-in-0.2">
          0.2.0 hashes the default-resolved envelope
          <code>{{ '{"schema":"negentropy/experiment/1","config":…}' }}</code>, so every 0.1.x hash
          differs. Registration is now strict: unknown keys, duplicate event ids, malformed windows
          and bad anchors throw, and a registration mutated after hashing (a Date moved with
          <code>setTime</code>) is refused.
        </HonestNote>
      </template>
    </DemoSection>

    <DemoSection
      id="analysis"
      title="Analyze bytes under that registration"
      description="Fresh bytes per source, sliced into trials by the registered clock, analysed by the registered events. The result carries the registration hash — and re-analysing the archive reproduces it exactly, with no second burn-in."
      :api="['analyzeBytes', 'analyzeTrials', 'compositeZ', 'brownCompositeZ', 'bonferroni']"
    >
      <template #controls>
        <RunControls
          :busy="analysis.busy.value"
          :progress="analysis.progress.value"
          :disabled="!registration"
          label="Draw & analyze"
          icon="i-lucide-microscope"
          :hint="`${fmtBytes(costBytes)} from the selected source · ${recordedPerSource} trials per source`"
          @run="runAnalysis"
          @cancel="analysis.cancel()"
        />
      </template>

      <ErrorAlert :err="analysis.error.value" @dismiss="analysis.reset()" />
      <p v-if="intervalClock" class="text-sm text-warning">
        The interval clock is registered, and raw bytes carry no timing — analyzeBytes will throw
        <code>NegentropyError('invalid_config')</code>. That is the demonstration: press the button.
      </p>

      <div v-if="report" class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <AccountingBadge :bytes-consumed="report.bytes" :source="sourceSummary().providerName" />
          <UBadge size="sm" color="neutral" variant="subtle" class="font-mono">
            registration {{ report.result.registration?.slice(0, 12) }}…
          </UBadge>
          <UBadge size="sm" :color="report.reproduced ? 'success' : 'error'" variant="subtle">
            re-analysis reproduces it {{ report.reproduced ? 'exactly' : 'NOT' }}
          </UBadge>
          <UBadge size="sm" color="neutral" variant="subtle">
            {{ report.result.analysedSteps }} analysed steps
          </UBadge>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-muted text-xs uppercase">
              <tr>
                <th class="text-left py-1.5 pr-3 font-medium">event</th>
                <th class="text-left py-1.5 px-3 font-medium">statistic</th>
                <th class="text-left py-1.5 px-3 font-medium">status</th>
                <th class="text-right py-1.5 px-3 font-medium">value</th>
                <th class="text-right py-1.5 px-3 font-medium">df</th>
                <th class="text-left py-1.5 px-3 font-medium">p</th>
                <th class="text-right py-1.5 pl-3 font-medium">z</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in report.result.events" :key="event.id" class="border-t border-default">
                <td class="py-1.5 pr-3">
                  <div class="font-mono text-xs text-highlighted">{{ event.id }}</div>
                  <div class="text-xs text-dimmed">{{ event.label ?? '—' }}</div>
                </td>
                <td class="py-1.5 px-3 font-mono text-xs">{{ event.statistic }}</td>
                <td class="py-1.5 px-3">
                  <UBadge
                    size="sm"
                    :color="event.status === 'complete' ? 'success' : 'neutral'"
                    variant="subtle"
                  >
                    {{ event.status }}
                  </UBadge>
                  <div v-if="event.reason" class="text-xs text-dimmed mt-0.5">{{ event.reason }}</div>
                </td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">
                  {{ fmtNum(event.value, { digits: 2 }) }}
                </td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">
                  {{ fmtNum(event.df, { digits: 0 }) }}
                </td>
                <td class="py-1.5 px-3">
                  <PValue
                    v-if="event.status === 'complete'"
                    :p="event.pValue"
                    :kind="statisticKind(event.statistic)"
                    :show-kind="false"
                  />
                  <span v-else class="text-dimmed">—</span>
                </td>
                <td class="py-1.5 pl-3 text-right font-mono tabular-nums">
                  {{ fmtNum(event.z, { digits: 3 }) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Composite z"
            :value="report.result.composite.z"
            :digits="3"
            :note="`${report.result.composite.events} complete events · method ${report.result.composite.method}`"
          />
          <StatTile label="Composite p">
            <template #value>
              <PValue :p="report.result.composite.pValue" kind="pointwise" :show-kind="false" />
            </template>
            <template #note>one-sided, over the pre-registered events</template>
          </StatTile>
          <StatTile
            label="Var(Σz) under H0"
            :value="report.result.composite.variance"
            :digits="3"
            :note="report.result.composite.independent ? 'independent: plain Stouffer' : 'dependent: Brown correction'"
          />
          <StatTile
            label="Bonferroni α per event"
            :value="report.bonferroniAlpha"
            :digits="4"
            note="for an individual-event claim at family α = 0.05"
          />
        </div>

        <p v-if="report.result.composite.reason" class="text-xs text-muted">
          {{ report.result.composite.reason }}
        </p>

        <CodeSnippet :code="snippet" title="the registered pipeline" />
      </div>

      <template #footer>
        <HonestNote variant="caveat">
          A registration is a paper trail, not a proof. It fixes what was going to be measured
          before the numbers existed, which is what makes the p-values mean what they say — and it
          cannot rescue a run whose sources drifted, whose windows were chosen after a look, or
          whose composite is read as evidence for a cause rather than a mismatch with “independent
          fair bits”.
        </HonestNote>
      </template>
    </DemoSection>
  </div>
</template>
