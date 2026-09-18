<script setup lang="ts">
/**
 * §2a — the ledger hash chain: append records, read the JSONL file it
 * produces, then alter it six different ways and watch verifyChain name the
 * failure and the line it happened on.
 */
import { canonicalize, type ChainVerification, sha256Hex, verifyChain, ZERO_HASH } from '@mindpeeker/ledger'
import { getBytes, sourceSummary } from '~/lib/entropy'
import {
  applyTamper,
  type BuiltChain,
  buildChain,
  type DemoRecord,
  type TamperKind,
  TAMPERS,
} from '~/lib/ledger/chain'

const PLAN = { plan: 'ledger playground chain', version: 1 }
const BITS = 200

function initialRecords(): DemoRecord[] {
  return [
    { run: 0, arm: 'experimental', sum: 1012 },
    { run: 0, arm: 'control', sum: 987 },
    { run: 1, arm: 'experimental', sum: 1005 },
    { run: 1, arm: 'control', sum: 996 },
    { run: 2, arm: 'experimental', sum: 1021 },
    { run: 2, arm: 'control', sum: 1001 },
  ]
}

const records = ref<DemoRecord[]>(initialRecords())
const bindRegistration = ref(true)
const tamper = ref<TamperKind>('none')
const lineIndex = ref(2)
const publishHead = ref(true)

const genesis = ref(ZERO_HASH)
watch(
  bindRegistration,
  async (bind) => {
    genesis.value = bind ? await sha256Hex(canonicalize(PLAN)) : ZERO_HASH
  },
  { immediate: true },
)

const built = shallowRef<BuiltChain>()
const buildError = ref<unknown>()
let buildSeq = 0
watch(
  [records, genesis],
  () => {
    const mine = ++buildSeq
    void (async () => {
      try {
        const next = await buildChain(records.value, genesis.value)
        if (mine !== buildSeq) return
        built.value = next
        buildError.value = undefined
      } catch (error) {
        if (mine !== buildSeq) return
        buildError.value = error
      }
    })()
  },
  { immediate: true, deep: true },
)

const shown = shallowRef<readonly string[]>([])
const lineHashes = shallowRef<readonly string[]>([])
const check = shallowRef<ChainVerification>()

let seq = 0
watch(
  [built, tamper, lineIndex, publishHead],
  () => {
    const mine = ++seq
    void (async () => {
      const current = built.value
      if (!current) return
      const lines = await applyTamper(current, tamper.value, lineIndex.value)
      const hashes = await Promise.all(lines.map((line) => sha256Hex(line)))
      const verified = await verifyChain(lines, {
        format: 'ledger',
        genesis: current.genesis,
        ...(publishHead.value ? { head: current.head } : {}),
      })
      if (mine !== seq) return
      shown.value = lines
      lineHashes.value = hashes
      check.value = verified
    })()
  },
  { immediate: true },
)

const append = useTask<void>()
function addRecord(): void {
  void append.run(async (signal) => {
    const bytes = await getBytes(BITS / 8, { signal })
    let sum = 0
    for (const byte of bytes) {
      let b = byte
      while (b !== 0) {
        sum += b & 1
        b >>= 1
      }
    }
    const next = records.value.length
    records.value = [
      ...records.value,
      { run: Math.floor(next / 2), arm: next % 2 === 0 ? 'experimental' : 'control', sum },
    ]
  })
}

function reset(): void {
  records.value = initialRecords()
  tamper.value = 'none'
  lineIndex.value = 2
}

interface Row {
  readonly index: number
  readonly line: string
  readonly i?: number
  readonly prev?: string
  readonly record?: string
  /** SHA-256 of this line's exact bytes — the next line's `prev`. */
  readonly hash: string
  readonly changed: boolean
  readonly broken: boolean
}

const rows = computed<Row[]>(() => {
  const original = built.value?.lines ?? []
  const brokenAt = check.value?.ok === false ? check.value.brokenAt : undefined
  return shown.value.map((line, index) => {
    let parsed: { i?: number; prev?: string; record?: unknown } = {}
    try {
      parsed = JSON.parse(line) as typeof parsed
    } catch {
      parsed = {}
    }
    return {
      index,
      line,
      ...(typeof parsed.i === 'number' ? { i: parsed.i } : {}),
      ...(typeof parsed.prev === 'string' ? { prev: parsed.prev } : {}),
      ...(parsed.record !== undefined ? { record: JSON.stringify(parsed.record) } : {}),
      hash: lineHashes.value[index] ?? '',
      changed: original[index] !== line,
      broken: brokenAt === index,
    }
  })
})

const expectation = computed(
  () => TAMPERS.find((option) => option.value === tamper.value)?.expect ?? '',
)

const tamperOptions = TAMPERS.map((option) => ({ label: option.label, value: option.value }))

const snippet = computed(
  () => `import { appendEntry, startChain, verifyChain } from '@mindpeeker/ledger'

let chain = startChain('${genesis.value.slice(0, 16)}…')   // genesis = ${
    bindRegistration.value ? 'the registration hash' : 'ZERO_HASH (64 zeros)'
  }
const lines: string[] = []
for (const record of records) {
  const appended = await appendEntry(chain, record)   // line = canonicalize({ i, prev, record })
  lines.push(appended.line)                           // persist line + '\\n'
  chain = appended.chain                              // head = SHA-256(line)
}

const check = await verifyChain(lines, {
  format: 'ledger',
  genesis: chain.genesis,${publishHead.value ? "\n  head: chain.head,   // without this, truncation is undetectable" : '\n  // no head published — truncation is undetectable'}
})
// → { ok: ${String(check.value?.ok ?? false)}${
    check.value?.ok === false
      ? `, failure: '${check.value.failure}', brokenAt: ${check.value.brokenAt}`
      : `, entries: ${check.value?.entries ?? 0}, head: '${(check.value?.head ?? '').slice(0, 12)}…'`
  } }`,
)
</script>

<template>
  <DemoSection
    id="chain"
    title="A hash chain over the records"
    description="Line i is the canonical JSON of { i, prev, record }; prev is the SHA-256 of the previous line's exact bytes, and prev of line 0 is the genesis. Editing, inserting, deleting or reordering any line breaks the next link. Truncating the end breaks nothing — unless a head was published first."
    :api="['startChain', 'appendEntry', 'verifyChain', 'canonicalize', 'ZERO_HASH']"
  >
    <template #controls>
      <RunControls
        :busy="append.busy.value"
        label="Append a trial"
        icon="i-lucide-plus"
        :hint="`200 bits from ${sourceSummary().providerName} → one record { run, arm, sum }`"
        @run="addRecord"
        @cancel="append.cancel()"
      >
        <UButton variant="soft" color="neutral" icon="i-lucide-rotate-ccw" @click="reset">
          Reset
        </UButton>
      </RunControls>
      <UFormField label="Bind to a registration hash" size="sm">
        <USwitch v-model="bindRegistration" />
      </UFormField>
      <UFormField label="Publish the head" size="sm">
        <USwitch v-model="publishHead" />
      </UFormField>
      <UFormField label="Alteration" size="sm" class="w-full sm:w-80">
        <USelect v-model="tamper" :items="tamperOptions" size="sm" class="w-full" />
      </UFormField>
      <UFormField label="on line" size="sm" class="w-24">
        <UInputNumber
          v-model="lineIndex"
          :min="0"
          :max="Math.max(0, records.length - 1)"
          size="sm"
          class="w-full"
        />
      </UFormField>
    </template>

    <ErrorAlert :err="append.error.value" @dismiss="append.reset()" />
    <ErrorAlert :err="buildError" title="The chain could not be built" :dismissible="false" />

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge
          size="sm"
          :color="check?.ok ? 'success' : 'error'"
          variant="subtle"
          :icon="check?.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
        >
          verifyChain → {{ check?.ok ? 'ok' : `${check?.failure} at line ${check?.brokenAt}` }}
        </UBadge>
        <UBadge size="sm" color="neutral" variant="subtle">
          {{ check?.entries ?? 0 }} linked entries of {{ check?.lines ?? 0 }} lines read
        </UBadge>
        <UBadge size="sm" color="neutral" variant="subtle" class="font-mono">
          genesis {{ genesis.slice(0, 12) }}…
        </UBadge>
        <UBadge v-if="publishHead" size="sm" color="primary" variant="subtle" class="font-mono">
          published head {{ (built?.head ?? '').slice(0, 12) }}…
        </UBadge>
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
          <div class="text-[11px] uppercase tracking-wide text-muted">expected outcome</div>
          <div class="text-sm text-highlighted">{{ expectation }}</div>
        </div>
        <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
          <div class="text-[11px] uppercase tracking-wide text-muted">verifyChain reason</div>
          <div class="text-sm text-highlighted">
            {{ check?.ok ? `head ${check.head?.slice(0, 24)}…` : (check?.reason ?? '—') }}
          </div>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="text-muted uppercase">
            <tr>
              <th class="text-left py-1.5 pr-3 font-medium">line</th>
              <th class="text-left py-1.5 px-3 font-medium">i</th>
              <th class="text-left py-1.5 px-3 font-medium">prev</th>
              <th class="text-left py-1.5 px-3 font-medium">record</th>
              <th class="text-left py-1.5 pl-3 font-medium">SHA-256 of this line</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.index"
              class="border-t border-default"
              :class="row.broken ? 'bg-error/10' : row.changed ? 'bg-warning/10' : ''"
            >
              <td class="py-1.5 pr-3 font-mono tabular-nums">
                {{ row.index }}
                <UIcon
                  v-if="row.broken"
                  name="i-lucide-triangle-alert"
                  class="size-3 text-error align-middle"
                />
                <UIcon
                  v-else-if="row.changed"
                  name="i-lucide-pencil"
                  class="size-3 text-warning align-middle"
                />
              </td>
              <td class="py-1.5 px-3 font-mono tabular-nums">{{ row.i ?? '—' }}</td>
              <td class="py-1.5 px-3 font-mono text-dimmed">{{ row.prev?.slice(0, 12) ?? '—' }}…</td>
              <td class="py-1.5 px-3 font-mono break-all">{{ row.record ?? row.line }}</td>
              <td class="py-1.5 pl-3 font-mono text-primary">{{ row.hash.slice(0, 12) }}…</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-[11px] text-muted">
        Read it downwards: the highlighted hash of one line is the dimmed <code>prev</code> of the
        line below it, and the last highlighted hash is the chain head. Amber = a line this
        alteration changed; red = the line <code>verifyChain</code> stopped at.
      </p>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <template #footer>
      <HonestNote variant="caveat" title="Read the two 'ok' cases again">
        Dropping the last line, and rewriting the whole file from edited records, both verify
        <em>ok</em> with the head switch off. A chain is only tamper-evident against a head published
        or timestamped somewhere you cannot rewrite — and a chain fabricated in one sitting is
        internally perfect. That is why the head belongs in a signed checkpoint or a time bracket,
        not only in your own file.
      </HonestNote>
    </template>
  </DemoSection>
</template>
