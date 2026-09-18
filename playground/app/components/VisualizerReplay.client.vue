<script setup lang="ts">
/**
 * `--record` and `--replay`, demonstrated rather than described: record the
 * trials behind the two trial panels as hash-chained psi JSONL v2 lines, verify
 * the chain, then drive a second monitor from those lines and check that the
 * replayed curve is the recorded one — the equality the CLI's replay relies on.
 */
import {
  type ChainVerification,
  parseRecordLine,
  recordSession,
  verifyChain,
} from '@mindpeeker/psi'
import { NetvarMonitor } from '@viz/src/demo/monitor'
import { createYielder } from '~/lib/async'
import { fmtNum } from '~/lib/format'
import { BITS_PER_TRIAL } from '~/lib/visualizer/driver'
import { resolveFeed } from '~/lib/visualizer/feed'

const TRIAL_COUNTS = [
  { label: '40 trials', value: 40 },
  { label: '120 trials', value: 120 },
  { label: '400 trials', value: 400 },
]

interface Recording {
  readonly lines: string[]
  readonly providerName: string
  readonly trials: number
  /** D(t) as the live session plotted it. */
  readonly live: number[]
  /** D(t) as a replay of the lines plots it. */
  readonly replayed: number[]
  readonly maxDiff: number
}

const trials = ref(40)
const tampered = ref(false)
const TAMPER_LINE = 3

const task = useTask<Recording>()
const recording = computed(() => task.result.value)

/** `z = (S − k/2)/√(k/4)`; one source, so the round's Stouffer Z is this z. */
function trialZ(sum: number, bits: number): number {
  return (sum - bits / 2) / Math.sqrt(bits / 4)
}

/** Replay a recording's lines through a fresh monitor — what `--replay` does. */
function replayDeviations(lines: readonly string[]): number[] {
  const monitor = new NetvarMonitor(BITS_PER_TRIAL)
  const out: number[] = []
  lines.forEach((line, index) => {
    const record = parseRecordLine(line, index + 1)
    if (record.v !== 2 || 'kind' in record) return
    out.push(monitor.add(trialZ(record.sum, record.bitsPerTrial)).deviation)
  })
  return out
}

function record(): void {
  tampered.value = false
  void task.run(async (signal, setProgress) => {
    setProgress(0)
    const tick = createYielder(8, signal)
    const feed = await resolveFeed('source', signal)
    const source = {
      name: feed.providerName,
      stream: () => feed.stream({ chunkBytes: BITS_PER_TRIAL / 8, signal }),
    }
    const monitor = new NetvarMonitor(BITS_PER_TRIAL)
    const lines: string[] = []
    const live: number[] = []
    const target = trials.value
    for await (const line of recordSession([source], {
      bitsPerTrial: BITS_PER_TRIAL,
      chunkBytes: BITS_PER_TRIAL / 8,
      chain: true,
      signal,
    })) {
      lines.push(line)
      const parsed = parseRecordLine(line, lines.length)
      if (parsed.v === 2 && !('kind' in parsed)) {
        live.push(monitor.add(trialZ(parsed.sum, parsed.bitsPerTrial)).deviation)
        setProgress(live.length / target)
        if (live.length >= target) break
        await tick()
      }
    }
    const replayed = replayDeviations(lines)
    let maxDiff = 0
    for (let i = 0; i < live.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs((live[i] as number) - (replayed[i] ?? Number.NaN)))
    }
    return {
      lines,
      providerName: feed.providerName,
      trials: live.length,
      live,
      replayed,
      maxDiff,
    }
  })
}

/** The recorded lines, optionally with one trial's `sum` nudged by 1. */
const shownLines = computed(() => {
  const source = recording.value?.lines ?? []
  if (!tampered.value || source.length <= TAMPER_LINE) return source
  const copy = [...source]
  const parsed = JSON.parse(copy[TAMPER_LINE] as string) as { sum: number }
  parsed.sum = parsed.sum >= BITS_PER_TRIAL ? parsed.sum - 1 : parsed.sum + 1
  copy[TAMPER_LINE] = JSON.stringify(parsed)
  return copy
})

const check = shallowRef<ChainVerification>()
const checkError = ref<unknown>()

watch(
  shownLines,
  async (lines) => {
    check.value = undefined
    checkError.value = undefined
    if (!lines.length) return
    try {
      check.value = await verifyChain(lines)
    } catch (error) {
      checkError.value = error
    }
  },
  { immediate: true },
)

const refusal = computed(() => {
  const result = check.value
  if (!result || result.ok) return undefined
  return `refusing to replay run.jsonl: hash chain broken at record ${result.brokenAt}: ${result.reason}`
})

const preview = computed(() => shownLines.value.slice(0, 4).join('\n'))

const cliSnippet = `# record: a NEW file, one line per 200-bit trial, on disk before its point is plotted
bunx mindpeeker-viz --source esp32 --record session.jsonl

# replay: read the file, verify the chain on that copy, then drive the two trial panels
bunx mindpeeker-viz --replay session.jsonl
# → cumdev caption: "replay of session.jsonl · chain ok · head 8f3c1d0a2b74…"

# a broken chain is refused outright, before anything is served
bunx mindpeeker-viz --replay tampered.jsonl
# → refusing to replay tampered.jsonl: hash chain broken at record 102:
#   line 102 prev does not match the SHA-256 of the line before it`

const verifySnippet = `import { parseRecordLine, verifyChain } from '@mindpeeker/psi'

const result = await verifyChain(lines)     // reads the whole chain, in order
result.ok                                    // every line canonical and linked
result.head                                  // SHA-256 of the last line — publish this
result.brokenAt, result.reason               // 0-based index of the first bad line, and why

// a replay turns the same lines back into the plotted statistic
const record = parseRecordLine(line)
const z = (record.sum - 100) / Math.sqrt(50)
monitor.add(z).deviation                     // identical to the value recorded live`
</script>

<template>
  <DemoSection
    title="--record and --replay, run here"
    :api="['recordSession', 'parseRecordLine', 'verifyChain', 'NetvarMonitor']"
    description="The CLI writes the trials behind its two trial panels as a psi JSONL v2 recording:
      a session header, then one line per 200-bit trial whose prev is the SHA-256 of the line before
      it. A replay verifies that chain first and then drives the panels through the same Stouffer →
      monitor path — so a replay plots exactly the values the live session plotted. Both halves run
      below, on the source the header selects."
  >
    <template #controls>
      <UFormField label="Trials to record" size="sm" class="w-40">
        <USelect v-model="trials" :items="TRIAL_COUNTS" size="sm" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Record, verify, replay"
        busy-label="Recording…"
        icon="i-lucide-circle-dot"
        hint="one SHA-256 per line; a 400-trial run is ≈ 10 kB of JSONL"
        @run="record"
        @cancel="task.cancel()"
      />
      <UCheckbox
        v-if="recording"
        v-model="tampered"
        :label="`Edit line ${TAMPER_LINE}'s sum by 1`"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
    <ErrorAlert :err="checkError" title="Chain verification failed" @dismiss="checkError = undefined" />

    <div v-if="!recording" class="text-sm text-muted">
      Nothing recorded yet. A run draws {{ trials }} × 25 bytes from the selected source, hashes each
      line into the chain, and replays the result.
    </div>

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="trial lines"
          :value="recording.trials"
          :digits="0"
          :note="`plus the session header · source ${recording.providerName}`"
        />
        <StatTile
          label="replay vs live: max |ΔD(t)|"
          :value="recording.maxDiff"
          :digits="0"
          :tone="recording.maxDiff === 0 ? 'success' : 'error'"
          note="0 means the replayed curve is the recorded curve, bit for bit"
        />
        <StatTile
          label="chain"
          :value="check === undefined ? 'checking…' : check.ok ? 'verified' : 'broken'"
          :mono="false"
          :tone="check === undefined ? 'neutral' : check.ok ? 'success' : 'error'"
          :note="
            check === undefined
              ? 'verifyChain re-hashes every line'
              : check.ok
                ? `${check.lines} lines, in order and canonical`
                : `first bad line: ${check.brokenAt ?? '—'}`
          "
        />
        <StatTile label="head">
          <template #value>
            <span class="font-mono text-sm break-all">
              {{ check?.head ? `${check.head.slice(0, 16)}…` : '—' }}
            </span>
          </template>
          <template #note>
            SHA-256 of the last line — publish it and the whole recording is fixed in time
          </template>
        </StatTile>
      </div>

      <UAlert
        v-if="refusal"
        class="mt-3"
        color="error"
        variant="subtle"
        icon="i-lucide-shield-x"
        title="What the CLI prints for this file"
        :description="refusal"
      />

      <LineChart
        class="mt-4"
        :series="[
          { name: 'recorded live', y: recording.live, color: 1, width: 3 },
          { name: 'replayed from the lines', y: recording.replayed, color: 2, dashed: true },
        ]"
        x-label="trial t"
        y-label="D(t) = Σ(Z² − 1)"
        :height="260"
        aria-label="The cumulative deviation recorded live and the same statistic replayed from the recording"
      />

      <div class="mt-4 grid gap-3 lg:grid-cols-2">
        <!-- min-w-0: the JSONL preview and the snippets opposite never wrap; without it
             their content would set this grid's column width and overflow the page. -->
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-highlighted mb-2">
            The first lines of the recording
          </h3>
          <pre class="overflow-x-auto rounded-md border border-default bg-elevated/40 p-3 font-mono text-[11px] leading-relaxed">{{ preview }}</pre>
          <p class="mt-2 text-xs text-muted">
            Line 0 is the session header (sources, bitsPerTrial, genesis); every later line is one
            trial, and its <code class="font-mono">prev</code> is the SHA-256 of the line above it.
            Each line is on disk before its point is plotted, so the file is never ahead of or behind
            the chart.
          </p>
        </div>
        <div class="flex min-w-0 flex-col gap-3">
          <CodeSnippet :code="cliSnippet" lang="sh" title="the CLI flags" />
          <CodeSnippet :code="verifySnippet" title="verifying and replaying a file anywhere" />
        </div>
      </div>
    </template>

    <HonestNote variant="exact" class="mt-4">
      The chain is a tamper-<em>evidence</em> device, not a proof of provenance: it shows that these
      lines are in this order and unedited since they were written. It cannot show when they were
      written or that they came from the device claimed — for that the head has to be published or
      timestamped (a VDF bracket, a ledger entry) before anyone could have chosen it.
    </HonestNote>

    <template #footer>
      <code class="font-mono text-xs">--record</code> creates a new file and never overwrites one;
      Ctrl+C flushes and closes it. A replay reads the file into memory once and verifies
      <em>that copy</em>, so the bytes replayed are the bytes verified. Byte-level panels are absent
      from a replay: a trial recording holds sums, not raw bytes.
    </template>
  </DemoSection>
</template>
