<script setup lang="ts">
/**
 * Section 5 — GCP formal event analysis over a recorded multi-source session:
 * record it (hash-chained, lock-step, 1 Hz), read it back, analyze a
 * pre-declared window, and compare the two window forms.
 */
import {
  type AnalyzeEventOptions,
  analyzeEvent,
  type GcpEventResult,
  readSession,
  recordSession,
  type TrialSeries,
} from '@mindpeeker/psi'
import { createYielder } from '~/lib/async'
import { drbgSource } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { bytesFor, injectShift, lockStepClock, sha256Hex, shortHash } from '~/lib/psi/synthetic'

const BITS = 200
const T0 = Date.UTC(2026, 8, 17, 12, 0, 0)

const sourceCount = ref(3)
const rounds = ref(600)
const startStep = ref(120)
const endStep = ref(180)
const epsilon = ref(0)
const windowMode = ref<'step' | 'ms'>('step')
const alignment = ref<'round' | 'strict'>('round')
const edgeOffsetMs = ref(0)
const blockSeconds = ref(0)
const empirical = ref(false)

const WINDOW_MODES = [
  { label: 'step window { startStep, endStep }', value: 'step' },
  { label: 'wall-clock window { startMs, endMs }', value: 'ms' },
]
const ALIGNMENTS = [
  { label: "round — one canonical stamp per round", value: 'round' },
  { label: 'strict — per-source stamps must agree', value: 'strict' },
]

const budget = computed(() => bytesFor(sourceCount.value * rounds.value, BITS))
const lineCount = computed(() => sourceCount.value * rounds.value + 1)

interface Recording {
  lines: string[]
  archive: TrialSeries[]
  genesis: string
  head: string
  rounds: number
}

const recordTask = useTask<Recording>()
const recording = computed(() => recordTask.result.value)

function record(): void {
  void recordTask.run(async (signal, setProgress) => {
    const tick = createYielder(8, signal)
    const n = sourceCount.value
    const total = lineCount.value
    const genesis = await sha256Hex(
      `psi playground GCP event plan / sources ${n} / rounds ${rounds.value} / window ${startStep.value}–${endStep.value}`,
    )
    const sources = Array.from({ length: n }, (_, i) =>
      drbgSource(`${currentSeedLabel()} / egg-${i + 1}`),
    )
    const lines: string[] = []
    for await (const line of recordSession(sources, {
      bitsPerTrial: BITS,
      chunkBytes: BITS / 8,
      now: lockStepClock(T0, n),
      chain: { registration: genesis },
      tags: (round) => ({ segment: round < startStep.value ? 'before' : 'event-or-after' }),
      signal,
    })) {
      lines.push(line)
      if (lines.length % n === 0) {
        setProgress(lines.length / total)
        await tick()
      }
      if (lines.length >= total) break
    }
    const read = await readSession(lines)
    const archive = read.map((series) => ({
      ...series,
      sums: injectShift(series.sums, BITS, epsilon.value, startStep.value, endStep.value),
    }))
    return {
      lines,
      archive,
      genesis,
      head: await sha256Hex(lines[lines.length - 1] as string),
      rounds: rounds.value,
    }
  })
}

const options = computed<AnalyzeEventOptions>(() => {
  const history = recording.value?.archive.map((s) => ({
    ...s,
    sums: s.sums.slice(0, Math.max(1, startStep.value)),
    timestamps: s.timestamps?.slice(0, Math.max(1, startStep.value)),
  }))
  return {
    alignment: alignment.value,
    ...(blockSeconds.value > 0 ? { blockSeconds: blockSeconds.value } : {}),
    ...(empirical.value && history
      ? { calibration: { history, minTrials: 10 } }
      : { calibration: 'theoretical' as const }),
  }
})

const eventWindow = computed(() =>
  windowMode.value === 'step'
    ? { startStep: startStep.value, endStep: endStep.value }
    : {
        startMs: T0 + startStep.value * 1000 + edgeOffsetMs.value,
        endMs: T0 + endStep.value * 1000 + edgeOffsetMs.value,
      },
)

const analysis = computed<{ ok?: GcpEventResult; error?: unknown }>(() => {
  const r = recording.value
  if (!r) return {}
  try {
    return { ok: analyzeEvent(r.archive, eventWindow.value, options.value) }
  } catch (error) {
    return { error }
  }
})

const chart = computed(() => {
  const result = analysis.value.ok
  if (!result) return undefined
  return {
    cumdev: [
      { name: 'cumulative deviation D(t)', y: result.cumdev },
      { name: 'pointwise χ² envelope (upper)', y: result.envelope, color: 4, dashed: true },
    ],
    stouffer: [{ name: 'per-trial Stouffer Z', y: result.stoufferPerTrial, color: 2 }],
  }
})

const snippet = computed(
  () => `import { analyzeEvent, readSession, recordSession } from '@mindpeeker/psi'

const lines = []
for await (const line of recordSession(eggs, {
  bitsPerTrial: 200, chain: { registration: genesis },
  tags: (round) => ({ segment: round < ${startStep.value} ? 'before' : 'event-or-after' }),
})) lines.push(line)                       // you persist them; the recording is the paper trail

const archive = await readSession(lines)   // v1 and v2, strings or stream chunks
const event = analyzeEvent(archive, ${
    windowMode.value === 'step'
      ? `{ startStep: ${startStep.value}, endStep: ${endStep.value} }`
      : `{ startMs, endMs }`
  }, {
  alignment: '${alignment.value}',${blockSeconds.value > 0 ? `\n  blockSeconds: ${blockSeconds.value},` : ''}${
    empirical.value ? '\n  calibration: { history: restingWindow },' : ''
  }
})
console.log(event.netvar.statistic, event.netvar.pValue, event.composite.statistic)`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="event-record"
      title="1 · Record a lock-step session"
      description="Three seeded eggs, one 200-bit trial each per second, every line hash-chained to the one before it. Ten minutes of network data, recorded in well under a second. Recording first and analyzing later is the whole point: anyone can re-derive these numbers from the lines."
      :api="['recordSession', 'readSession', 'RecordSessionOptions.chain', 'RecordSessionOptions.tags']"
    >
      <template #controls>
        <RunControls
          :busy="recordTask.busy.value"
          :progress="recordTask.progress.value"
          :label="`Record ${rounds} rounds`"
          busy-label="Recording…"
          :hint="`${lineCount} JSONL lines · ${fmtBytes(budget)} from ${sourceCount} seeded DRBG eggs · every line is SHA-256 chained`"
          @run="record"
          @cancel="recordTask.cancel()"
        />
        <UFormField label="Eggs (sources)">
          <UInputNumber v-model="sourceCount" :min="2" :max="6" class="w-28" />
        </UFormField>
        <UFormField label="Rounds (seconds)">
          <UInputNumber v-model="rounds" :min="60" :max="1200" :step="60" class="w-32" />
        </UFormField>
        <UFormField
          label="Injected per-bit shift ε"
          help="synthetic; applied to the window that was set when you pressed Record"
        >
          <UInputNumber v-model="epsilon" :min="0" :max="0.2" :step="0.01" class="w-32" />
        </UFormField>
      </template>

      <ErrorAlert :err="recordTask.error.value" @dismiss="recordTask.reset()" />

      <div v-if="recording" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="lines" :value="recording.lines.length" :digits="0" size="sm" note="1 header + sources × rounds" />
        <StatTile label="genesis" :value="shortHash(recording.genesis)" size="sm" tone="primary" note="the registration this session runs under" />
        <StatTile label="head" :value="shortHash(recording.head)" size="sm" note="publish it: a truncated tail is invisible without it" />
        <StatTile
          label="series read back"
          :value="`${recording.archive.length} × ${recording.archive[0]?.sums.length ?? 0}`"
          size="sm"
          note="readSession reproduces the live analysis exactly"
        />
      </div>
      <p v-else-if="!recordTask.busy.value" class="text-sm text-muted">
        Nothing recorded yet. The eggs are seeded DRBGs, so the archive is reproducible — and
        contains, by construction, no effect at all.
      </p>
    </DemoSection>

    <DemoSection
      v-if="recording"
      id="event-analyze"
      title="2 · The formal event statistics"
      description="netvar Σ Z_s(t)² ~ χ²(T) is the GCP's standard event statistic; devvar, the cumulative-deviation curve and the pooled composite come with it. The window has to be declared before the data, not chosen from this chart."
      :api="['analyzeEvent', 'GcpEventResult.netvar', 'GcpEventResult.cumdev', 'AnalyzeEventOptions.blockSeconds']"
    >
      <template #controls>
        <UFormField label="Window start (step)">
          <UInputNumber v-model="startStep" :min="0" :max="rounds - 1" class="w-32" />
        </UFormField>
        <UFormField label="Window end (exclusive)">
          <UInputNumber v-model="endStep" :min="1" :max="rounds" class="w-32" />
        </UFormField>
        <UFormField label="Window form" class="min-w-64">
          <USelect v-model="windowMode" :items="WINDOW_MODES" class="w-full" />
        </UFormField>
        <UFormField v-if="windowMode === 'ms'" label="Alignment" class="min-w-64">
          <USelect v-model="alignment" :items="ALIGNMENTS" class="w-full" />
        </UFormField>
        <UFormField
          v-if="windowMode === 'ms'"
          label="Edge offset (ms)"
          help="±2 ms lands inside a round's per-source stamp spread"
        >
          <UInputNumber v-model="edgeOffsetMs" :min="-500" :max="500" :step="1" class="w-32" />
        </UFormField>
        <UFormField label="Blocked netvar (seconds)" help="0 = off; GCP used 60 s and 15 min">
          <UInputNumber v-model="blockSeconds" :min="0" :max="600" :step="10" class="w-32" />
        </UFormField>
        <USwitch
          v-model="empirical"
          label="empirical calibration"
          description="fit each egg on the pre-window steps (GCP formal convention)"
        />
      </template>

      <ErrorAlert
        v-if="analysis.error"
        :err="analysis.error"
        :dismissible="false"
        title="analyzeEvent refused this window"
      />

      <div v-if="analysis.ok" class="flex flex-col gap-5">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="netvar"
            :value="analysis.ok.netvar.statistic"
            :digits="2"
            :note="`χ²(${analysis.ok.netvar.df}) — expectation ${analysis.ok.netvar.df}`"
          />
          <StatTile label="netvar p" size="md">
            <template #value><PValue :p="analysis.ok.netvar.pValue" kind="pointwise" /></template>
            <template #note>valid only for a window declared in advance</template>
          </StatTile>
          <StatTile
            label="devvar"
            :value="analysis.ok.devvar.statistic"
            :digits="2"
            :note="`χ²(${analysis.ok.devvar.df}) over ${analysis.ok.sources.length} devices`"
          />
          <StatTile
            label="composite z"
            :value="analysis.ok.composite.statistic"
            :digits="3"
            note="pooled mean shift, N(0,1) — a different question from netvar"
          />
        </div>

        <div v-if="analysis.ok.blocked" class="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="blocked netvar"
            :value="analysis.ok.blocked.netvar.statistic"
            :digits="2"
            size="sm"
            :note="`χ²(${analysis.ok.blocked.netvar.df}) over ${analysis.ok.blocked.steps.length} blocks of ${analysis.ok.blocked.blockSeconds} s`"
          />
          <StatTile label="blocked p" size="sm">
            <template #value><PValue :p="analysis.ok.blocked.netvar.pValue" kind="pointwise" /></template>
            <template #note>block length is part of the registration</template>
          </StatTile>
          <StatTile
            label="calibration"
            :value="analysis.ok.calibrations[0]?.basis ?? '—'"
            size="sm"
            :note="`mean ${fmtNum(analysis.ok.calibrations[0]?.mean, { digits: 2 })} · sd ${fmtNum(analysis.ok.calibrations[0]?.sd, { digits: 3 })} · fit on ${analysis.ok.calibrations[0]?.trials ?? 0} trials`"
          />
        </div>

        <div v-if="chart" class="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 class="text-sm font-medium text-highlighted mb-2">
              Cumulative deviation inside the window
            </h3>
            <LineChart
              :series="chart.cumdev"
              :hlines="[{ value: 0, label: 'chance', dashed: false }]"
              x-label="step in the window"
              y-label="cumsum(Z² − 1)"
              :height="240"
              :format="(v) => fmtNum(v, { digits: 2 })"
              aria-label="cumulative deviation of the event window against the pointwise envelope"
            />
          </div>
          <div>
            <h3 class="text-sm font-medium text-highlighted mb-2">Per-trial Stouffer Z</h3>
            <LineChart
              :series="chart.stouffer"
              :hlines="[
                { value: 0, label: 'chance', dashed: false },
                { value: 1.96 },
                { value: -1.96, label: '±1.96' },
              ]"
              x-label="step in the window"
              y-label="Z_s(t)"
              :height="240"
              :format="(v) => fmtNum(v, { digits: 2 })"
              aria-label="per-trial Stouffer Z across sources inside the window"
            />
          </div>
        </div>

        <CodeSnippet :code="snippet" title="what this section ran" />
      </div>

      <HonestNote variant="caveat">
        Every number here is a fact about these bytes under one window. GCP's formal series
        normalized each device by its own empirical mean and variance, which is what the switch
        above does — fit on the pre-window steps, never on the window itself, because normalizing
        data with parameters fit on itself deflates every statistic. Choosing the window after
        seeing the curve turns any of these p-values into decoration.
      </HonestNote>
    </DemoSection>

    <PsiPlacebo
      v-if="recording && analysis.ok"
      :archive="recording.archive"
      :start-step="startStep"
      :end-step="endStep"
      :observed="analysis.ok.netvar.statistic"
    />

    <PsiFieldReg v-if="recording" :series="recording.archive[0]" :rounds="recording.rounds" />
  </div>
</template>
