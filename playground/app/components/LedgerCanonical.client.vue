<script setup lang="ts">
/**
 * §1 — RFC 8785 canonical JSON: edit any JSON, watch the canonical bytes and
 * their SHA-256, check the published reference vectors, and see the values
 * canonicalize refuses rather than coerces.
 */
import { MAX_JSON_DEPTH } from '@mindpeeker/ledger'
import { errorInfo } from '~/lib/errors'
import { fmtBytes, fmtNum } from '~/lib/format'
import {
  type CanonicalReport,
  canonicalReport,
  JSON_PRESETS,
  REJECTED_SAMPLES,
  respell,
  tryCanonicalize,
} from '~/lib/ledger/samples'

const presetId = ref(JSON_PRESETS[0]?.id ?? 'rfc-8785')
const preset = computed(() => JSON_PRESETS.find((p) => p.id === presetId.value) ?? JSON_PRESETS[0])
const text = ref(preset.value?.text ?? '{}')
const edited = ref(false)

watch(preset, (next) => {
  text.value = next?.text ?? '{}'
  edited.value = false
})

const report = shallowRef<CanonicalReport>({ ok: false })
const respelled = shallowRef<CanonicalReport>({ ok: false })

// Typing fires this faster than SHA-256 resolves; only the newest run may write.
let seq = 0
watch(
  text,
  (value) => {
    const mine = ++seq
    void (async () => {
      const [main, other] = await Promise.all([canonicalReport(value), canonicalReport(respell(value))])
      if (mine !== seq) return
      report.value = main
      respelled.value = other
    })()
  },
  { immediate: true },
)

/** Only a preset that ships a published canonical form can be compared against one. */
const matchesVector = computed(() => {
  const expected = edited.value ? undefined : preset.value?.expected
  if (expected === undefined || !report.value.ok) return undefined
  return expected === report.value.canonical
})

const sameHash = computed(
  () => report.value.ok && respelled.value.ok && report.value.hash === respelled.value.hash,
)

const errorLine = computed(() => {
  const err = report.value.error
  if (err === undefined) return undefined
  const info = errorInfo(err)
  const message = info.message.length > 220 ? `${info.message.slice(0, 217)}…` : info.message
  return { name: info.name, code: info.code, message }
})

interface RejectedRow {
  label: string
  code: string
  why: string
  name: string
  errorCode?: string
  message: string
  accepted: boolean
}

const rejected = computed<RejectedRow[]>(() =>
  REJECTED_SAMPLES.map((sample) => {
    const outcome = tryCanonicalize(sample.build)
    const info = outcome.error === undefined ? undefined : errorInfo(outcome.error)
    const message = info?.message ?? ''
    return {
      label: sample.label,
      code: sample.code,
      why: sample.why,
      name: info?.name ?? '—',
      ...(info?.code !== undefined ? { errorCode: info.code } : {}),
      message: message.length > 150 ? `${message.slice(0, 147)}…` : message,
      accepted: outcome.ok,
    }
  }),
)

const snippet = `import { canonicalize, canonicalBytes, sha256Hex } from '@mindpeeker/ledger'

const text = canonicalize(record)        // RFC 8785 JCS: sorted keys, ECMAScript numbers, no whitespace
const bytes = canonicalBytes(record)     // the same string as UTF-8 — these are the bytes you hash
const digest = await sha256Hex(text)     // lower-case hex SHA-256

// Rejected, never coerced: NaN, Infinity, undefined, array holes, BigInt,
// Map/Set/Date/typed arrays/class instances, lone surrogates, cycles,
// nesting deeper than MAX_JSON_DEPTH (${MAX_JSON_DEPTH}).`
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      id="canonicalize"
      title="One structure, one string of bytes"
      description="RFC 8785 fixes exactly one serialization per JSON value: members sorted by UTF-16 code units, numbers in ECMAScript shortest round-trip form, strings escaped as JSON.stringify escapes them, no insignificant whitespace. Type anything below — the canonical form and its SHA-256 update as you type."
      :api="['canonicalize', 'canonicalBytes', 'sha256Hex', 'MAX_JSON_DEPTH']"
    >
      <template #controls>
        <UFormField label="Input" size="sm" class="w-full sm:w-96">
          <USelect
            v-model="presetId"
            :items="JSON_PRESETS.map((p) => ({ label: p.label, value: p.id }))"
            size="sm"
            class="w-full"
          />
        </UFormField>
      </template>

      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">{{ preset?.note }}</p>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="flex flex-col gap-2 min-w-0">
            <label for="ledger-json" class="text-xs uppercase tracking-wide text-muted">
              JSON as a human writes it
            </label>
            <UTextarea
              id="ledger-json"
              v-model="text"
              :rows="12"
              class="w-full font-mono text-xs"
              spellcheck="false"
              @update:model-value="edited = true"
            />
          </div>

          <div class="flex flex-col gap-2 min-w-0">
            <div class="text-xs uppercase tracking-wide text-muted">
              canonicalize(value) — the bytes that get hashed
            </div>
            <div
              v-if="report.ok"
              class="rounded-md border border-default bg-elevated/40 p-3 font-mono text-xs break-all leading-relaxed min-h-32"
            >
              {{ report.canonical }}
            </div>
            <UAlert
              v-else-if="errorLine"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-x"
              :title="`${errorLine.name}${errorLine.code ? ` (${errorLine.code})` : ''}`"
              :description="errorLine.message"
            />

            <div class="grid gap-2 sm:grid-cols-2">
              <StatTile
                label="Canonical size"
                size="sm"
                :note="`${fmtNum(report.canonical?.length ?? 0, { digits: 0 })} UTF-16 units`"
              >
                <template #value>{{ fmtBytes(report.bytes ?? 0) }}</template>
              </StatTile>
              <StatTile label="SHA-256" size="sm">
                <template #value>
                  <span class="block text-[11px] break-all leading-relaxed">
                    {{ report.hash ?? '—' }}
                  </span>
                </template>
                <template #note>publish this next to the record</template>
              </StatTile>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                :color="sameHash ? 'success' : 'neutral'"
                variant="subtle"
                size="sm"
                :icon="sameHash ? 'i-lucide-check' : 'i-lucide-info'"
              >
                {{
                  sameHash
                    ? 'same content re-spelled (keys reversed, 4-space indent) → identical hash'
                    : 're-spelling check unavailable'
                }}
              </UBadge>
              <UBadge
                v-if="matchesVector !== undefined"
                :color="matchesVector ? 'success' : 'error'"
                variant="subtle"
                size="sm"
                :icon="matchesVector ? 'i-lucide-badge-check' : 'i-lucide-circle-x'"
              >
                {{
                  matchesVector
                    ? 'matches the published reference output byte for byte'
                    : 'does NOT match the published reference output'
                }}
              </UBadge>
            </div>
          </div>
        </div>

        <CodeSnippet :code="snippet" title="what this section ran" />
      </div>

      <template #footer>
        <HonestNote variant="exact">
          The hash is exact and reproducible by any conforming JCS implementation. It proves that two
          parties hashed the same structured content — not when they wrote it, and not that anyone
          followed it. `canonicalize` is byte-identical to `canonicalJson` in
          <code>@mindpeeker/negentropy</code> for every value both accept, so registration digests
          agree across packages.
        </HonestNote>
      </template>
    </DemoSection>

    <DemoSection
      id="refused"
      title="What it refuses, and why refusing is the feature"
      description="JSON.stringify coerces: a Date becomes a string, a Map becomes {}, NaN becomes null, an undefined member disappears. Each of those lets two different records share one hash. canonicalize throws a typed LedgerError instead — every row below is computed live."
      :api="['canonicalize', 'LedgerError', 'MAX_JSON_DEPTH']"
      :level="2"
    >
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted text-xs uppercase">
            <tr>
              <th class="text-left py-1.5 pr-3 font-medium">value</th>
              <th class="text-left py-1.5 px-3 font-medium">what JSON.stringify would do</th>
              <th class="text-left py-1.5 pl-3 font-medium">canonicalize</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rejected" :key="row.label" class="border-t border-default align-top">
              <td class="py-2 pr-3">
                <div class="font-semibold text-highlighted">{{ row.label }}</div>
                <code class="block mt-1 text-[11px] text-primary break-all">{{ row.code }}</code>
              </td>
              <td class="py-2 px-3 text-xs text-muted max-w-md">{{ row.why }}</td>
              <td class="py-2 pl-3">
                <UBadge
                  :color="row.accepted ? 'error' : 'success'"
                  variant="subtle"
                  size="sm"
                  class="font-mono"
                >
                  {{ row.accepted ? 'accepted (unexpected)' : `${row.name} (${row.errorCode})` }}
                </UBadge>
                <div class="mt-1 text-[11px] text-dimmed break-words">{{ row.message }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template #footer>
        <HonestNote variant="fixed-in-0.2">
          Version 0.1's <code>canonicalJson</code> wrote a Date as its ISO string and a Map as
          <code>{}</code>, so two different experiment configurations could produce the same
          registration hash. 0.2.0 rejects every value JSON cannot represent losslessly; convert them
          explicitly — a Date with <code>toISOString()</code>, bytes with <code>toHex</code>, a
          BigInt with its decimal string — so the reader sees exactly what you hashed.
        </HonestNote>
      </template>
    </DemoSection>
  </div>
</template>
