<script setup lang="ts">
/**
 * Section 6 — the recording as the paper trail: JSONL v2 with a session
 * header, hash-chained trial lines, a tamper control, and the round trip back
 * to the series an analysis consumes.
 */
import {
  type ChainVerification,
  parseRecordLine,
  readSession,
  recordSession,
  serializeRecordLine,
  type SessionLine,
  type TrialSeries,
  verifyChain,
  ZERO_HASH,
} from '@mindpeeker/psi'
import { drbgSource } from '~/lib/entropy'
import { fmtNum } from '~/lib/format'
import { lockStepClock, sha256Hex, shortHash } from '~/lib/psi/synthetic'

const BITS = 200
const T0 = Date.UTC(2026, 8, 17, 12, 0, 0)

const sourceCount = ref(2)
const rounds = ref(12)
const bindRegistration = ref(true)

type Tamper = 'none' | 'sum' | 'delete' | 'swap'
const tamper = ref<Tamper>('none')
const tamperLine = ref(3)

const TAMPERS: { label: string; value: Tamper }[] = [
  { label: 'none — the lines as recorded', value: 'none' },
  { label: 'edit one trial sum (+1)', value: 'sum' },
  { label: 'delete that line', value: 'delete' },
  { label: 'swap it with the next line', value: 'swap' },
]

interface Session {
  lines: string[]
  genesis: string
}

const task = useTask<Session>()
const session = computed(() => task.result.value)

function record(): void {
  void task.run(async (signal, setProgress) => {
    const n = sourceCount.value
    const total = n * rounds.value + 1
    const genesis = bindRegistration.value
      ? await sha256Hex(`psi playground recording plan / ${n} sources / ${rounds.value} rounds`)
      : ZERO_HASH
    const sources = Array.from({ length: n }, (_, i) =>
      drbgSource(`${currentSeedLabel()} / recorder-${i + 1}`),
    )
    const first = sources[0]?.name
    const lines: string[] = []
    for await (const line of recordSession(sources, {
      bitsPerTrial: BITS,
      chunkBytes: BITS / 8,
      now: lockStepClock(T0, n),
      chain: bindRegistration.value ? { registration: genesis } : true,
      tags: (round, source) => ({
        arm: source === first ? 'experimental' : 'control',
        run: Math.floor(round / 4),
        segment: round < rounds.value / 2 ? 'baseline' : 'event',
      }),
      signal,
    })) {
      lines.push(line)
      setProgress(lines.length / total)
      if (lines.length >= total) break
    }
    return { lines, genesis }
  })
}

const lines = computed(() => session.value?.lines ?? [])

const tamperedLines = computed(() => {
  const source = lines.value
  if (!source.length || tamper.value === 'none') return source
  const index = Math.min(Math.max(1, tamperLine.value), source.length - 1)
  const copy = [...source]
  if (tamper.value === 'delete') {
    copy.splice(index, 1)
    return copy
  }
  if (tamper.value === 'swap') {
    const next = Math.min(index + 1, copy.length - 1)
    ;[copy[index], copy[next]] = [copy[next] as string, copy[index] as string]
    return copy
  }
  const parsed = JSON.parse(copy[index] as string) as { sum: number }
  parsed.sum = parsed.sum >= BITS ? parsed.sum - 1 : parsed.sum + 1
  copy[index] = JSON.stringify(parsed)
  return copy
})

const check = shallowRef<ChainVerification>()
const checkError = ref<unknown>()
const replay = shallowRef<TrialSeries[]>()
const replayError = ref<unknown>()

watch(
  [tamperedLines, () => session.value?.genesis],
  async ([current, genesis]) => {
    if (!current.length || !genesis) {
      check.value = undefined
      replay.value = undefined
      return
    }
    try {
      checkError.value = undefined
      check.value = await verifyChain(
        current,
        genesis === ZERO_HASH ? {} : { registration: genesis },
      )
    } catch (err) {
      check.value = undefined
      checkError.value = err
    }
    try {
      replayError.value = undefined
      replay.value = await readSession(current)
    } catch (err) {
      replay.value = undefined
      replayError.value = err
    }
  },
  { immediate: true },
)

/** The selected line, parsed and re-serialized — canonical encoding is part of the chain. */
const inspected = computed(() => {
  const list = tamperedLines.value
  const index = Math.min(Math.max(0, tamperLine.value), Math.max(0, list.length - 1))
  const raw = list[index]
  if (!raw) return undefined
  try {
    const parsed = parseRecordLine(raw, index + 1)
    const canonical = serializeRecordLine(parsed)
    return {
      index,
      raw,
      parsed: parsed as SessionLine,
      canonical,
      roundTrips: canonical === raw,
      isHeader: 'kind' in parsed,
    }
  } catch (error) {
    return { index, raw, error }
  }
})

const snippet = computed(
  () => `import { readSession, recordSession, verifyChain } from '@mindpeeker/psi'

const lines = []
for await (const line of recordSession([eggA, eggB], {
  chain: { registration: genesis },                 // v2: header + hash-chained trial lines
  tags: (round, source) => ({ arm: source === control ? 'control' : 'experimental' }),
})) lines.push(line)

const check = await verifyChain(lines, { registration: genesis })
// { ok: ${check.value?.ok ?? true}, lines: ${check.value?.lines ?? lines.value.length}, head: '…' }${
    check.value && !check.value.ok
      ? `  — broken at line ${check.value.brokenAt}: ${check.value.reason}`
      : ''
  }
const series = await readSession(lines)             // exactly what the live analysis saw`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="record-jsonl"
      title="1 · JSONL v2: a header and a hash chain"
      description="Schema v2 opens with a session header and links every trial line to the SHA-256 of the line before it. It proves internal consistency, not time — publish the head, or a truncated tail stays invisible."
      :api="['recordSession', 'verifyChain', 'parseRecordLine', 'serializeRecordLine', 'ZERO_HASH']"
    >
      <template #controls>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          :label="`Record ${sourceCount * rounds + 1} lines`"
          busy-label="Recording…"
          hint="two seeded DRBG sources in lock-step rounds, tagged with arm / run / segment"
          @run="record"
          @cancel="task.cancel()"
        />
        <UFormField label="Sources">
          <UInputNumber v-model="sourceCount" :min="1" :max="4" class="w-24" />
        </UFormField>
        <UFormField label="Rounds">
          <UInputNumber v-model="rounds" :min="2" :max="60" class="w-28" />
        </UFormField>
        <USwitch
          v-model="bindRegistration"
          label="bind to a registration"
          description="genesis = the plan hash instead of 64 zeros"
        />
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div v-if="lines.length" class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="chain verifies"
            :value="check ? (check.ok ? 'ok' : 'BROKEN') : '—'"
            :tone="check?.ok ? 'success' : 'error'"
            size="sm"
            :note="check?.ok ? `${check.lines} lines checked` : (check?.reason ?? 'not checked')"
          />
          <StatTile
            label="head"
            :value="shortHash(check?.head)"
            size="sm"
            note="publish it before anyone can rewrite the tail"
          />
          <StatTile
            label="genesis"
            :value="shortHash(session?.genesis)"
            size="sm"
            tone="primary"
            :note="bindRegistration ? 'the registration hash' : 'ZERO_HASH — no registration bound'"
          />
          <StatTile
            label="broken at"
            :value="check && !check.ok ? `line ${check.brokenAt}` : 'nothing broken'"
            size="sm"
            :tone="check && !check.ok ? 'error' : 'neutral'"
            note="0 = the header; the first bad link stops the walk"
          />
        </div>

        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Tamper with the recording" class="min-w-64">
            <USelect v-model="tamper" :items="TAMPERS" class="w-full" />
          </UFormField>
          <UFormField label="Line index" help="0 is the header line">
            <UInputNumber v-model="tamperLine" :min="0" :max="Math.max(0, lines.length - 1)" class="w-28" />
          </UFormField>
        </div>

        <ErrorAlert :err="checkError" :dismissible="false" title="verifyChain refused these lines" />

        <div class="rounded-md border border-default bg-elevated/40 overflow-x-auto">
          <pre class="text-[11px] leading-5 p-3 font-mono whitespace-pre"><code><span
            v-for="(line, i) in tamperedLines.slice(0, 40)"
            :key="i"
            class="block"
            :class="[
              i === 0 ? 'text-primary' : '',
              tamper !== 'none' && i === Math.min(Math.max(1, tamperLine), tamperedLines.length - 1) ? 'text-error' : '',
              check && !check.ok && i === check.brokenAt ? 'bg-error/10' : '',
            ]"
          >{{ String(i).padStart(3, ' ') }}  {{ line }}</span><span
            v-if="tamperedLines.length > 40"
            class="block text-dimmed"
          >    … {{ tamperedLines.length - 40 }} more lines</span></code></pre>
        </div>

        <div v-if="inspected" class="grid gap-3 lg:grid-cols-2">
          <div class="rounded-md border border-default p-3">
            <h3 class="text-sm font-medium text-highlighted">
              Line {{ inspected.index }} through parseRecordLine
            </h3>
            <ErrorAlert
              v-if="inspected.error"
              :err="inspected.error"
              :dismissible="false"
              class="mt-2"
            />
            <template v-else>
              <p class="mt-1 text-xs text-muted">
                {{ inspected.isHeader ? "v2 session header — narrow it with `'kind' in line`" : 'v2 trial line' }}
                · canonical round trip:
                <span :class="inspected.roundTrips ? 'text-success' : 'text-error'">
                  {{ inspected.roundTrips ? 'serializeRecordLine(parse(line)) === line' : 'not canonical — the chain rejects it' }}
                </span>
              </p>
              <pre class="mt-2 text-[11px] font-mono overflow-x-auto"><code>{{ JSON.stringify(inspected.parsed, null, 2) }}</code></pre>
            </template>
          </div>
          <div class="rounded-md border border-default p-3">
            <h3 class="text-sm font-medium text-highlighted">readSession round trip</h3>
            <ErrorAlert
              v-if="replayError"
              :err="replayError"
              :dismissible="false"
              class="mt-2"
              title="readSession refused these lines"
            />
            <template v-else-if="replay">
              <p class="mt-1 text-xs text-muted">
                {{ replay.length }} series ·
                {{ replay.map((s) => `${s.source}: ${s.sums.length} trials`).join(' · ') }}
              </p>
              <p class="mt-2 text-[11px] font-mono text-dimmed">
                first sums —
                {{ Array.from(replay[0]?.sums.slice(0, 10) ?? [], (v) => fmtNum(v, { digits: 0 })).join(', ') }}
              </p>
              <p class="mt-2 text-xs text-muted">
                Editing a sum keeps the file readable: <code class="font-mono">readSession</code>
                still parses it and the analysis would happily use it. Only the chain notices.
              </p>
            </template>
          </div>
        </div>

        <CodeSnippet :code="snippet" title="what this section ran" />
      </div>
      <p v-else-if="!task.busy.value" class="text-sm text-muted">
        Record a short session to see the lines. Every line is plain JSON — the format is a paper
        trail, not a container you need this library to open.
      </p>

      <HonestNote variant="exact">
        <code class="font-mono">verifyChain</code> requires a v2 header, contiguous
        <code class="font-mono">i</code>, declared sources, the header's
        <code class="font-mono">bitsPerTrial</code>, canonical encoding, and every
        <code class="font-mono">prev</code> link. An edited, inserted, deleted or reordered line
        breaks it at the first bad link. What it cannot prove is <em>when</em>: only a published
        head, a timestamp or a seal bounds the recording in time.
      </HonestNote>
    </DemoSection>

    <PsiBasket />
  </div>
</template>
