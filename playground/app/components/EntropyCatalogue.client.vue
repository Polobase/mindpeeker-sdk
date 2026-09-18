<script setup lang="ts">
/** Section 1 — every provider factory the package exports, and live 32-byte
 * draws from the keyless ones that can run in a browser tab. */
import {
  CATALOGUE,
  type CatalogueGroup,
  GROUP_LABEL,
  HELPER_EXPORTS,
  KIND_TONE,
  REACH_LABEL,
  REACH_TONE,
  type TryId,
} from '~/lib/entropy/catalogue'
import { TRY_SPECS, type TryOutcome, tryProvider } from '~/lib/entropy/try'
import { isAbortError } from '~/lib/errors'
import { fmtDuration } from '~/lib/format'

type Result = { ok: true; outcome: TryOutcome } | { ok: false; err: unknown }

const GROUPS: readonly (CatalogueGroup | 'all')[] = [
  'all',
  'synthetic',
  'local',
  'cloud',
  'beacon',
  'chain',
]
const group = ref<CatalogueGroup | 'all'>('all')
const keylessOnly = ref(false)
const runnableOnly = ref(false)

const groupItems = GROUPS.map((g) => ({
  label: g === 'all' ? `All ${CATALOGUE.length} factories` : GROUP_LABEL[g],
  value: g,
}))

const rows = computed(() =>
  CATALOGUE.filter((row) => {
    if (group.value !== 'all' && row.group !== group.value) return false
    if (keylessOnly.value && row.auth !== '—' && row.reach === 'proxy') return false
    if (runnableOnly.value && !row.tryId) return false
    return true
  }),
)

const counts = computed(() => ({
  shown: rows.value.length,
  browser: CATALOGUE.filter((r) => r.reach === 'browser' || r.reach === 'in-process').length,
  keyless: CATALOGUE.filter((r) => r.auth === '—').length,
}))

const results = ref<Record<string, Result>>({})
const runningId = ref<TryId | undefined>(undefined)
const lastId = ref<TryId | undefined>(undefined)
const task = useTask<void>()

const TRY_IDS: readonly TryId[] = ['crypto', 'jitter', 'drand', 'curby', 'nist', 'nqsn', 'uchile']

async function attempt(id: TryId, signal: AbortSignal): Promise<void> {
  runningId.value = id
  lastId.value = id
  try {
    results.value = { ...results.value, [id]: { ok: true, outcome: await tryProvider(id, signal) } }
  } catch (err) {
    if (isAbortError(err)) throw err
    results.value = { ...results.value, [id]: { ok: false, err } }
  } finally {
    runningId.value = undefined
  }
}

function runOne(id: TryId): void {
  void task.run(async (signal) => {
    await attempt(id, signal)
  })
}

function runAll(): void {
  void task.run(async (signal, setProgress) => {
    for (const [i, id] of TRY_IDS.entries()) {
      setProgress(i / TRY_IDS.length)
      await attempt(id, signal)
    }
    setProgress(1)
  })
}

const resultList = computed(() =>
  TRY_IDS.filter((id) => results.value[id]).map((id) => ({ id, result: results.value[id] as Result })),
)
const lastSpec = computed(() => (lastId.value ? TRY_SPECS[lastId.value] : undefined))
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      title="Every provider factory, with what it actually claims"
      :api="['cryptoProvider', 'drand', 'nistBeacon', 'serialEntropy', 'hwRng']"
      description="Thirty backends behind one interface: 29 factories in /providers plus hwRng in /node, and two Web Serial presets on top. kind says what physics is behind the bytes, privacy says whether the world sees them too."
    >
      <template #controls>
        <UFormField label="Group" size="sm">
          <USelect v-model="group" :items="groupItems" size="sm" class="w-56" />
        </UFormField>
        <UCheckbox v-model="keylessOnly" label="Keyless only" />
        <UCheckbox v-model="runnableOnly" label="Runnable in this tab" />
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          label="Try all 7 keyless"
          busy-label="Drawing 32 bytes…"
          icon="i-lucide-play-circle"
          hint="One 32-byte draw each. Network beacons may be blocked by CORS — that failure is part of the answer."
          @run="runAll"
          @cancel="task.cancel()"
        />
      </template>

      <p class="text-xs text-muted mb-3">
        Showing {{ counts.shown }} of {{ CATALOGUE.length }} factories ·
        {{ counts.keyless }} need no credential · {{ TRY_IDS.length }} can be drawn live from this
        page. A keyless HTTP beacon may still be CORS-blocked in your browser — the Try button is
        the only honest test.
      </p>

      <!-- Wide layout: the full table, scrollable inside its own box. -->
      <div class="hidden md:block overflow-x-auto rounded-md border border-default">
        <table class="w-full text-sm border-collapse">
          <caption class="sr-only">
            Entropy provider factories with kind, privacy, credential, reach and verification
          </caption>
          <thead class="bg-elevated/60 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" class="text-left font-medium px-3 py-2">Factory</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Source</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Kind</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Privacy</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Credential</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Runs in the browser</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Verification</th>
              <th scope="col" class="text-right font-medium px-3 py-2">Live</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.factory" class="border-t border-default align-top">
              <td class="px-3 py-2">
                <code class="font-mono text-xs text-primary">{{ row.factory }}</code>
                <div class="text-[11px] text-dimmed">{{ row.from.replace('@mindpeeker/entropy', '…') }}</div>
                <UBadge v-if="row.preset" size="sm" color="neutral" variant="subtle" class="mt-1">
                  serial preset
                </UBadge>
              </td>
              <td class="px-3 py-2 text-muted max-w-[16rem]">
                {{ row.source }}
                <div class="text-[11px] text-dimmed mt-0.5">{{ row.note }}</div>
              </td>
              <td class="px-3 py-2">
                <UBadge size="sm" :color="KIND_TONE[row.kind]" variant="subtle">{{ row.kind }}</UBadge>
              </td>
              <td class="px-3 py-2">
                <UBadge
                  size="sm"
                  :color="row.privacy === 'public' ? 'warning' : 'neutral'"
                  variant="subtle"
                >
                  {{ row.privacy }}
                </UBadge>
              </td>
              <td class="px-3 py-2 text-muted text-xs">{{ row.auth }}</td>
              <td class="px-3 py-2">
                <UBadge size="sm" :color="REACH_TONE[row.reach]" variant="subtle">
                  {{ REACH_LABEL[row.reach] }}
                </UBadge>
              </td>
              <td class="px-3 py-2 text-xs text-muted max-w-[18rem]">{{ row.verify }}</td>
              <td class="px-3 py-2 text-right">
                <UButton
                  v-if="row.tryId"
                  size="xs"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-play"
                  :loading="runningId === row.tryId"
                  :disabled="task.busy.value"
                  @click="runOne(row.tryId)"
                >
                  Try
                </UButton>
                <span v-else class="text-xs text-dimmed">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Narrow layout: the same rows as cards. -->
      <ul class="md:hidden flex flex-col gap-3">
        <li
          v-for="row in rows"
          :key="row.factory"
          class="rounded-md border border-default p-3 flex flex-col gap-2"
        >
          <div class="flex items-start justify-between gap-2">
            <code class="font-mono text-xs text-primary break-all">{{ row.factory }}</code>
            <UButton
              v-if="row.tryId"
              size="xs"
              color="primary"
              variant="soft"
              icon="i-lucide-play"
              :loading="runningId === row.tryId"
              :disabled="task.busy.value"
              @click="runOne(row.tryId)"
            >
              Try
            </UButton>
          </div>
          <p class="text-sm text-muted">{{ row.source }}</p>
          <div class="flex flex-wrap gap-1.5">
            <UBadge size="sm" :color="KIND_TONE[row.kind]" variant="subtle">{{ row.kind }}</UBadge>
            <UBadge
              size="sm"
              :color="row.privacy === 'public' ? 'warning' : 'neutral'"
              variant="subtle"
            >
              {{ row.privacy }}
            </UBadge>
            <UBadge size="sm" :color="REACH_TONE[row.reach]" variant="subtle">
              {{ REACH_LABEL[row.reach] }}
            </UBadge>
            <UBadge v-if="row.auth !== '—'" size="sm" color="neutral" variant="outline">
              {{ row.auth }}
            </UBadge>
          </div>
          <p class="text-xs text-dimmed">{{ row.note }}</p>
          <p class="text-xs text-muted"><span class="text-dimmed">verify:</span> {{ row.verify }}</p>
        </li>
      </ul>

      <template #footer>
        A keyless HTTP provider that is not listed as browser-tested here may be CORS-blocked — the
        Try buttons are the only honest test, and a block shows up as
        <code class="font-mono">EntropyError (network)</code>. API keys in browser code are public:
        keyed providers belong behind a server-side proxy (<code class="font-mono">baseUrl</code>).
      </template>
    </DemoSection>

    <DemoSection
      v-if="resultList.length || task.busy.value || task.error.value"
      title="Live draws"
      :level="3"
      :api="['getBytes', 'EntropyResult.sources', 'BeaconRound']"
      description="32 bytes per provider, with the attribution the SDK returned — including the exact beacon rounds a public value came from."
    >
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div class="grid gap-3 lg:grid-cols-2">
        <div
          v-for="entry in resultList"
          :key="entry.id"
          class="rounded-md border border-default p-3 flex flex-col gap-2"
        >
          <div class="flex items-center justify-between gap-2">
            <code class="font-mono text-sm text-primary">{{ entry.id }}</code>
            <UBadge
              size="sm"
              :color="entry.result.ok ? 'success' : 'error'"
              variant="subtle"
            >
              {{ entry.result.ok ? fmtDuration(entry.result.outcome.ms) : 'failed' }}
            </UBadge>
          </div>

          <template v-if="entry.result.ok">
            <div class="text-xs text-muted">
              provider
              <code class="font-mono text-highlighted">{{ entry.result.outcome.providerName }}</code>
              · {{ entry.result.outcome.kind }} · {{ entry.result.outcome.privacy }}
            </div>
            <code class="block font-mono text-[11px] leading-relaxed break-all text-highlighted">
              {{ entry.result.outcome.hex }}
            </code>
            <div class="text-xs text-muted">
              sources[]:
              <span v-for="s in entry.result.outcome.sources" :key="s.name" class="font-mono">
                {{ s.name }}
              </span>
            </div>
            <div
              v-for="round in entry.result.outcome.rounds"
              :key="`${round.chain ?? 0}-${round.round}`"
              class="text-xs text-muted"
            >
              round <span class="font-mono text-highlighted">{{ round.round }}</span>
              <span v-if="round.chain !== undefined"> · chain {{ round.chain }}</span>
              <span v-if="round.timestamp">
                · {{ new Date(round.timestamp).toISOString() }}
              </span>
              <span v-if="round.signature" class="font-mono">
                · sig {{ round.signature.slice(0, 16) }}…
              </span>
            </div>
          </template>
          <ErrorAlert v-else :err="entry.result.err" :dismissible="false" />
        </div>
      </div>

      <CodeSnippet
        v-if="lastSpec"
        class="mt-3"
        :code="lastSpec.code"
        :title="`what the “${lastId}” button ran`"
      />

      <template #footer>
        Beacon values are <strong>public</strong>: drand, NIST, NQSN, UChile and CURBy serve every
        caller in the world the same bytes for a round. They are shared, verifiable randomness —
        never a secret seed.
      </template>
    </DemoSection>

    <DemoSection
      title="What else these entry points export"
      :level="3"
      description="Not every export is a provider: the core carries the contract, the strategies and the round arithmetic."
    >
      <ul class="grid gap-2 sm:grid-cols-2">
        <li v-for="item in HELPER_EXPORTS" :key="item.name" class="text-sm">
          <code class="font-mono text-xs text-primary">{{ item.name }}</code>
          <span class="text-muted"> — {{ item.note }}</span>
        </li>
      </ul>
      <template #footer>
        The README counts 30 backends: 29 factories in
        <code class="font-mono">@mindpeeker/entropy/providers</code> plus
        <code class="font-mono">hwRng()</code> in <code class="font-mono">/node</code>.
        <code class="font-mono">truerng</code> and <code class="font-mono">onerng</code> are
        presets of <code class="font-mono">serialEntropy</code>, not separate sources.
      </template>
    </DemoSection>
  </div>
</template>
