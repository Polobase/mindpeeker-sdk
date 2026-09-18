<script setup lang="ts">
/**
 * §2b — the same verifier against a foreign file: a psi schema-v2 recording
 * written here by @mindpeeker/psi, checked by the ledger's verifyChain in all
 * three formats.
 */
import type { ChainVerification } from '@mindpeeker/ledger'
import { verifyChain } from '@mindpeeker/ledger'
import { fmtBytes } from '~/lib/format'
import { type PsiRecording, recordPsi, tamperPsi } from '~/lib/ledger/chain'

const sources = ref(2)
const rounds = ref(12)
const bindRegistration = ref(true)

type Edit = 'none' | 'sum' | 'truncate'
const edit = ref<Edit>('none')
const editLine = ref(5)
const publishHead = ref(true)

const task = useTask<PsiRecording>()
const recording = computed(() => task.result.value)

function record(): void {
  void task.run(async (signal, setProgress) => {
    setProgress(0)
    return await recordPsi({
      sources: sources.value,
      rounds: rounds.value,
      bitsPerTrial: 200,
      seedLabel: currentSeedLabel(),
      bindRegistration: bindRegistration.value,
      signal,
      onProgress: setProgress,
    })
  })
}

const lines = computed(() => {
  const current = recording.value
  if (!current) return []
  if (edit.value === 'sum') return tamperPsi(current.lines, editLine.value)
  if (edit.value === 'truncate') return current.lines.slice(0, -1)
  return [...current.lines]
})

interface Checks {
  psi: ChainVerification
  auto: ChainVerification
  ledger: ChainVerification
}
const checks = shallowRef<Checks>()

let seq = 0
watch(
  [lines, publishHead],
  () => {
    const mine = ++seq
    void (async () => {
      const current = recording.value
      if (!current || lines.value.length === 0) {
        checks.value = undefined
        return
      }
      const common = {
        genesis: current.genesis,
        ...(publishHead.value ? { head: current.head } : {}),
      }
      const [psi, auto, ledger] = await Promise.all([
        verifyChain(lines.value, { format: 'psi', ...common }),
        verifyChain(lines.value, { format: 'auto', ...common }),
        verifyChain(lines.value, { format: 'ledger', ...common }),
      ])
      if (mine !== seq) return
      checks.value = { psi, auto, ledger }
    })()
  },
  { immediate: true },
)

const bytes = computed(() => lines.value.reduce((total, line) => total + line.length + 1, 0))

const FORMATS = [
  {
    key: 'psi' as const,
    label: "format: 'psi'",
    note: 'checks the v2 header, that every later line is a v2 trial, and every link',
  },
  {
    key: 'auto' as const,
    label: "format: 'auto'",
    note: 'the common rule of both layouts: an optional unlinked header, then linked lines',
  },
  {
    key: 'ledger' as const,
    label: "format: 'ledger'",
    note: 'canonical { i, prev, record } entries only — a psi line is not one',
  },
]

const status = (check?: ChainVerification) =>
  check === undefined ? '—' : check.ok ? 'ok' : `${check.failure} at line ${check.brokenAt}`

const snippet = computed(
  () => `import { recordSession } from '@mindpeeker/psi'
import { verifyChain } from '@mindpeeker/ledger'

const lines: string[] = []
for await (const line of recordSession(sources, { chain: { registration: genesis } })) {
  lines.push(line)                       // header first, then one v2 trial line per source per round
  if (lines.length >= ${sources.value * rounds.value + 1}) break
}

await verifyChain(lines, { format: 'psi', genesis${publishHead.value ? ', head' : ''} })
// → { ok: ${String(checks.value?.psi.ok ?? false)}, lines: ${checks.value?.psi.lines ?? 0}, entries: ${checks.value?.psi.entries ?? 0}, head: '${(checks.value?.psi.head ?? recording.value?.head ?? '').slice(0, 12)}…' }`,
)
</script>

<template>
  <DemoSection
    id="psi-recording"
    title="The same verifier on a psi recording"
    description="@mindpeeker/psi writes its own JSONL schema v2: a session header, then trial lines whose prev hashes the previous line's exact text. The ledger verifies that file byte for byte — the text is hashed as given, never re-serialized — and returns the same head psi's own verifier does."
    :api="['verifyChain', 'recordSession']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Record a session"
        icon="i-lucide-file-json"
        :hint="`${sources * rounds} trials of 200 bits from independent DRBG sources — reproducible, so the head is the same for every reader`"
        @run="record"
        @cancel="task.cancel()"
      />
      <UFormField label="Sources" size="sm" class="w-24">
        <UInputNumber v-model="sources" :min="1" :max="4" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Rounds" size="sm" class="w-28">
        <UInputNumber v-model="rounds" :min="2" :max="200" :step="2" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="Bind a registration" size="sm">
        <USwitch v-model="bindRegistration" />
      </UFormField>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <p v-if="!recording" class="text-sm text-muted">
      Press <strong class="text-highlighted">Record a session</strong>. The sources are seeded DRBGs
      derived from the header's seed label, so the file — and its head — are the same on every run.
    </p>

    <div v-else class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end gap-3">
        <UFormField label="Alter the file" size="sm" class="w-full sm:w-72">
          <USelect
            v-model="edit"
            :items="[
              { label: 'none — the file as recorded', value: 'none' },
              { label: 'edit one trial sum (−1)', value: 'sum' },
              { label: 'drop the last line', value: 'truncate' },
            ]"
            size="sm"
            class="w-full"
          />
        </UFormField>
        <UFormField v-if="edit === 'sum'" label="on line" size="sm" class="w-24">
          <UInputNumber
            v-model="editLine"
            :min="1"
            :max="Math.max(1, lines.length - 1)"
            size="sm"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Publish the head" size="sm">
          <USwitch v-model="publishHead" />
        </UFormField>
      </div>

      <div class="grid gap-2 sm:grid-cols-3">
        <div
          v-for="format in FORMATS"
          :key="format.key"
          class="rounded-md border p-3 flex flex-col gap-1"
          :class="checks?.[format.key]?.ok ? 'border-success/40 bg-success/5' : 'border-default bg-elevated/40'"
        >
          <code class="text-xs text-primary">{{ format.label }}</code>
          <div class="flex items-center gap-1.5">
            <UIcon
              :name="checks?.[format.key]?.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
              class="size-4"
              :class="checks?.[format.key]?.ok ? 'text-success' : 'text-error'"
            />
            <span class="font-mono text-sm text-highlighted">{{ status(checks?.[format.key]) }}</span>
          </div>
          <p class="text-[11px] text-muted">{{ format.note }}</p>
          <p v-if="checks?.[format.key]?.reason" class="text-[11px] text-dimmed">
            {{ checks?.[format.key]?.reason }}
          </p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile label="Lines" :value="lines.length" :digits="0" :note="fmtBytes(bytes)" size="sm" />
        <StatTile label="Head (as recorded)" size="sm">
          <template #value>
            <span class="block text-[11px] break-all">{{ recording.head }}</span>
          </template>
          <template #note>SHA-256 of the last line</template>
        </StatTile>
        <StatTile label="Genesis" size="sm">
          <template #value>
            <span class="block text-[11px] break-all">{{ recording.genesis }}</span>
          </template>
          <template #note>
            {{ bindRegistration ? 'the registration hash' : 'ZERO_HASH — no registration bound' }}
          </template>
        </StatTile>
      </div>

      <div class="rounded-md border border-default bg-elevated/40 p-3 overflow-x-auto">
        <div class="text-[11px] uppercase tracking-wide text-muted mb-1.5">
          the file (first 4 lines)
        </div>
        <pre class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">{{
          lines.slice(0, 4).join('\n')
        }}</pre>
      </div>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <template #footer>
      <HonestNote variant="caveat" title="Name the format you expect">
        <code>'auto'</code> accepts either layout, so it cannot tell a ledger chain whose first entry
        was swapped for a header-like line from a genuine psi recording. Passing
        <code>format: 'psi'</code> or <code>'ledger'</code> says what the file is supposed to be, and
        a published head is still what catches a file rewritten from the first line down.
      </HonestNote>
    </template>
  </DemoSection>
</template>
