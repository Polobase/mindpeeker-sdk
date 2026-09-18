<script setup lang="ts">
/**
 * §5 — a live `session()` over the selected source and independent DRBG
 * control arms, with the anytime-valid e-value on every tick and a total
 * `stop()` that analyses the archive.
 */
import {
  anytimeEnvelope,
  anytimeP,
  type ExperimentResult,
  netvarMartingale,
  type RegisteredExperiment,
  registerExperiment,
  session,
  type Session,
  type TrialSource,
  villeCrossing,
} from '@mindpeeker/negentropy'
import { drbgSource, provider, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'

const MIXES = [
  { label: 'selected source + 2 DRBG controls', value: 'selected+2' },
  { label: 'selected source + 1 DRBG control', value: 'selected+1' },
  { label: '3 independent DRBG controls', value: 'drbg3' },
]
const RATES = [4, 10, 25].map((n) => ({ label: `${n} ticks/s`, value: n }))
const WIDTHS = [200, 64, 32].map((n) => ({ label: `${n} bits`, value: n }))
const LIMITS = [100, 300, 1000].map((n) => ({ label: `${n} steps`, value: n }))
const ALPHA = 0.05

const mix = ref('selected+2')
const rate = ref(10)
const bitsPerTrial = ref(200)
const maxSteps = ref(300)

interface Live {
  step: number
  present: readonly string[]
  stouffer: number
  netvar: number
  cumdev: number
  logEValue: number
  eValue: number
  activeEvents: readonly string[]
  anytimeP: number
  ville: number
  cumdevSeries: Float64Array
  boundary: Float64Array
}

interface Final {
  result: ExperimentResult
  registration: RegisteredExperiment
  liveEqualsBatch: boolean
  steps: number
}

const live = shallowRef<Live>()
const final = shallowRef<Final>()
const task = useTask<void>()
let current: Session | undefined

const sourceCount = computed(() => (mix.value === 'selected+1' ? 2 : 3))
const bytesPerTick = computed(() => sourceCount.value * (bitsPerTrial.value / 8))

function buildSources(): TrialSource[] {
  const controls = mix.value === 'drbg3' ? 3 : mix.value === 'selected+1' ? 1 : 2
  const list: TrialSource[] = []
  if (mix.value !== 'drbg3') list.push(provider)
  for (let i = 1; i <= controls; i++) {
    list.push(drbgSource(`${currentSeedLabel()} / live-egg-${i}`))
  }
  return list
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function start(): void {
  live.value = undefined
  final.value = undefined
  void task.run(async (signal, setProgress) => {
    const limit = maxSteps.value
    const registration = await registerExperiment({
      trial: { bitsPerTrial: bitsPerTrial.value, clock: { mode: 'count' } },
      calibration: 'theoretical',
      missing: 'skip',
      events: [
        { id: 'first-100', label: 'the first 100 steps', statistic: 'netvar', start: 0, end: 100 },
        {
          id: 'whole-run',
          label: 'pairwise correlation across the network',
          statistic: 'correlation',
          start: 0,
          end: limit,
        },
        {
          id: 'never-elapses',
          label: 'a window far past this run',
          statistic: 'netvar',
          start: 0,
          end: 100000,
        },
      ],
    })

    const boundary = anytimeEnvelope(limit, ALPHA, { sided: 'upper' }).upper
    const running = session({
      sources: buildSources(),
      registration,
      signal,
      stepTimeoutMs: 8000,
    })
    current = running

    const cumdev: number[] = []
    const stouffers: number[] = []
    const logE: number[] = []
    let painted = 0
    try {
      for await (const tick of running) {
        cumdev.push(tick.cumdev)
        stouffers.push(tick.stouffer)
        logE.push(tick.logEValue)
        const now = performance.now()
        if (now - painted > 120 || tick.step + 1 >= limit) {
          painted = now
          const ps = anytimeP(logE)
          live.value = {
            step: tick.step,
            present: tick.present,
            stouffer: tick.stouffer,
            netvar: tick.netvar,
            cumdev: tick.cumdev,
            logEValue: tick.logEValue,
            eValue: tick.eValue,
            activeEvents: tick.activeEvents,
            anytimeP: (ps[ps.length - 1] as number) ?? Number.NaN,
            ville: villeCrossing(logE, ALPHA),
            cumdevSeries: Float64Array.from(cumdev),
            boundary: boundary.slice(0, cumdev.length),
          }
        }
        setProgress(Math.min(1, (tick.step + 1) / limit))
        if (tick.step + 1 >= limit) break
        if (signal.aborted) break
        await delay(1000 / rate.value)
        if (signal.aborted) break
      }
    } finally {
      // Total: stop() never throws, releases every source and analyses the archive.
      const result = running.stop()
      current = undefined
      const batch =
        stouffers.length > 0 ? netvarMartingale(stouffers, { sided: 'upper' }) : new Float64Array(0)
      final.value = {
        result,
        registration,
        liveEqualsBatch:
          stouffers.length > 0 &&
          Object.is(batch[batch.length - 1] as number, logE[logE.length - 1] as number),
        steps: stouffers.length,
      }
    }
  })
}

onUnmounted(() => {
  current?.stop()
  current = undefined
})

const snippet = computed(
  () => `import { anytimeP, registerExperiment, session } from '@mindpeeker/negentropy'

const registration = await registerExperiment({
  trial: { bitsPerTrial: ${bitsPerTrial.value}, clock: { mode: 'count' } },
  missing: 'skip',           // a slow source leaves the roster instead of failing the run
  events: [{ id: 'first-100', statistic: 'netvar', start: 0, end: 100 }],
})

const live = session({ sources, registration, stepTimeoutMs: 8000 })
for await (const tick of live) {
  render(tick.stouffer, tick.netvar, tick.cumdev, tick.activeEvents)
  if (tick.eValue >= ${1 / ALPHA}) break   // anytime-valid: stopping here keeps level ${ALPHA}
}
const result = live.stop()   // never throws: analysis + composite + full archive`,
)
</script>

<template>
  <DemoSection
    id="session"
    title="A live session in lock-step rounds"
    description="Each tick awaits one trial from every source, combines whoever answered into a Stouffer Z, and carries the running netvar, cumulative deviation and the anytime-valid e-value. Watching that e-value after every tick is legitimate; watching the pointwise envelope is not."
    :api="['session', 'SessionTick', 'anytimeP', 'villeCrossing', 'netvarMartingale', 'registerExperiment']"
  >
    <template #controls>
      <UFormField label="Sources" size="sm" class="w-64">
        <USelect v-model="mix" :items="MIXES" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Tick rate" size="sm" class="w-32">
        <USelect v-model="rate" :items="RATES" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Bits per trial" size="sm" class="w-32">
        <USelect v-model="bitsPerTrial" :items="WIDTHS" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Stop after" size="sm" class="w-36">
        <USelect v-model="maxSteps" :items="LIMITS" size="sm" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Start the session"
        busy-label="Live…"
        icon="i-lucide-radio"
        :hint="`${fmtBytes(bytesPerTick)} per tick × ${rate}/s ≈ ${fmtBytes(bytesPerTick * rate)}/s · Cancel stops it early and still analyses the archive`"
        @run="start"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="flex flex-col gap-4">
      <div v-if="live" class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Step"
            :value="live.step + 1"
            :digits="0"
            :note="`present: ${live.present.join(', ') || 'nobody'}`"
          />
          <StatTile
            label="Stouffer Z / netvar"
            :value="live.stouffer"
            :digits="3"
            :note="`running Σ Z² = ${fmtNum(live.netvar, { digits: 2 })} · D = ${fmtNum(live.cumdev, { digits: 2 })}`"
          />
          <StatTile
            label="e-value M_t"
            :value="live.eValue"
            :digits="3"
            :tone="live.eValue >= 1 / ALPHA ? 'warning' : 'neutral'"
            :note="`ln M = ${fmtNum(live.logEValue, { digits: 3 })} · threshold 1/α = ${1 / ALPHA}`"
          />
          <StatTile label="Anytime-valid p">
            <template #value>
              <PValue :p="live.anytimeP" kind="anytime" :alpha="ALPHA" :show-kind="false" />
            </template>
            <template #note>
              crossing: {{ live.ville >= 0 ? `step ${live.ville + 1}` : 'none' }} · active events:
              {{ live.activeEvents.join(', ') || 'none' }}
            </template>
          </StatTile>
        </div>

        <LineChart
          :series="[
            { name: 'D(t) live', y: live.cumdevSeries },
            { name: `anytime-valid boundary (α = ${ALPHA})`, y: live.boundary, color: 3, dashed: true },
          ]"
          :hlines="[{ value: 0, label: 'chance', dashed: false }]"
          x-label="step"
          y-label="cumulative deviation"
          :height="260"
          aria-label="Live cumulative deviation against the anytime-valid boundary"
        />
      </div>
      <p v-else-if="!task.busy.value && !final" class="text-sm text-muted">
        Press “Start the session”. The DRBG control arms are deterministic — there is nothing in
        them to find, which is exactly what an honest monitor should show.
      </p>

      <div v-if="final" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge size="sm" color="neutral" variant="subtle" class="font-mono">
            registration {{ final.registration.hash.slice(0, 12) }}…
          </UBadge>
          <UBadge size="sm" color="neutral" variant="subtle">
            {{ final.result.analysedSteps }} archived steps · {{ final.result.series.length }} series
          </UBadge>
          <UBadge size="sm" :color="final.liveEqualsBatch ? 'success' : 'error'" variant="subtle">
            live e-value {{ final.liveEqualsBatch ? '≡' : '≠' }} netvarMartingale on the recording
          </UBadge>
          <AccountingBadge :source="sourceSummary().providerName" />
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-muted text-xs uppercase">
              <tr>
                <th class="text-left py-1.5 pr-3 font-medium">event</th>
                <th class="text-left py-1.5 px-3 font-medium">statistic</th>
                <th class="text-left py-1.5 px-3 font-medium">status</th>
                <th class="text-right py-1.5 px-3 font-medium">steps</th>
                <th class="text-right py-1.5 px-3 font-medium">value</th>
                <th class="text-left py-1.5 pl-3 font-medium">p</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in final.result.events" :key="event.id" class="border-t border-default">
                <td class="py-1.5 pr-3 font-mono text-xs">{{ event.id }}</td>
                <td class="py-1.5 px-3 font-mono text-xs">{{ event.statistic }}</td>
                <td class="py-1.5 px-3">
                  <UBadge
                    size="sm"
                    :color="event.status === 'complete' ? 'success' : 'neutral'"
                    variant="subtle"
                  >
                    {{ event.status }}
                  </UBadge>
                </td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">{{ event.steps }}</td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">
                  {{ fmtNum(event.value, { digits: 2 }) }}
                </td>
                <td class="py-1.5 pl-3">
                  <PValue
                    v-if="event.status === 'complete'"
                    :p="event.pValue"
                    :kind="event.statistic === 'correlation' || event.statistic === 'covar' ? 'pointwise' : 'exact'"
                    :show-kind="false"
                  />
                  <span v-else class="text-dimmed text-xs">{{ event.reason ?? '—' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Composite z"
            :value="final.result.composite.z"
            :digits="3"
            :note="`${final.result.composite.events} complete events · ${final.result.composite.method}`"
          />
          <StatTile label="Composite p">
            <template #value>
              <PValue :p="final.result.composite.pValue" kind="pointwise" :show-kind="false" />
            </template>
            <template #note>incomplete events are excluded, never imputed</template>
          </StatTile>
          <StatTile
            label="Ticks collected"
            :value="final.steps"
            :digits="0"
            note="one archive row per tick per source — NaN marks an absent source"
          />
        </div>
      </div>

      <CodeSnippet :code="snippet" title="the live loop" />
    </div>

    <template #footer>
      <HonestNote variant="contested">
        An e-value crossing 1/α means the trial sums stopped behaving like independent fair bits.
        Drifting hardware, a flaky network source, serial correlation and plain bugs all do that,
        and all of them are far more probable than anything exotic. The monitor is honest about
        <em>when</em> you may stop looking; it says nothing about why the number moved.
      </HonestNote>
    </template>
  </DemoSection>
</template>
