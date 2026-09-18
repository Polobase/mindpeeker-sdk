<script setup lang="ts">
/**
 * §6c — SP 800-90B continuous health tests over a live stream, observational
 * by default (log the alarm, keep going) or strict (throw).
 */
import {
  aptCutoff,
  ContinuousHealth,
  type HealthAlarm,
  rctCutoff,
} from '@mindpeeker/negentropy'
import { createYielder } from '~/lib/async'
import { localStream } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'

const WINDOWS = [
  { label: '512 (non-binary samples)', value: 512 },
  { label: '1024 (binary sources)', value: 1024 },
]
const BUDGETS = [65536, 262144, 1048576].map((n) => ({ label: fmtBytes(n), value: n }))

const minEntropy = ref(7.5)
const windowSize = ref(512)
const strict = ref(false)
const budget = ref(262144)
const injectStuck = ref(false)

interface HealthReport {
  samplesSeen: number
  alarms: readonly HealthAlarm[]
  rct: number
  apt: number
  stopped: 'complete' | 'strict alarm'
}

const task = useTask<HealthReport>()
const report = computed(() => task.result.value)

const cutoffs = computed(() => {
  try {
    return {
      rct: rctCutoff(minEntropy.value),
      apt: aptCutoff(minEntropy.value, windowSize.value as 512 | 1024),
      error: undefined as unknown,
    }
  } catch (error) {
    return { rct: Number.NaN, apt: Number.NaN, error }
  }
})

function run(): void {
  void task.run(async (signal, setProgress) => {
    const health = new ContinuousHealth(
      {
        minEntropyPerSample: minEntropy.value,
        windowSize: windowSize.value as 512 | 1024,
        strict: strict.value,
      },
      'browser CSPRNG',
    )
    const tick = createYielder(8, signal)
    const target = budget.value
    let seen = 0
    let stopped: 'complete' | 'strict alarm' = 'complete'
    try {
      for await (const chunk of localStream({ chunkBytes: 4096, signal })) {
        health.push(chunk)
        seen += chunk.length
        // A stuck sensor: one byte repeated long past the repetition-count cutoff.
        if (injectStuck.value && seen >= target / 2 && seen < target / 2 + 4096) {
          const stuck = new Uint8Array(600).fill(0x5a)
          health.push(stuck)
          seen += stuck.length
        }
        setProgress(Math.min(1, seen / target))
        if (seen >= target) break
        await tick()
      }
    } catch (error) {
      // strict mode throws NegentropyError('health_test') on the first alarm;
      // anything else is a real failure and belongs in the error alert
      if ((error as { code?: string })?.code !== 'health_test') throw error
      stopped = 'strict alarm'
      return {
        samplesSeen: health.samplesSeen,
        alarms: health.alarms,
        rct: health.rctCutoff,
        apt: health.aptCutoff,
        stopped,
      }
    }
    return {
      samplesSeen: health.samplesSeen,
      alarms: health.alarms,
      rct: health.rctCutoff,
      apt: health.aptCutoff,
      stopped,
    }
  })
}

const snippet = computed(
  () => `import { ContinuousHealth } from '@mindpeeker/negentropy'

const health = new ContinuousHealth({
  minEntropyPerSample: ${minEntropy.value},   // bits per raw byte, in (0, 8]
  windowSize: ${windowSize.value},              // 512 or 1024 — nothing else
  strict: ${strict.value},                // false: log the alarm and keep going
}, 'my-source')

for await (const chunk of source.stream({ signal })) {
  const raised = health.push(chunk)   // the alarms THIS call raised
  if (raised.length) report(raised)
}
health.rctCutoff   // ${fmtNum(cutoffs.value.rct, { digits: 0 })}  = 1 + ⌈20/H⌉
health.aptCutoff   // ${fmtNum(cutoffs.value.apt, { digits: 0 })}  = 1 + CRITBINOM(W, 2^−H, 1 − 2^−20)`,
)
</script>

<template>
  <DemoSection
    id="health"
    title="Continuous health tests on a live stream"
    description="SP 800-90B §4.4: the Repetition Count Test catches a stuck sample, the Adaptive Proportion Test catches one value taking over a window. Both cutoffs are exact at every H — computed with a log-space binomial tail, cross-checked against exact BigInt sums."
    :api="['ContinuousHealth', 'rctCutoff', 'aptCutoff']"
  >
    <template #controls>
      <UFormField :label="`Assessed H = ${minEntropy.toFixed(2)} bits/sample`" size="sm" class="w-56">
        <USlider
          v-model="minEntropy"
          :min="0.25"
          :max="8"
          :step="0.25"
          aria-label="Assessed min-entropy per sample"
        />
      </UFormField>
      <UFormField label="APT window" size="sm" class="w-52">
        <USelect v-model="windowSize" :items="WINDOWS" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Samples" size="sm" class="w-32">
        <USelect v-model="budget" :items="BUDGETS" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Strict (throw)" size="sm">
        <USwitch v-model="strict" />
      </UFormField>
      <UFormField label="Inject a stuck sensor" size="sm">
        <USwitch v-model="injectStuck" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Watch the stream"
        icon="i-lucide-heart-pulse"
        :hint="`${fmtBytes(budget)} from the browser CSPRNG — a high-rate panel no beacon could feed`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="RCT cutoff"
          :value="cutoffs.rct"
          :digits="0"
          note="identical samples in a row that trip the test (α = 2⁻²⁰)"
        />
        <StatTile
          label="APT cutoff"
          :value="cutoffs.apt"
          :digits="0"
          :note="`one value this often in a ${windowSize}-sample window`"
        />
        <StatTile
          label="Samples seen"
          :value="report?.samplesSeen ?? 0"
          :digits="0"
          :note="report ? `stopped: ${report.stopped}` : 'press “Watch the stream”'"
        />
        <StatTile
          label="Alarms"
          :value="report?.alarms.length ?? 0"
          :digits="0"
          :tone="(report?.alarms.length ?? 0) > 0 ? 'warning' : 'success'"
          note="an alarm resets that test's counter, so a long stuck run keeps re-tripping it"
        />
      </div>

      <div v-if="report && report.alarms.length" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted text-xs uppercase">
            <tr>
              <th class="text-left py-1.5 pr-3 font-medium">test</th>
              <th class="text-right py-1.5 px-3 font-medium">sample index</th>
              <th class="text-right py-1.5 px-3 font-medium">count</th>
              <th class="text-right py-1.5 pl-3 font-medium">cutoff</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(alarm, i) in report.alarms.slice(0, 12)"
              :key="i"
              class="border-t border-default font-mono text-xs tabular-nums"
            >
              <td class="py-1.5 pr-3 uppercase text-warning">{{ alarm.test }}</td>
              <td class="py-1.5 px-3 text-right">{{ alarm.sample }}</td>
              <td class="py-1.5 px-3 text-right">{{ alarm.count }}</td>
              <td class="py-1.5 pl-3 text-right">{{ alarm.cutoff }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-xs text-muted">
        Exact reference points: H = 1/16 gives an APT cutoff of 509 at W = 512 and 1009 at W = 1024;
        below H = 20/W the cutoff is W + 1 and the APT cannot fire at all — which is the true
        answer, not a fudge. A healthy CSPRNG at H = 7.5 should raise nothing.
      </p>

      <CodeSnippet :code="snippet" title="the health monitor" />
    </div>

    <template #footer>
      <HonestNote variant="caveat">
        Health tests are an alarm, not a certificate. They catch gross failures — a dead sensor, a
        wedged oscillator — at α = 2⁻²⁰ per test. Silence from them says nothing about the entropy
        actually present, which is what the min-entropy accounting above is for.
      </HonestNote>
    </template>
  </DemoSection>
</template>
