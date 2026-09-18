<script setup lang="ts">
import {
  circularMean,
  phaseModulate,
  radiansToDegrees,
  ratePhases,
  resultantLength,
  TAU,
} from '@mindpeeker/rate'
import { getBytes, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum } from '~/lib/format'
import { collectPhases } from '~/lib/rate/sampling'
import { parsedRate } from '~/lib/rate/state'

/** phaseModulate: every byte becomes a phasor, rotated by its ring's angle. */

interface RingStat {
  ring: number
  digit: number
  ringAngleDeg: number
  samples: number
  R: number
  meanDeg: number
}

interface PhaseResult {
  length: number
  source: string
  phases: Float64Array
  rings: RingStat[]
  chanceScale: number
}

const sizeChoice = ref('1024')
const sizeItems = [
  { label: '256 bytes', value: '256' },
  { label: '1 KiB', value: '1024' },
  { label: '4 KiB', value: '4096' },
]
const probeByte = ref(0)

const task = useTask<PhaseResult>()
const result = computed(() => task.result.value)
const hint = computed(() => `${fmtBytes(Number(sizeChoice.value))} from ${sourceSummary().label}`)
const uniformDensity = () => 1 / TAU

function start(): void {
  const rate = parsedRate.value
  if (!rate) return
  void task.run(async (signal, setProgress) => {
    const length = Number(sizeChoice.value)
    const rings = rate.digits.length
    setProgress(0)
    const bytes = await getBytes(length, { signal })
    setProgress(0.4)
    const phases = await collectPhases(phaseModulate(bytes, rate, { signal }), length, signal)
    setProgress(0.8)

    const ringAngles = ratePhases(rate)
    const ringStats: RingStat[] = rate.digits.map((digit, k) => {
      const count = Math.max(0, Math.ceil((length - k) / rings))
      const slice = new Float64Array(count)
      for (let i = 0; i < count; i++) slice[i] = phases[k + i * rings] as number
      const R = count > 0 ? resultantLength(slice) : Number.NaN
      return {
        ring: k + 1,
        digit,
        ringAngleDeg: radiansToDegrees((ringAngles[k] as number) ?? 0),
        samples: count,
        R,
        meanDeg: count > 0 ? radiansToDegrees(circularMean(slice)) : Number.NaN,
      }
    })
    const perRing = Math.floor(length / rings)
    setProgress(1)
    return {
      length,
      source: sourceSummary().providerName,
      phases,
      rings: ringStats,
      // Rayleigh mean for m uniform angles: E[R̄] ≈ ½√(π/m).
      chanceScale: 0.5 * Math.sqrt(Math.PI / Math.max(1, perRing)),
    }
  })
}

// --- the constant-byte probe: an exact identity, not a measurement ------------
interface ProbeRow {
  ring: number
  digit: number
  got: number
  expected: number
  delta: number
}

const probe = shallowRef<{ rows: ProbeRow[]; maxDelta: number } | undefined>()
const probeError = shallowRef<unknown>()
let probeToken = 0

watch(
  [parsedRate, probeByte],
  () => {
    const rate = parsedRate.value
    const token = ++probeToken
    if (!rate) {
      probe.value = undefined
      return
    }
    const byte = Math.min(255, Math.max(0, Math.round(probeByte.value || 0)))
    const rings = rate.digits.length
    const input = new Uint8Array(rings * 2).fill(byte)
    const ringAngles = ratePhases(rate)
    void (async () => {
      try {
        // A buffer input yields one chunk immediately — no I/O, nothing to abort.
        const phases = await collectPhases(phaseModulate(input, rate), input.length)
        if (token !== probeToken) return
        const rows: ProbeRow[] = rate.digits.map((digit, k) => {
          const expected = ((TAU * byte) / 256 + (ringAngles[k] as number)) % TAU
          const got = phases[k] as number
          return { ring: k + 1, digit, got, expected, delta: Math.abs(got - expected) }
        })
        probe.value = { rows, maxDelta: Math.max(...rows.map((r) => r.delta)) }
        probeError.value = undefined
      } catch (error) {
        if (token !== probeToken) return
        probe.value = undefined
        probeError.value = error
      }
    })()
  },
  { immediate: true },
)

onMounted(() => {
  if (!sourceSummary().network && parsedRate.value) start()
})

// Per-ring statistics are indexed by the rate's rings: a new rate invalidates them.
watch(parsedRate, () => task.reset())

const snippet = computed(
  () => `import { phaseModulate, ratePhases } from '@mindpeeker/rate'

// Every byte b at position j becomes the phasor e^{i·2πb/256} rotated by the
// ring phase for its position: φ_j = (2πb_j/256 + θ_{j mod n}) mod 2π.
for await (const chunk of phaseModulate(bytes, rate, { signal })) {
  // chunk is a Float64Array of phases in [0, 2π), one per input byte
}

// Constant bytes make the identity visible: with byte ${probeByte.value}, the
// phases are exactly the ring angles rotated by 2π·${probeByte.value}/256.
ratePhases(rate)`,
)
</script>

<template>
  <DemoSection
    id="phase"
    title="Modulation — phase"
    description="The same rate read as a rotation: each byte is a point on the unit circle, turned by the angle of the ring its position falls on. Deterministic, and invisible in a uniform stream — which is the honest part."
    :api="['phaseModulate', 'ratePhases', 'resultantLength', 'circularMean']"
  >
    <template #controls>
      <UFormField label="Bytes to modulate" class="w-40">
        <USelect v-model="sizeChoice" :items="sizeItems" class="w-full" />
      </UFormField>
      <UFormField label="Probe byte" hint="0..255, no entropy needed" class="w-36">
        <UInputNumber v-model="probeByte" :min="0" :max="255" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!parsedRate"
        label="Modulate real bytes"
        :hint="hint"
        @run="start"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
      <ErrorAlert :err="probeError" :dismissible="false" title="Probe failed" />

      <div v-if="probe" class="rounded-md border border-default bg-elevated/40 p-3">
        <p class="text-xs uppercase tracking-wide text-dimmed">
          Constant-byte probe — the ring angles, exactly
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full min-w-[28rem] text-sm">
            <caption class="sr-only">
              Modulated phase of a constant byte against the closed form
            </caption>
            <thead>
              <tr class="text-xs uppercase text-dimmed">
                <th scope="col" class="py-1.5 pr-3 text-left font-medium">Ring</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Digit</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">phaseModulate</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">2πb/256 + θ_k</th>
                <th scope="col" class="py-1.5 pl-3 text-right font-medium">|Δ|</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in probe.rows" :key="row.ring" class="border-t border-default">
                <td class="py-1.5 pr-3 text-muted">#{{ row.ring }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-highlighted">{{ row.digit }}</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ fmtNum(row.got, { digits: 6 }) }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted">
                  {{ fmtNum(row.expected, { digits: 6 }) }}
                </td>
                <td class="py-1.5 pl-3 text-right font-mono" :class="row.delta === 0 ? 'text-success' : 'text-warning'">
                  {{ row.delta === 0 ? '0' : fmtNum(row.delta, { digits: 2, exponential: true }) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-xs text-muted">
          Largest disagreement over all rings:
          <span class="font-mono">{{
            probe.maxDelta === 0 ? '0' : fmtNum(probe.maxDelta, { digits: 2, exponential: true })
          }}</span
          >. Set the probe byte to 0 and the phases <em>are</em> the ring angles; raise it and every
          ring turns by the same 2πb/256. Modulation is a rotation — it adds nothing to the stream.
        </p>
      </div>

      <template v-if="result">
        <Histogram
          :values="result.phases"
          :bins="36"
          density
          :domain="[0, TAU]"
          :reference="uniformDensity"
          reference-label="uniform density 1/2π"
          x-label="modulated phase (radians)"
          y-label="density"
          :height="240"
          aria-label="Distribution of modulated phases against the uniform density"
        />

        <div class="overflow-x-auto">
          <table class="w-full min-w-[32rem] text-sm">
            <caption class="sr-only">
              Circular statistics of the modulated phases, per ring
            </caption>
            <thead>
              <tr class="text-xs uppercase text-dimmed">
                <th scope="col" class="py-1.5 pr-3 text-left font-medium">Ring</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Digit</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Ring angle</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Bytes</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">R̄ of phases</th>
                <th scope="col" class="py-1.5 pl-3 text-right font-medium">mean direction</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in result.rings" :key="row.ring" class="border-t border-default">
                <td class="py-1.5 pr-3 text-muted">#{{ row.ring }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-highlighted">{{ row.digit }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted">
                  {{ fmtNum(row.ringAngleDeg, { digits: 2 }) }}°
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-muted">{{ fmtNum(row.samples) }}</td>
                <td class="px-3 py-1.5 text-right font-mono">{{ fmtNum(row.R, { digits: 4 }) }}</td>
                <td class="py-1.5 pl-3 text-right font-mono text-muted">
                  {{ fmtNum(row.meanDeg, { digits: 1 }) }}°
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <StatTile
            label="chance scale for R̄"
            :value="result.chanceScale"
            :digits="4"
            note="½√(π/m) — where R̄ lands for m uniform phases per ring"
            size="sm"
          />
          <AccountingBadge :bytes-consumed="result.length" :source="result.source" />
        </div>
        <p class="text-sm text-muted">
          Every ring's R̄ sits near that scale and its mean direction wanders: with uniform bytes the
          ring angle is not recoverable from the modulated phases, because a uniform phasor rotated
          by a constant is still uniform. Read a large R̄ here as "the source is not uniform", never
          as "the rate came through".
        </p>
      </template>

      <p v-else-if="!task.busy.value && parsedRate" class="text-sm text-muted">
        Press Run to modulate real bytes with this rate. The probe above needs no entropy and
        updates as you type; editing the rate clears the measured run.
      </p>

      <HonestNote variant="caveat" title="What the phases can and cannot tell you">
        <code class="font-mono">phaseModulate</code> is a deterministic re-labelling: same bytes plus
        same rate always give the same phases, and the map is invertible given the rate. It does not
        stamp the rate onto the stream in any detectable way, it does not condition, filter or
        improve the entropy, and no result on this card is evidence for or against any radionic
        claim.
      </HonestNote>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <template #footer>
      Phases are returned per chunk as <code class="font-mono">Float64Array</code>s in [0, 2π),
      preserving the input's chunk boundaries, and the ring index keeps counting across chunks, so a
      streamed run and a buffered run of the same bytes agree exactly.
    </template>
  </DemoSection>
</template>
