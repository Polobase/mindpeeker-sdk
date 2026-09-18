<script setup lang="ts">
/**
 * Tab 3 — broadcast: modulate a live entropy stream by a target rate, tally the
 * 1-in-6765 "resonance", and return a verifiable v2 receipt. Nothing is
 * transmitted; this is DSP over an entropy stream plus a hash.
 */
import type {
  BroadcastMode,
  BroadcastReceipt,
  BroadcastTarget,
  ByteSource,
  WitnessKind,
} from '@mindpeeker/scan'
import { broadcast, parseReceipt, serializeReceipt, WITNESS_KINDS } from '@mindpeeker/scan'
import { createYielder } from '~/lib/async'
import { localProvider, provider, restartSource, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum, toHex } from '~/lib/format'
import { failingSource, finiteSource } from '~/lib/scan/sources'
import { BEACON_ROUND_BYTES, shortHash } from '~/lib/scan/stats'

const MODES: { label: string; value: BroadcastMode }[] = [
  { label: 'xor — reversible xorImprint (default)', value: 'xor' },
  { label: 'phase — quantized phaseModulate', value: 'phase' },
  { label: 'mask — the pure rateMask keystream', value: 'mask' },
]
const TARGET_KINDS = [
  { label: 'rate string — "12-33-7"', value: 'rate-string' },
  { label: 'Rate object — { digits, base }', value: 'rate-object' },
  { label: 'witness signature — hashed to a rate', value: 'signature' },
] as const
type TargetKind = (typeof TARGET_KINDS)[number]['value']

const targetKind = ref<TargetKind>('rate-string')
const rateText = ref('12-33-7')
const digitsText = ref('12, 33, 7')
const rateBase = ref(44)
const signatureText = ref('a witness only you can reproduce')
const witnessKind = ref<WitnessKind>('signature')

const mode = ref<BroadcastMode>('xor')
const stopBy = ref<'rounds' | 'duration'>('rounds')
const rounds = ref(64)
const durationMs = ref(1500)
const roundBytes = ref(16)
const resonanceOdds = ref(6765)
const resonanceValue = ref(6764)

watch(resonanceOdds, (odds) => {
  if (resonanceValue.value > odds - 1) resonanceValue.value = odds - 1
})

function buildTarget(): BroadcastTarget {
  if (targetKind.value === 'rate-string') return rateText.value
  if (targetKind.value === 'rate-object') {
    const digits = digitsText.value
      .split(/[^0-9]+/)
      .filter((s) => s.length > 0)
      .map((s) => Number.parseInt(s, 10))
    return { digits, base: rateBase.value }
  }
  return { signature: signatureText.value, kind: witnessKind.value }
}

/** Safety cap in duration mode: `rounds` and `durationMs` together stop at whichever comes first. */
const DURATION_ROUND_CAP = 2048

const source = computed(() => sourceSummary())
const plannedRounds = computed(() => (stopBy.value === 'rounds' ? rounds.value : undefined))
const estimatedBytes = computed(
  () => (plannedRounds.value ?? DURATION_ROUND_CAP) * roundBytes.value,
)
const hint = computed(() => {
  const upTo = plannedRounds.value === undefined ? 'up to ' : '≈ '
  return source.value.network
    ? `${upTo}${fmtBytes(estimatedBytes.value)} from ${source.value.label} — about ${Math.ceil(estimatedBytes.value / BEACON_ROUND_BYTES)} beacon rounds, one fetch each.`
    : `${upTo}${fmtBytes(estimatedBytes.value)} from ${source.value.providerName}`
})

// live counters, updated while the generator runs
const liveRounds = ref(0)
const liveResonances = ref(0)
const lastModulated = shallowRef<Uint8Array>()

/** Rounds actually emitted so far (or planned, before a run) over the stated odds. */
const expectedResonances = computed(
  () => (liveRounds.value || plannedRounds.value || 0) / Math.max(1, resonanceOdds.value),
)
const byteCounts = shallowRef<number[]>(new Array<number>(256).fill(0))
/** Plain accumulator; the ref above gets a fresh copy so the heatmap repaints. */
let rawCounts = new Uint32Array(256)

interface Outcome {
  receipt: BroadcastReceipt
  line: string
  roundTrips: boolean
  sourceName: string
}
const task = useTask<Outcome>()
const injectTask = useTask<void>()
const outcome = computed(() => task.result.value)
const busy = computed(() => task.busy.value || injectTask.busy.value)
const injected = ref<{ label: string; error?: unknown; receipt?: BroadcastReceipt }>()

async function runBroadcast(
  byteSource: ByteSource,
  signal: AbortSignal,
  setProgress: (p: number | null) => void,
  collect: boolean,
): Promise<{ receipt: BroadcastReceipt; sourceName: string }> {
  const tick = createYielder(8, signal)
  const limit = plannedRounds.value
  const run = broadcast(buildTarget(), byteSource, {
    mode: mode.value,
    ...(limit !== undefined
      ? { rounds: limit }
      : { durationMs: durationMs.value, rounds: DURATION_ROUND_CAP }),
    roundBytes: roundBytes.value,
    resonanceOdds: resonanceOdds.value,
    resonanceValue: resonanceValue.value,
    signal,
  })
  const started = performance.now()
  let step = await run.next()
  while (!step.done) {
    const value = step.value
    if (collect) {
      liveRounds.value = value.round + 1
      if (value.resonance) liveResonances.value += 1
      lastModulated.value = value.modulated
      for (const byte of value.modulated) rawCounts[byte] = (rawCounts[byte] as number) + 1
      byteCounts.value = Array.from(rawCounts)
      setProgress(
        limit === undefined
          ? Math.min(1, (performance.now() - started) / durationMs.value)
          : (value.round + 1) / limit,
      )
    }
    await tick()
    step = await run.next()
  }
  return { receipt: step.value, sourceName: byteSource.name }
}

function go(): void {
  injected.value = undefined
  liveRounds.value = 0
  liveResonances.value = 0
  lastModulated.value = undefined
  rawCounts = new Uint32Array(256)
  byteCounts.value = new Array<number>(256).fill(0)
  void task.run(async (signal, setProgress) => {
    restartSource()
    const { receipt, sourceName } = await runBroadcast(provider, signal, setProgress, true)
    const line = serializeReceipt(receipt)
    return { receipt, line, roundTrips: serializeReceipt(parseReceipt(line)) === line, sourceName }
  })
}

/** A device that fails mid-stream must reject, never return a short receipt. */
function injectFailure(): void {
  injected.value = undefined
  void injectTask.run(async (signal, setProgress) => {
    try {
      await runBroadcast(
        failingSource(localProvider, roundBytes.value * 3),
        signal,
        setProgress,
        false,
      )
      injected.value = {
        label: 'failing source',
        error: new Error('the broadcast returned a receipt — that is a bug, not a feature'),
      }
    } catch (error) {
      injected.value = { label: 'failing source', error }
    }
  })
}

/** A source that *ends* finishes cleanly — with a shorter receipt. */
function injectEnding(): void {
  injected.value = undefined
  void injectTask.run(async (signal, setProgress) => {
    const { receipt } = await runBroadcast(
      finiteSource(localProvider, roundBytes.value * 5),
      signal,
      setProgress,
      false,
    )
    injected.value = { label: 'source that ends', receipt }
  })
}

const heatmapMax = computed(() => Math.max(1, ...byteCounts.value))
const hexPreview = computed(() =>
  lastModulated.value ? toHex(lastModulated.value, { max: 16 }) : '—',
)

const snippet = computed(
  () => `import { broadcast, parseReceipt, serializeReceipt } from '@mindpeeker/scan'

const run = broadcast(${
    targetKind.value === 'rate-string'
      ? `'${rateText.value}'`
      : targetKind.value === 'rate-object'
        ? `{ digits: [${digitsText.value.split(/[^0-9]+/).filter(Boolean).join(', ')}], base: ${rateBase.value} }`
        : `{ signature: ${JSON.stringify(signatureText.value)}, kind: '${witnessKind.value}' }`
  }, source, {
  mode: '${mode.value}',
  ${stopBy.value === 'rounds' ? `rounds: ${rounds.value},` : `durationMs: ${durationMs.value},`}
  roundBytes: ${roundBytes.value},
  resonanceOdds: ${resonanceOdds.value}, resonanceValue: ${resonanceValue.value},
})

let step = await run.next()
while (!step.done) {
  // step.value: { round, resonance, modulated }
  step = await run.next()
}
const receipt = step.value                       // BroadcastReceipt v2
const line = serializeReceipt(receipt)           // canonical JSONL
serializeReceipt(parseReceipt(line)) === line    // true — byte-exact round trip`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="scan-broadcast"
      title="1 · Modulate a stream by a target"
      description="Each round pulls roundBytes bytes and rewrites them by the rate as one continuous stream. In xor mode the concatenated ticks equal xorImprint(rawStream, rate), so one inverse pass recovers the raw bytes."
      :api="['broadcast', 'BroadcastTick', 'BroadcastTarget', 'signatureToRate', 'WITNESS_KINDS']"
    >
      <template #controls>
        <RunControls
          :busy="busy"
          :progress="task.progress.value"
          :label="stopBy === 'rounds' ? `Broadcast ${rounds} rounds` : `Broadcast ${durationMs} ms`"
          busy-label="Broadcasting…"
          :hint="hint"
          @run="go"
          @cancel="
            () => {
              task.cancel()
              injectTask.cancel()
            }
          "
        >
          <UButton
            variant="soft"
            color="neutral"
            icon="i-lucide-unplug"
            :disabled="busy"
            @click="injectFailure"
          >
            Inject a failing source
          </UButton>
          <UButton
            variant="soft"
            color="neutral"
            icon="i-lucide-square-dashed-bottom"
            :disabled="busy"
            @click="injectEnding"
          >
            Inject a source that ends
          </UButton>
        </RunControls>
      </template>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UFormField label="Target kind" class="sm:col-span-2 lg:col-span-1">
          <USelect v-model="targetKind" :items="TARGET_KINDS" class="w-full" />
        </UFormField>
        <UFormField
          v-if="targetKind === 'rate-string'"
          label="Rate string"
          help="parsed with parseRate; '3.14' also parses, as rate 3-14"
          class="sm:col-span-2"
        >
          <UInput v-model="rateText" class="w-full font-mono" />
        </UFormField>
        <template v-else-if="targetKind === 'rate-object'">
          <UFormField label="Digits" help="validated with rate's own checks before any byte is read">
            <UInput v-model="digitsText" class="w-full font-mono" />
          </UFormField>
          <UFormField label="Base">
            <UInputNumber v-model="rateBase" :min="2" :max="1000" class="w-full" />
          </UFormField>
        </template>
        <template v-else>
          <UFormField label="Witness signature" help="NFC-normalized, SHA-256 → rate; never sent anywhere">
            <UInput v-model="signatureText" class="w-full" />
          </UFormField>
          <UFormField label="Witness kind" help="recorded as metadata; it never changes the rate">
            <USelect v-model="witnessKind" :items="[...WITNESS_KINDS]" class="w-full" />
          </UFormField>
        </template>

        <UFormField label="Modulation mode" class="sm:col-span-2">
          <USelect v-model="mode" :items="MODES" class="w-full" />
        </UFormField>
        <UFormField label="Stop by">
          <USelect
            v-model="stopBy"
            :items="[
              { label: 'rounds', value: 'rounds' },
              { label: 'duration', value: 'duration' },
            ]"
            class="w-full"
          />
        </UFormField>
        <UFormField v-if="stopBy === 'rounds'" label="rounds">
          <UInputNumber v-model="rounds" :min="0" :max="5000" :step="16" class="w-full" />
        </UFormField>
        <UFormField v-else label="durationMs" :help="`also capped at ${DURATION_ROUND_CAP} rounds`">
          <UInputNumber v-model="durationMs" :min="100" :max="20000" :step="250" class="w-full" />
        </UFormField>
        <UFormField label="roundBytes" help="must hold one resonance draw">
          <UInputNumber v-model="roundBytes" :min="1" :max="4096" class="w-full" />
        </UFormField>
        <UFormField label="resonanceOdds" help="AetherOne: 6765 (Fibonacci)">
          <UInputNumber v-model="resonanceOdds" :min="1" :max="100000" class="w-full" />
        </UFormField>
        <UFormField label="resonanceValue" help="default: the top value">
          <UInputNumber v-model="resonanceValue" :min="0" :max="resonanceOdds - 1" class="w-full" />
        </UFormField>
      </div>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
      <ErrorAlert :err="injectTask.error.value" @dismiss="injectTask.reset()" />

      <div class="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="rounds emitted" :value="liveRounds" :digits="0" size="sm" note="live tick counter" />
        <StatTile
          label="resonances"
          :value="liveResonances"
          :digits="0"
          size="sm"
          :tone="liveResonances > 0 ? 'primary' : 'neutral'"
          :note="`expected ${fmtNum(expectedResonances, { digits: 4 })} at 1/${resonanceOdds}`"
        />
        <StatTile label="bytes modulated" :value="fmtBytes(liveRounds * roundBytes)" size="sm" note="one continuous stream" />
        <StatTile label="last round (hex)" size="sm">
          <template #value>
            <span class="text-sm">{{ hexPreview }}</span>
          </template>
          <template #note>first 16 bytes after modulation</template>
        </StatTile>
      </div>

      <div v-if="liveRounds > 0" class="mt-4">
        <HeatmapCanvas
          :data="byteCounts"
          :rows="16"
          :cols="16"
          :min="0"
          :max="heatmapMax"
          row-label="high nibble"
          col-label="low nibble"
          :height="200"
          aria-label="Byte-value counts of the modulated output, 16 by 16"
          :format="(v) => `${Math.round(v)} bytes`"
        />
        <p class="mt-1 text-xs text-muted">
          XOR by a rate mask is a bijection on bytes, so a uniform input stays uniform: a flat map
          here says the modulation destroyed nothing, not that the broadcast "worked".
        </p>
      </div>

      <template #footer>
        The "resonance" is a labelled random event with a stated rate — <code class="font-mono">uniformInt(round, {{ resonanceOdds }})</code>
        over the round's own bytes hitting {{ resonanceValue }} — not a detected wave. Set
        resonanceOdds to something small (20, say) to watch the tally move at its stated rate.
      </template>
    </DemoSection>

    <DemoSection
      v-if="outcome"
      id="scan-receipt"
      title="2 · The receipt"
      description="A v2 JSONL line with fixed key order: it round-trips byte-exact through parseReceipt, and its outputHash is the SHA-256 of every modulated byte, so a replay from recorded raw bytes can be verified rather than trusted."
      :api="['BroadcastReceipt', 'serializeReceipt', 'parseReceipt']"
    >
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="rounds" :value="outcome.receipt.rounds" :digits="0" size="sm" />
        <StatTile
          label="resonances"
          :value="outcome.receipt.resonances"
          :digits="0"
          size="sm"
          :note="`${fmtNum((outcome.receipt.rounds || 1) / Math.max(1, resonanceOdds), { digits: 4 })} expected`"
        />
        <StatTile label="bytesConsumed" :value="fmtBytes(outcome.receipt.bytesConsumed)" size="sm" />
        <StatTile
          label="outputHash"
          :value="shortHash(outcome.receipt.outputHash, 12)"
          size="sm"
          tone="primary"
          note="SHA-256 of all modulated bytes"
        />
        <StatTile label="target" :value="outcome.receipt.target" size="sm" note="formatRate of the resolved rate" />
        <StatTile label="mode" :value="outcome.receipt.mode ?? '—'" size="sm" note="v2 field" />
        <StatTile
          label="witnessKind"
          :value="outcome.receipt.witnessKind ?? 'none'"
          size="sm"
          note="a rate-string target carries none"
        />
        <StatTile
          label="witnessHash"
          :value="shortHash(outcome.receipt.witnessHash, 12)"
          size="sm"
          note="SHA-256 of the NFC signature"
        />
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <UBadge
          :color="outcome.roundTrips ? 'success' : 'error'"
          variant="subtle"
          :icon="outcome.roundTrips ? 'i-lucide-check' : 'i-lucide-x'"
        >
          serializeReceipt(parseReceipt(line)) === line
        </UBadge>
        <UBadge color="neutral" variant="outline" class="font-mono">{{ outcome.sourceName }}</UBadge>
      </div>

      <CodeSnippet :code="outcome.line" lang="json" title="the receipt line" />

      <HonestNote variant="caveat">
        This is deterministic signal processing over an entropy stream plus a reproducibility
        receipt — nothing more. No transmission, no action-at-a-distance, and no physical effect on
        any subject is claimed or occurs. Practitioner literature itself calls "broadcasting" a
        misnomer, since no radio technology is involved.
      </HonestNote>
    </DemoSection>

    <DemoSection
      v-if="injected"
      id="scan-broadcast-errors"
      title="3 · A failing source is not a short receipt"
      description="Only a source that ends finishes a broadcast cleanly. A source that fails — a health-test alarm from a stuck ESP32, an I/O error — rejects with ScanError('source_error') carrying the provider's own error as cause."
      :api="['ScanError', 'source_error', 'insufficient_entropy']"
    >
      <ErrorAlert
        v-if="injected.error"
        :err="injected.error"
        :dismissible="false"
        title="ScanError (source_error) — and no receipt at all"
      />
      <div v-if="injected.receipt" class="flex flex-col gap-2">
        <UAlert
          color="success"
          variant="subtle"
          icon="i-lucide-check"
          title="A source that ends finishes cleanly"
          :description="`The stream ran dry after ${roundBytes * 5} bytes, so the broadcast stopped at ${injected.receipt.rounds} rounds and still returned a full receipt. A partial final round is discarded, though its bytes still count in bytesConsumed.`"
        />
        <CodeSnippet :code="serializeReceipt(injected.receipt)" lang="json" title="the short but honest receipt" />
      </div>
      <HonestNote variant="fixed-in-0.2">
        In 0.1 a source failure produced a shortened, clean-looking receipt — indistinguishable from
        an honest early stop. 0.2.0 makes that a rejection, and rejects an invalid
        <code class="font-mono">resonanceOdds</code>/<code class="font-mono">resonanceValue</code>
        instead of silently never resonating.
      </HonestNote>
    </DemoSection>

    <DemoSection title="The code behind this tab" :api="['@mindpeeker/scan']">
      <CodeSnippet :code="snippet" title="what the Broadcast button runs" />
      <template #footer>
        The stream is closed when the broadcast completes, fails, is aborted, or the consumer stops
        early (<code class="font-mono">break</code> / <code class="font-mono">return()</code>) —
        so Cancel really does release a serial port or a camera track.
      </template>
    </DemoSection>
  </div>
</template>
