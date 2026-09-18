<script setup lang="ts">
/**
 * Section 4 — sealing a beacon pulse and shipping the seal as bytes.
 *
 * `sealBeacon` evaluates and proves in one monotone progress sequence;
 * `sealToBytes` makes the result self-describing (version, modulus fingerprint,
 * SHA-256 of the pulse, T, y, midpoints) and `verifySealBytes` checks the digest
 * before it spends any group arithmetic. Then the section breaks it four ways.
 */
import { fmtBytes, fmtDuration, fmtNum, toHex } from '~/lib/format'
import type { ModulusId, SealResult } from '~/lib/vdf/jobs'
import { ellipsizeHex, MODULUS_META, superscript } from '~/lib/vdf/jobs'
import type { Pulse, PulseId } from '~/lib/vdf/pulse'
import { fetchPulse, PULSE_OPTIONS, QUICKNET_CHAIN, RECORDED_CAPTURED_AT } from '~/lib/vdf/pulse'
import { runVdfJob } from '~/lib/vdf/worker-client'

const pulseId = ref<PulseId>('drand-live')
const exponent = ref(13)
const modulusId = ref<ModulusId>('rsa2048')
const tamperOffset = ref(46)
const showFullHex = ref(false)
const phase = ref<string>()
const pulse = shallowRef<Pulse>()

const task = useTask<SealResult>()

const T = computed(() => 2 ** exponent.value)
const PULSE_ITEMS = PULSE_OPTIONS.map((p) => ({ label: p.label, value: p.id }))
const MODULUS_ITEMS = Object.values(MODULUS_META).map((m) => ({ label: m.label, value: m.id }))
const pulseNote = computed(
  () => PULSE_OPTIONS.find((p) => p.id === pulseId.value)?.note ?? '',
)

const result = computed(() => task.result.value)
const sealOk = computed(() => result.value?.verifyBytes === true && result.value?.verifyObject === true)
const tamperAllRejected = computed(() => {
  const cases = result.value?.tampers ?? []
  return cases.length > 0 && cases.every((c) => c.verified !== true)
})

const pulseHex = computed(() =>
  pulse.value ? toHex(pulse.value.bytes, { sep: '' }) : undefined,
)

const roundTime = computed(() => {
  const ts = pulse.value?.timestamp
  return ts === undefined ? undefined : new Date(ts).toISOString().replace('.000', '')
})

const code = computed(
  () => `import { sealBeacon, sealToBytes, sealFromBytes, verifySealBytes } from '@mindpeeker/vdf'

const seal = await sealBeacon(pulse, ${T.value})          // ⌈√T⌉ checkpoints by default
const bytes = sealToBytes(seal, pulse)          // version, fingerprint, SHA-256(pulse), T, y, μ…
await verifySealBytes(pulse, bytes)             // → true

const { pulseDigest } = sealFromBytes(bytes)    // compare before spending group arithmetic
bytes[${tamperOffset.value}] ^= 1
await verifySealBytes(pulse, bytes)             // → false`,
)

async function run(): Promise<void> {
  await task.run(async (signal, setProgress) => {
    setProgress(null)
    phase.value = 'fetching the pulse'
    const got = await fetchPulse(pulseId.value, signal)
    pulse.value = got
    phase.value = 'sealing'
    return await runVdfJob(
      'seal',
      { pulse: got.bytes, T: T.value, modulusId: modulusId.value, tamperOffset: tamperOffset.value },
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
    id="seal"
    title="Sealing a beacon pulse"
    description="Take a published randomness pulse, spend T sequential squarings on it, and ship the result as self-describing bytes. Anyone can then check that the value really is T squarings away from that exact pulse."
    :api="['sealBeacon', 'verifySeal', 'sealToBytes', 'sealFromBytes', 'verifySealBytes']"
  >
    <template #controls>
      <UFormField label="Pulse" size="sm" class="w-full sm:w-80">
        <USelect v-model="pulseId" :items="PULSE_ITEMS" class="w-full" />
      </UFormField>
      <UFormField
        label="Delay T"
        size="sm"
        :description="`2${superscript(exponent)} = ${fmtNum(T, { digits: 0 })} squarings`"
        class="w-full sm:w-56"
      >
        <USlider v-model="exponent" :min="10" :max="16" :step="1" class="mt-2" />
      </UFormField>
      <UFormField label="Modulus" size="sm" class="w-full sm:w-64">
        <USelect v-model="modulusId" :items="MODULUS_ITEMS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Fetch a pulse and seal it"
        busy-label="Sealing…"
        icon="i-lucide-stamp"
        :hint="task.busy.value ? phase : pulseNote"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div v-if="pulse" class="rounded-md border border-default bg-elevated/40 p-3">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <UBadge color="neutral" variant="subtle" class="font-mono">{{ pulse.providerName }}</UBadge>
          <UBadge v-if="pulse.round !== undefined" color="primary" variant="subtle" class="font-mono">
            round {{ fmtNum(pulse.round, { digits: 0 }) }}
          </UBadge>
          <UBadge v-if="roundTime" color="neutral" variant="outline" class="font-mono">{{ roundTime }}</UBadge>
          <UBadge v-if="pulseId === 'drand-taped' || pulse.fellBack" color="warning" variant="subtle">
            recorded {{ RECORDED_CAPTURED_AT }} — not live
          </UBadge>
        </div>
        <p v-if="pulse.fellBack" class="mt-2 text-xs text-warning">
          The live fetch failed ({{ pulse.reason }}), so the recorded round answered instead. Saying
          so is the point: a demo that silently swaps its data source is the failure mode this SDK
          exists to avoid.
        </p>
        <p class="mt-2 break-all font-mono text-xs text-muted">
          pulse {{ pulseHex ? ellipsizeHex(pulseHex, 32, 12) : '—' }}
        </p>
        <p class="mt-1 text-xs text-dimmed">
          chain {{ QUICKNET_CHAIN.beaconId }} · period {{ QUICKNET_CHAIN.period }} s ·
          {{ QUICKNET_CHAIN.scheme }}
        </p>
      </div>

      <div v-if="!result" class="rounded-md border border-dashed border-default px-3 py-6 text-center text-sm text-muted">
        No seal yet. At T = {{ fmtNum(T, { digits: 0 }) }} the seal will be
        {{ fmtNum(46 + MODULUS_META[modulusId].width * (1 + Math.ceil(Math.log2(T))), { digits: 0 }) }}
        bytes, of which 32 are the pulse's SHA-256.
      </div>

      <template v-else>
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="verifySealBytes"
            :value="String(result.verifyBytes)"
            :tone="result.verifyBytes ? 'success' : 'error'"
            :note="`in ${fmtDuration(result.verifyMs)} — against ${fmtDuration(result.sealMs)} to make`"
          />
          <StatTile
            label="verifySeal (object)"
            :value="String(result.verifyObject)"
            :tone="result.verifyObject ? 'success' : 'error'"
            note="same check, before serialization"
          />
          <StatTile
            label="seal size"
            :value="fmtBytes(result.sealLength)"
            :tone="result.sealLength === result.expectedLength ? 'success' : 'warning'"
            :note="`exact: 46 + ${result.width}·(1 + ${result.rounds}) = ${fmtNum(result.expectedLength, { digits: 0 })} bytes`"
          />
          <StatTile
            label="wrong pulse"
            :value="String(result.wrongPulse)"
            :tone="result.wrongPulse ? 'error' : 'success'"
            note="one bit changed in the pulse — caught on the digest, no group arithmetic"
          />
        </div>

        <div class="rounded-md border border-default bg-elevated/30 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs uppercase tracking-wide text-muted">sealToBytes — the whole seal</p>
            <USwitch v-model="showFullHex" size="sm" label="show every byte" />
          </div>
          <pre
            class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-highlighted"
          >{{ showFullHex ? result.sealHex : ellipsizeHex(result.sealHex, 128, 32) }}</pre>
          <dl class="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            <div class="flex gap-2">
              <dt class="w-32 shrink-0 text-muted">version · kind</dt>
              <dd class="font-mono text-highlighted">0x{{ result.sealHex.slice(0, 2) }} · 0x{{ result.sealHex.slice(2, 4) }} ('S')</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-32 shrink-0 text-muted">fingerprint</dt>
              <dd class="font-mono text-highlighted">{{ result.sealHex.slice(4, 20) }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-32 shrink-0 text-muted">SHA-256(pulse)</dt>
              <dd class="font-mono text-highlighted break-all">{{ ellipsizeHex(result.pulseDigestHex, 24, 8) }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-32 shrink-0 text-muted">y</dt>
              <dd class="font-mono text-highlighted break-all">{{ ellipsizeHex(result.yHex, 24, 8) }}</dd>
            </div>
          </dl>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-end gap-3">
            <UFormField label="Byte to flip in the element region" size="sm" class="w-full sm:w-72">
              <UInputNumber
                v-model="tamperOffset"
                :min="result.headerLength"
                :max="result.sealLength - 1"
                :step="1"
                size="sm"
                class="w-full"
              />
            </UFormField>
            <p class="pb-2 text-xs text-muted">
              offsets {{ result.headerLength }}…{{ result.sealLength - 1 }} hold y and the
              {{ result.rounds }} midpoints. Re-run to flip a different one.
            </p>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <caption class="sr-only">
                Four ways to break a seal and what the package answers
              </caption>
              <thead class="text-xs uppercase tracking-wide text-muted">
                <tr class="border-b border-default">
                  <th scope="col" class="py-1.5 text-left font-medium">Tampered</th>
                  <th scope="col" class="py-1.5 text-right font-medium">Offset</th>
                  <th scope="col" class="py-1.5 text-right font-medium">Byte</th>
                  <th scope="col" class="py-1.5 text-left font-medium ps-4">Answer</th>
                </tr>
              </thead>
              <tbody class="tabular-nums">
                <tr v-for="(t, i) in result.tampers" :key="i" class="border-b border-default/60">
                  <td class="py-1.5 text-xs text-highlighted">{{ t.label }}</td>
                  <td class="py-1.5 text-right font-mono text-xs">{{ t.offset }}</td>
                  <td class="py-1.5 text-right font-mono text-xs text-muted">
                    <template v-if="t.after >= 0">
                      {{ t.before.toString(16).padStart(2, '0') }} →
                      {{ t.after.toString(16).padStart(2, '0') }}
                    </template>
                    <template v-else>removed</template>
                  </td>
                  <td class="py-1.5 ps-4 text-xs">
                    <span v-if="t.error" class="font-mono text-warning">
                      {{ t.error.name }} ({{ t.error.code }})
                    </span>
                    <span v-else class="font-mono" :class="t.verified ? 'text-error' : 'text-success'">
                      verifySealBytes → {{ t.verified }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="text-xs text-muted">
            A <em>wrong</em> seal returns false; <em>malformed</em> bytes throw. The parser checks the
            length against the largest possible seal before allocating, then the version
            (<code class="text-primary">unsupported_version</code> — which is what every 0.1.0 proof
            now gets), the kind byte, the modulus fingerprint
            (<code class="text-primary">modulus_mismatch</code>), T ≥ 1, and the exact length.
          </p>
        </div>

        <StatTile
          label="all four tamper cases refused"
          :value="tamperAllRejected && sealOk ? 'yes' : 'CHECK THIS'"
          :tone="tamperAllRejected && sealOk ? 'success' : 'error'"
          size="sm"
          note="an honest seal verifies, every broken one is rejected or throws"
        />
      </template>

      <CodeSnippet :code="code" title="what the Seal button ran" />

      <HonestNote variant="caveat" title="A seal is a lower bound, and only a lower bound">
        <code class="text-primary">sealBeacon(pulse, T)</code> shows that nobody — however parallel,
        however forewarned — could know y earlier than T squarings on the fastest hardware in
        existence <em>after the pulse bytes were fixed</em>. It says nothing about when the pulse was
        fixed, or when y was published. A <strong class="text-highlighted">no-later-than</strong>
        bound needs an external witness: a later beacon round that commits to the seal, a
        transparency-log checkpoint, a timestamping service. And a seal cannot repair a bad beacon:
        if the pulse was predictable, the seal only delays its consumption.
      </HonestNote>
    </div>

    <template #footer>
      The seal consumes pulse <em>bytes</em>, not provider objects — <code class="text-primary">@mindpeeker/vdf</code>
      and <code class="text-primary">@mindpeeker/entropy</code> share no imports, so any beacon
      (drand, NIST, CURBy, a block hash) composes structurally.
    </template>
  </DemoSection>
</template>
