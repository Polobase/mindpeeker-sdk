<script setup lang="ts">
/**
 * Section 1 — evaluate, prove, verify, side by side.
 *
 * One input, one T, both proof systems, with and without checkpoints. The point
 * of the table is the asymmetry: evaluation is T sequential squarings and cannot
 * be hurried, proving is a fraction of that once √T powers are stored, and
 * verification is logarithmic in T.
 */
import { pietrzakProveCost, pietrzakRounds } from '@mindpeeker/vdf'
import { getBytes, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtDuration, fmtNum, toHex } from '~/lib/format'
import type { ModulusId, PipelineResult } from '~/lib/vdf/jobs'
import { ellipsizeHex, MODULUS_META, superscript, T_MAX_EXPONENT, T_MIN_EXPONENT } from '~/lib/vdf/jobs'
import { runVdfJob } from '~/lib/vdf/worker-client'

const exponent = ref(12)
const modulusId = ref<ModulusId>('rsa2048')
const plain = ref(true)
const phase = ref<string>()
const inputHex = ref<string>()

const task = useTask<PipelineResult>()

const T = computed(() => 2 ** exponent.value)
const checkpoints = computed(() => Math.ceil(Math.sqrt(T.value)))
const interval = computed(() => Math.ceil(T.value / checkpoints.value))
const rounds = computed(() => pietrzakRounds(T.value))
const costPlain = computed(() => pietrzakProveCost(T.value))
const costCk = computed(() => pietrzakProveCost(T.value, interval.value))

const MODULUS_ITEMS = Object.values(MODULUS_META).map((m) => ({ label: m.label, value: m.id }))

/** Squaring-equivalents the configured run will perform, for the hint line. */
const workEstimate = computed(() => {
  const base = T.value + costCk.value + T.value * 0.2
  return Math.round(plain.value ? base + costPlain.value + T.value * 1.125 : base)
})

const result = computed(() => task.result.value)
const stale = computed(
  () =>
    result.value !== undefined &&
    (result.value.T !== T.value || result.value.modulusId !== modulusId.value),
)

const timings = computed(() => {
  const r = result.value
  if (!r) return undefined
  const rows: { label: string; ms: number }[] = [{ label: 'evaluate', ms: r.evalMs }]
  if (r.pietrzak.proveMs !== null) rows.push({ label: 'P prove', ms: r.pietrzak.proveMs })
  rows.push({ label: 'P prove +ck', ms: r.pietrzak.proveCkMs })
  rows.push({ label: 'P verify', ms: r.pietrzak.verifyMs })
  if (r.wesolowski.proveMs !== null) rows.push({ label: 'W prove', ms: r.wesolowski.proveMs })
  rows.push({ label: 'W prove +ck', ms: r.wesolowski.proveCkMs })
  rows.push({ label: 'W verify', ms: r.wesolowski.verifyMs })
  return rows
})

const verifySpeedup = computed(() => {
  const r = result.value
  if (!r || r.pietrzak.verifyMs <= 0) return undefined
  return r.evalMs / r.pietrzak.verifyMs
})

const code = computed(
  () => `import { evaluate, pietrzakProve, pietrzakVerify, wesolowskiProve, wesolowskiVerify } from '@mindpeeker/vdf'

const T = ${T.value}                                   // 2^${exponent.value}, sized by calibrate() in production
const input = await getBytes(32)                 // whatever you want to bind the delay to
const { y, checkpoints } = await evaluate(input, T, { checkpoints: ${checkpoints.value} })

const proof = await pietrzakProve(input, T, y, { checkpoints })
await pietrzakVerify(input, T, y, proof)         // → true, in O(log T)

const short = await wesolowskiProve(input, T, y, { checkpoints })
await wesolowskiVerify(input, T, y, short)       // → true, 526 bytes at 2048 bits`,
)

async function run(): Promise<void> {
  await task.run(async (signal, setProgress) => {
    setProgress(null)
    phase.value = 'drawing the input bytes'
    const input = await getBytes(32, { signal })
    inputHex.value = toHex(input, { max: 12 })
    return await runVdfJob(
      'pipeline',
      {
        input,
        T: T.value,
        modulusId: modulusId.value,
        checkpoints: checkpoints.value,
        plain: plain.value,
      },
      {
        signal,
        onProgress: (label, fraction) => {
          phase.value = label
          setProgress(fraction)
        },
      },
    )
  })
  phase.value = undefined
}
</script>

<template>
  <DemoSection
    id="pipeline"
    title="Evaluate, prove, verify"
    description="T sequential squarings in a group of unknown order, then two different proofs that the chain was really walked. Both provers run with and without the √T checkpoints stored during evaluation; both proofs are checked."
    :api="[
      'evaluate',
      'pietrzakProve',
      'pietrzakVerify',
      'wesolowskiProve',
      'wesolowskiVerify',
      'pietrzakProveCost',
      'proofToBytes',
    ]"
  >
    <template #controls>
      <UFormField
        label="Sequential squarings T"
        size="sm"
        :description="`2${superscript(exponent)} = ${fmtNum(T, { digits: 0 })} squarings`"
        class="w-full sm:w-64"
      >
        <USlider v-model="exponent" :min="T_MIN_EXPONENT" :max="T_MAX_EXPONENT" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="Modulus" size="sm" class="w-full sm:w-72">
        <USelect v-model="modulusId" :items="MODULUS_ITEMS" class="w-full" />
      </UFormField>
      <USwitch v-model="plain" size="sm" label="also prove without checkpoints" class="pb-2" />
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Run the pipeline"
        busy-label="Squaring…"
        :hint="
          task.busy.value
            ? phase
            : `≈ ${fmtNum(workEstimate, { digits: 0 })} modular squarings in a Web Worker · input from ${sourceSummary().label}`
        "
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <p class="text-xs text-muted">
        {{ MODULUS_META[modulusId].note }}
      </p>

      <div v-if="!result" class="rounded-md border border-dashed border-default px-3 py-6 text-center text-sm text-muted">
        Nothing has been squared yet. At T = {{ fmtNum(T, { digits: 0 }) }} the proof will carry
        {{ rounds }} midpoints and the prover will do
        {{ fmtNum(costCk, { digits: 0 }) }} squarings with checkpoints instead of
        {{ fmtNum(costPlain, { digits: 0 }) }} without.
      </div>

      <template v-else>
        <UAlert
          v-if="stale"
          color="warning"
          variant="subtle"
          icon="i-lucide-refresh-cw"
          title="These numbers are from the previous settings"
          :description="`Shown: T = ${fmtNum(result.T, { digits: 0 })} at ${MODULUS_META[result.modulusId].short}. Run again to match the controls.`"
        />

        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="evaluate"
            :value="fmtDuration(result.evalMs)"
            tone="primary"
            :note="`${fmtNum(result.T, { digits: 0 })} sequential squarings — the delay itself`"
          />
          <StatTile
            label="Pietrzak verify"
            :value="fmtDuration(result.pietrzak.verifyMs)"
            :tone="result.pietrzak.ok ? 'success' : 'error'"
            :note="`${2 * result.rounds} exponentiations with 128-bit exponents → ${result.pietrzak.ok}`"
          />
          <StatTile
            label="Wesolowski verify"
            :value="fmtDuration(result.wesolowski.verifyMs)"
            :tone="result.wesolowski.ok ? 'success' : 'error'"
            :note="`one hash-to-prime + two exponentiations → ${result.wesolowski.ok}`"
          />
          <StatTile
            label="measured squarings/s"
            :value="result.evalSquaringsPerSecond"
            :digits="0"
            note="this browser, this modulus — not the adversary's hardware"
          />
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              What each call cost and what it returned
            </caption>
            <thead class="text-xs uppercase tracking-wide text-muted">
              <tr class="border-b border-default">
                <th scope="col" class="py-1.5 text-left font-medium">Call</th>
                <th scope="col" class="py-1.5 text-right font-medium">Work</th>
                <th scope="col" class="py-1.5 text-right font-medium">Time</th>
                <th scope="col" class="py-1.5 text-left font-medium ps-4">Result</th>
              </tr>
            </thead>
            <tbody class="tabular-nums">
              <tr class="border-b border-default/60">
                <td class="py-1.5 font-mono text-xs text-highlighted">evaluate</td>
                <td class="py-1.5 text-right font-mono">{{ fmtNum(result.T, { digits: 0 }) }} sq</td>
                <td class="py-1.5 text-right font-mono">{{ fmtDuration(result.evalMs) }}</td>
                <td class="py-1.5 ps-4 text-xs text-muted">
                  y = <span class="font-mono">{{ ellipsizeHex(result.yHex) }}</span>
                </td>
              </tr>
              <tr v-if="result.pietrzak.proveMs !== null" class="border-b border-default/60">
                <td class="py-1.5 font-mono text-xs text-highlighted">pietrzakProve</td>
                <td class="py-1.5 text-right font-mono">{{ fmtNum(result.costPlain, { digits: 0 }) }} sq</td>
                <td class="py-1.5 text-right font-mono">{{ fmtDuration(result.pietrzak.proveMs) }}</td>
                <td class="py-1.5 ps-4 text-xs text-muted">{{ result.rounds }} midpoints, no checkpoints</td>
              </tr>
              <tr class="border-b border-default/60">
                <td class="py-1.5 font-mono text-xs text-highlighted">pietrzakProve +ck</td>
                <td class="py-1.5 text-right font-mono">{{ fmtNum(result.costCk, { digits: 0 }) }} sq</td>
                <td class="py-1.5 text-right font-mono">{{ fmtDuration(result.pietrzak.proveCkMs) }}</td>
                <td class="py-1.5 ps-4 text-xs text-muted">
                  <span v-if="result.pietrzak.identical === true" class="text-success">byte-identical proof</span>
                  <span v-else-if="result.pietrzak.identical === false" class="text-error">proofs differ — report this</span>
                  <span v-else>{{ result.checkpoints }} stored powers, interval {{ fmtNum(result.interval, { digits: 0 }) }}</span>
                </td>
              </tr>
              <tr class="border-b border-default/60">
                <td class="py-1.5 font-mono text-xs text-highlighted">pietrzakVerify</td>
                <td class="py-1.5 text-right font-mono">{{ 2 * result.rounds }} exp</td>
                <td class="py-1.5 text-right font-mono">{{ fmtDuration(result.pietrzak.verifyMs) }}</td>
                <td class="py-1.5 ps-4 text-xs" :class="result.pietrzak.ok ? 'text-success' : 'text-error'">
                  {{ result.pietrzak.ok }} · {{ fmtBytes(result.pietrzak.bytes) }} proof
                </td>
              </tr>
              <tr v-if="result.wesolowski.proveMs !== null" class="border-b border-default/60">
                <td class="py-1.5 font-mono text-xs text-highlighted">wesolowskiProve</td>
                <td class="py-1.5 text-right font-mono">
                  {{ fmtNum(result.T, { digits: 0 }) }} sq + {{ fmtNum(Math.round(result.T / 8), { digits: 0 }) }} mul
                </td>
                <td class="py-1.5 text-right font-mono">{{ fmtDuration(result.wesolowski.proveMs) }}</td>
                <td class="py-1.5 ps-4 text-xs text-muted">windowed long division in the exponent</td>
              </tr>
              <tr class="border-b border-default/60">
                <td class="py-1.5 font-mono text-xs text-highlighted">wesolowskiProve +ck</td>
                <td class="py-1.5 text-right font-mono">bucket multi-exp</td>
                <td class="py-1.5 text-right font-mono">{{ fmtDuration(result.wesolowski.proveCkMs) }}</td>
                <td class="py-1.5 ps-4 text-xs text-muted">
                  <span v-if="result.wesolowski.identical === true" class="text-success">identical π</span>
                  <span v-else>π from the stored powers</span>
                </td>
              </tr>
              <tr>
                <td class="py-1.5 font-mono text-xs text-highlighted">wesolowskiVerify</td>
                <td class="py-1.5 text-right font-mono">2 exp</td>
                <td class="py-1.5 text-right font-mono">{{ fmtDuration(result.wesolowski.verifyMs) }}</td>
                <td class="py-1.5 ps-4 text-xs" :class="result.wesolowski.ok ? 'text-success' : 'text-error'">
                  {{ result.wesolowski.ok }} · {{ fmtBytes(result.wesolowski.bytes) }} proof
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <BarChart
          v-if="timings"
          :categories="timings.map((t) => t.label)"
          :values="timings.map((t) => t.ms)"
          y-label="milliseconds"
          aria-label="measured time per call"
          :format="(v) => fmtDuration(v)"
          :height="220"
        />

        <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
          <UBadge color="neutral" variant="subtle" class="font-mono">x = {{ ellipsizeHex(result.xHex, 12, 6) }}</UBadge>
          <UBadge color="neutral" variant="subtle" class="font-mono">ℓ = {{ ellipsizeHex(result.wesolowski.ellHex, 12, 6) }}</UBadge>
          <UBadge v-if="inputHex" color="neutral" variant="outline" class="font-mono">input {{ inputHex }}</UBadge>
          <span v-if="verifySpeedup">
            verification was {{ fmtNum(verifySpeedup, { digits: 1 }) }}× faster than the delay
          </span>
        </div>
      </template>

      <VdfPipelineCost :exponent="exponent" :result="result" />

      <CodeSnippet :code="code" title="what the Run button ran" />

      <HonestNote variant="exact">
        The squaring counts, the round count ⌈log₂ T⌉ and the proof sizes are exact and computed by
        the package (<code>pietrzakProveCost</code>, <code>pietrzakRounds</code>). The milliseconds
        are not: they are this browser, this tab, this modulus, with a JIT warming up. Read them as
        ratios, never as a wall-clock guarantee.
      </HonestNote>
    </div>

    <template #footer>
      Both proofs certify the same statement y = |x^(2^T)|. Pietrzak's needs only that the group has
      no low-order elements; Wesolowski's is 526 bytes at 2048 bits for any T but rests on the
      stronger adaptive root assumption.
    </template>
  </DemoSection>
</template>
