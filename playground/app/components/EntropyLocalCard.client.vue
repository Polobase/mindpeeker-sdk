<script setup lang="ts">
/** One local physical source: start it, watch bytes arrive, see the typed
 * error when the browser or the health tests say no. */
import type { SerialPortLike } from '@mindpeeker/entropy/providers'
import {
  availability,
  blockCost,
  type Conditioning,
  type LocalId,
  localSpec,
  makeLocal,
  requestSerialPort,
} from '~/lib/entropy/local'
import { errorInfo } from '~/lib/errors'
import { fmtBytes, fmtDuration, toHex } from '~/lib/format'

const props = defineProps<{ id: LocalId }>()

const spec = localSpec(props.id)
const avail = availability(props.id)

const BLOCK_TIME: Partial<Record<LocalId, string>> = {
  jitter:
    'one coarse sample costs a 0.5 ms window, so a conditioned 32-byte block takes ≈ 26 s — raw mode releases health-tested samples as soon as the start-up test passes',
  sensor:
    'a 6-axis DeviceMotion event carries 1.5 credited bits, so a conditioned block needs several seconds of actual movement',
  mic: 'at 48 kHz one LSB per sample, 512 raw bytes is ≈ 85 ms of audio',
  camera: 'about 3–4 frames of sign bits after the 10-frame warm-up',
  serial: 'at 921 600 baud, 74 raw bytes arrive in well under a millisecond',
}

const conditioning = ref<Conditioning>(spec.defaultConditioning)
const target = ref(64)
const targets = [32, 64, 256].map((n) => ({ label: `${n} bytes`, value: n }))
const conditioningItems = [
  { label: 'conditioned (SHA-256)', value: 'conditioned' },
  { label: 'raw (health-tested passthrough)', value: 'raw' },
]

const task = useTask<void>()
const bytes = ref(0)
const elapsed = ref(0)
const lastHex = ref('')
const providerName = ref('')
const status = ref<'idle' | 'starting' | 'delivering' | 'done' | 'stopped'>('idle')
const port = shallowRef<SerialPortLike | undefined>(undefined)

const statusLabel = computed(() => {
  switch (status.value) {
    case 'starting':
      return 'start-up test — 1024 raw samples must pass first'
    case 'delivering':
      return 'delivering health-tested bytes'
    case 'done':
      return 'finished'
    case 'stopped':
      return 'stopped'
    default:
      return 'idle'
  }
})

const statusTone = computed(() =>
  status.value === 'delivering' ? 'success' : status.value === 'starting' ? 'warning' : 'neutral',
)

const errorHint = computed(() => {
  const code = errorInfo(task.error.value).code
  if (!task.error.value) return ''
  if (code === 'permission') return 'The browser or you denied access — that is the permission code doing its job.'
  if (code === 'health_test')
    return 'The SP 800-90B tests kept failing: the source is misbehaving, so the provider refuses rather than degrading to pseudo-randomness.'
  if (code === 'timeout')
    return 'The source produced no samples in time (a frozen scene, a silent device) — it starved rather than inventing entropy.'
  if (code === 'invalid_request')
    return 'The provider refused its configuration or this runtime before touching any hardware.'
  return ''
})

async function pickPort(): Promise<void> {
  try {
    port.value = await requestSerialPort()
    start()
  } catch (err) {
    // A cancelled port picker is a DOMException, not an SDK error.
    task.reset()
    status.value = 'idle'
    lastHex.value = ''
    console.info('[entropy] serial port selection cancelled', errorInfo(err).message)
  }
}

function start(): void {
  bytes.value = 0
  elapsed.value = 0
  lastHex.value = ''
  status.value = 'starting'
  void task.run(async (signal, setProgress) => {
    const provider = makeLocal(props.id, conditioning.value, port.value)
    providerName.value = provider.name
    const began = performance.now()
    setProgress(0)
    try {
      for await (const chunk of provider.stream({
        chunkBytes: 32,
        signal,
        timeoutMs: spec.timeoutMs,
      })) {
        status.value = 'delivering'
        bytes.value += chunk.length
        elapsed.value = performance.now() - began
        lastHex.value = toHex(chunk, { sep: ' ', max: 16 })
        setProgress(Math.min(1, bytes.value / target.value))
        if (bytes.value >= target.value) break
      }
      status.value = 'done'
    } catch (error) {
      status.value = 'stopped'
      throw error
    }
  })
}

function stop(): void {
  task.cancel()
  status.value = 'stopped'
}

const rate = computed(() => (elapsed.value > 0 ? (bytes.value * 1000) / elapsed.value : 0))
const needsPort = computed(() => Boolean(spec.needsPort) && !port.value)
</script>

<template>
  <div class="rounded-lg border border-default bg-default/60 p-4 flex flex-col gap-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="flex items-center gap-2 text-sm font-semibold text-highlighted">
          <UIcon :name="spec.icon" class="size-4 text-primary shrink-0" />
          {{ spec.title }}
        </h3>
        <code class="mt-1 block font-mono text-xs text-primary break-all">{{ spec.factory }}</code>
      </div>
      <UBadge size="sm" :color="statusTone" variant="subtle">{{ statusLabel }}</UBadge>
    </div>

    <p class="text-sm text-muted">{{ spec.physics }}</p>

    <div class="flex flex-wrap gap-1.5">
      <UBadge size="sm" color="neutral" variant="subtle">credit {{ spec.h }} b/B</UBadge>
      <UBadge size="sm" color="neutral" variant="subtle">safetyFactor {{ spec.safetyFactor }}</UBadge>
      <UBadge v-if="spec.healthH" size="sm" color="warning" variant="subtle">
        health-tested at {{ spec.healthH }} b/B
      </UBadge>
      <UBadge size="sm" color="neutral" variant="outline">
        {{ blockCost(spec).toLocaleString('en-US') }} raw B per 32-byte block
      </UBadge>
      <UBadge v-if="spec.permission" size="sm" color="warning" variant="subtle">
        asks for {{ spec.permission }}
      </UBadge>
    </div>

    <UAlert
      v-if="!avail.ok"
      color="neutral"
      variant="subtle"
      icon="i-lucide-circle-slash"
      title="Not available in this browser"
      :description="avail.reason"
    />

    <template v-else>
      <div class="flex flex-wrap items-end gap-3">
        <UFormField :label="`Conditioning — ${id}`" size="sm" :ui="{ label: 'sr-only' }">
          <USelect
            v-model="conditioning"
            :items="conditioningItems"
            size="sm"
            class="w-56"
            :disabled="task.busy.value"
            :aria-label="`Conditioning mode for ${spec.title}`"
          />
        </UFormField>
        <UFormField :label="`Collect — ${id}`" size="sm" :ui="{ label: 'sr-only' }">
          <USelect
            v-model="target"
            :items="targets"
            size="sm"
            class="w-28"
            :disabled="task.busy.value"
            :aria-label="`Bytes to collect from ${spec.title}`"
          />
        </UFormField>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          :label="needsPort ? 'Choose a port & start' : 'Start'"
          busy-label="Sampling…"
          :icon="needsPort ? 'i-lucide-usb' : 'i-lucide-play'"
          @run="needsPort ? pickPort() : start()"
          @cancel="stop"
        />
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatTile size="sm" label="Delivered" :value="fmtBytes(bytes)" />
        <StatTile size="sm" label="Elapsed" :value="fmtDuration(elapsed)" />
        <StatTile
          size="sm"
          label="Rate"
          :value="rate > 0 ? `${fmtBytes(rate)}/s` : '—'"
        />
        <StatTile size="sm" label="Provider" :value="providerName || '—'" />
      </div>

      <code v-if="lastHex" class="block font-mono text-[11px] break-all text-highlighted">
        last chunk: {{ lastHex }}
      </code>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
      <p v-if="errorHint" class="text-xs text-warning">{{ errorHint }}</p>
    </template>

    <p v-if="BLOCK_TIME[id]" class="text-xs text-dimmed">
      <UIcon name="i-lucide-timer" class="size-3 inline-block" /> {{ BLOCK_TIME[id] }}
    </p>

    <ul class="text-xs text-muted flex flex-col gap-1">
      <li v-for="note in spec.notes" :key="note" class="flex gap-1.5">
        <UIcon name="i-lucide-dot" class="size-3.5 shrink-0 mt-0.5" />
        <span>{{ note }}</span>
      </li>
    </ul>

    <CodeSnippet :code="spec.snippet" :title="`${spec.title} — minimal code`" />
  </div>
</template>
