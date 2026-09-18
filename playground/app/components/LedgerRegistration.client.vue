<script setup lang="ts">
/**
 * §6a — the pre-registration record, modelled on the Koestler Parapsychology
 * Unit registry. Edit the form, watch the canonical envelope and its hash
 * change, and break it on purpose to see exactly which path the validator
 * names.
 */
import {
  REGISTRATION_SCHEMA,
  registrationCanonical,
  registrationHash,
  validateRegistration,
} from '@mindpeeker/ledger'
import { errorInfo } from '~/lib/errors'
import {
  compactRecord,
  defaultDraft,
  FAULTS,
  type RegistrationDraft,
  toRegistration,
} from '~/lib/ledger/registration'
import { currentRegistrationHash, currentRegistrationTitle } from '~/lib/ledger/state'

const draft = ref<RegistrationDraft>(defaultDraft())
const fault = ref('none')

interface Built {
  readonly canonical: string
  readonly hash: string
  readonly bytes: number
}

const built = shallowRef<Built>()
const error = ref<unknown>()

// Typing fires this faster than SHA-256 resolves; only the newest run may write.
let seq = 0
watch(
  [draft, fault],
  () => {
    const mine = ++seq
    void (async () => {
      const base = (await toRegistration(draft.value)) as unknown as Record<string, unknown>
      const chosen = FAULTS.find((f) => f.value === fault.value) ?? FAULTS[0]
      const record = compactRecord(chosen?.apply({ ...base }) ?? base)
      try {
        const registration = validateRegistration(record)
        const canonical = registrationCanonical(registration)
        const hash = await registrationHash(registration)
        if (mine !== seq) return
        built.value = { canonical, hash, bytes: new TextEncoder().encode(canonical).length }
        error.value = undefined
        currentRegistrationHash.value = hash
        currentRegistrationTitle.value = registration.title
      } catch (thrown) {
        if (mine !== seq) return
        built.value = undefined
        error.value = thrown
        currentRegistrationHash.value = undefined
      }
    })()
  },
  { deep: true, immediate: true },
)

const info = computed(() => (error.value === undefined ? undefined : errorInfo(error.value)))
const stage = computed(() =>
  info.value?.code === 'invalid_json'
    ? 'the schema passed; canonicalize refused the content'
    : 'validateRegistration refused the record',
)
const expectation = computed(() => FAULTS.find((f) => f.value === fault.value)?.expect ?? '')

const pretty = computed(() => {
  const canonical = built.value?.canonical
  if (canonical === undefined) return ''
  return JSON.stringify(JSON.parse(canonical), null, 2)
})

function addHypothesis(): void {
  draft.value.hypotheses.push({
    id: `H${draft.value.hypotheses.length + 1}`,
    statement: '',
    kind: 'exploratory',
    statistic: '',
    nullDist: '',
    direction: 'two-sided',
  })
}

function addSource(): void {
  draft.value.dataSources.push({ name: '', description: '', role: '' })
}

const KINDS = [
  { label: 'confirmatory', value: 'confirmatory' },
  { label: 'exploratory', value: 'exploratory' },
]
const DIRECTIONS = ['two-sided', 'greater', 'less'].map((d) => ({ label: d, value: d }))
const CORRECTIONS = [
  { label: '— none set —', value: '' },
  { label: 'none', value: 'none' },
  { label: 'bonferroni', value: 'bonferroni' },
  { label: 'holm', value: 'holm' },
  { label: 'benjamini-hochberg', value: 'benjamini-hochberg' },
]
const ROLES = [
  { label: '— unset —', value: '' },
  { label: 'experimental', value: 'experimental' },
  { label: 'control', value: 'control' },
]

const snippet = computed(
  () => `import { registrationCanonical, registrationHash, validateRegistration } from '@mindpeeker/ledger'

const registration = validateRegistration(record)   // unknown fields rejected, defaults normalized
const canonical = registrationCanonical(registration)
// canonicalize({ schema: '${REGISTRATION_SCHEMA}', registration })
const hash = await registrationHash(registration)
// ${built.value?.hash ?? 'a LedgerError instead — see above'}

// Publish BOTH: the canonical text so anyone can recompute the digest with any
// JCS implementation, and the hash where you cannot rewrite it. Then use it as
// a chain genesis (startChain), a psi recordSession registration, and the
// registrationHash of a time bracket.`,
)
</script>

<template>
  <DemoSection
    id="registration"
    title="Freeze the plan, publish the hash"
    description="The fields follow the Koestler Parapsychology Unit study registry: hypotheses tagged confirmatory or exploratory, each confirmatory one with its statistic, null and direction; the primary hypothesis and α; a fixed or sequential sample plan; a digest of the analysis code; exclusions; and data sources. Every edit changes the hash, and the old hash still describes exactly the old plan."
    :api="['validateRegistration', 'registrationCanonical', 'registrationHash', 'REGISTRATION_SCHEMA']"
  >
    <template #controls>
      <UFormField label="Break it on purpose" size="sm" class="w-full sm:w-96">
        <USelect
          v-model="fault"
          :items="FAULTS.map((f) => ({ label: f.label, value: f.value }))"
          size="sm"
          class="w-full"
        />
      </UFormField>
      <UButton
        size="sm"
        variant="soft"
        color="neutral"
        icon="i-lucide-rotate-ccw"
        @click="draft = defaultDraft()"
      >
        Reset form
      </UButton>
    </template>

    <div class="flex flex-col gap-4">
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div class="flex flex-col gap-3 min-w-0">
          <div class="grid gap-2 sm:grid-cols-2">
            <UFormField label="Title" size="sm">
              <UInput v-model="draft.title" size="sm" class="w-full" />
            </UFormField>
            <UFormField label="Authors (comma separated)" size="sm">
              <UInput v-model="draft.authors" size="sm" class="w-full" />
            </UFormField>
          </div>

          <div class="rounded-md border border-default bg-elevated/40 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold text-highlighted">Hypotheses</h3>
              <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addHypothesis">
                Add
              </UButton>
            </div>
            <div class="mt-2 flex flex-col gap-2">
              <div
                v-for="(hypothesis, index) in draft.hypotheses"
                :key="index"
                class="grid grid-cols-2 gap-2 sm:grid-cols-[5rem_minmax(0,1.6fr)_8rem_minmax(0,1fr)_7rem_7rem_2.5rem] sm:items-end"
              >
                <UFormField :label="index === 0 ? 'id' : undefined" size="xs">
                  <UInput
                    v-model="hypothesis.id"
                    size="xs"
                    class="w-full"
                    :aria-label="`hypothesis ${index + 1} id`"
                  />
                </UFormField>
                <UFormField :label="index === 0 ? 'statement' : undefined" size="xs">
                  <UInput
                    v-model="hypothesis.statement"
                    size="xs"
                    class="w-full"
                    :aria-label="`hypothesis ${index + 1} statement`"
                  />
                </UFormField>
                <UFormField :label="index === 0 ? 'kind' : undefined" size="xs">
                  <USelect
                    v-model="hypothesis.kind"
                    :items="KINDS"
                    size="xs"
                    class="w-full"
                    :aria-label="`hypothesis ${index + 1} kind`"
                  />
                </UFormField>
                <UFormField :label="index === 0 ? 'statistic' : undefined" size="xs">
                  <UInput
                    v-model="hypothesis.statistic"
                    size="xs"
                    class="w-full"
                    :aria-label="`hypothesis ${index + 1} statistic`"
                  />
                </UFormField>
                <UFormField :label="index === 0 ? 'null' : undefined" size="xs">
                  <UInput
                    v-model="hypothesis.nullDist"
                    size="xs"
                    class="w-full"
                    :aria-label="`hypothesis ${index + 1} null distribution`"
                  />
                </UFormField>
                <UFormField :label="index === 0 ? 'direction' : undefined" size="xs">
                  <USelect
                    v-model="hypothesis.direction"
                    :items="DIRECTIONS"
                    size="xs"
                    class="w-full"
                    :aria-label="`hypothesis ${index + 1} direction`"
                  />
                </UFormField>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  :aria-label="`remove hypothesis ${hypothesis.id}`"
                  :disabled="draft.hypotheses.length < 2"
                  @click="draft.hypotheses.splice(index, 1)"
                />
              </div>
            </div>
            <p class="mt-2 text-[11px] text-muted">
              A confirmatory hypothesis must name its statistic, null and direction; an exploratory
              one need not. More than one confirmatory hypothesis makes
              <code>correction</code> required.
            </p>
          </div>

          <div class="grid gap-2 sm:grid-cols-4">
            <UFormField label="Primary (a confirmatory id)" size="sm" class="sm:col-span-2">
              <UInput v-model="draft.primary" size="sm" class="w-full" />
            </UFormField>
            <UFormField label="alpha" size="sm">
              <UInputNumber
                v-model="draft.alpha"
                :min="0"
                :max="1"
                :step="0.005"
                size="sm"
                class="w-full"
              />
            </UFormField>
            <UFormField label="correction" size="sm">
              <USelect v-model="draft.correction" :items="CORRECTIONS" size="sm" class="w-full" />
            </UFormField>
          </div>

          <div class="grid gap-2 sm:grid-cols-4">
            <UFormField label="Sample plan" size="sm">
              <USelect
                v-model="draft.sampleKind"
                :items="[
                  { label: 'fixed', value: 'fixed' },
                  { label: 'sequential', value: 'sequential' },
                ]"
                size="sm"
                class="w-full"
              />
            </UFormField>
            <template v-if="draft.sampleKind === 'fixed'">
              <UFormField label="size" size="sm">
                <UInputNumber v-model="draft.size" :min="1" size="sm" class="w-full" />
              </UFormField>
              <UFormField label="unit" size="sm" class="sm:col-span-2">
                <UInput v-model="draft.unit" size="sm" class="w-full" />
              </UFormField>
            </template>
            <template v-else>
              <UFormField label="minSize" size="sm">
                <UInputNumber v-model="draft.minSize" :min="1" size="sm" class="w-full" />
              </UFormField>
              <UFormField label="maxSize" size="sm">
                <UInputNumber v-model="draft.maxSize" :min="1" size="sm" class="w-full" />
              </UFormField>
              <UFormField label="unit" size="sm">
                <UInput v-model="draft.unit" size="sm" class="w-full" />
              </UFormField>
              <UFormField label="stopping rule" size="sm" class="sm:col-span-4">
                <UInput v-model="draft.rule" size="sm" class="w-full" />
              </UFormField>
            </template>
          </div>

          <div class="rounded-md border border-default bg-elevated/40 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold text-highlighted">Data sources</h3>
              <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addSource">Add</UButton>
            </div>
            <div class="mt-2 flex flex-col gap-2">
              <div
                v-for="(source, index) in draft.dataSources"
                :key="index"
                class="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_9rem_2.5rem] sm:items-end"
              >
                <UFormField :label="index === 0 ? 'name' : undefined" size="xs">
                  <UInput
                    v-model="source.name"
                    size="xs"
                    class="w-full"
                    :aria-label="`data source ${index + 1} name`"
                  />
                </UFormField>
                <UFormField :label="index === 0 ? 'description' : undefined" size="xs">
                  <UInput
                    v-model="source.description"
                    size="xs"
                    class="w-full"
                    :aria-label="`data source ${index + 1} description`"
                  />
                </UFormField>
                <UFormField :label="index === 0 ? 'role' : undefined" size="xs">
                  <USelect
                    v-model="source.role"
                    :items="ROLES"
                    size="xs"
                    class="w-full"
                    :aria-label="`data source ${index + 1} role`"
                  />
                </UFormField>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  :aria-label="`remove data source ${index + 1}`"
                  :disabled="draft.dataSources.length < 2"
                  @click="draft.dataSources.splice(index, 1)"
                />
              </div>
            </div>
          </div>

          <div class="grid gap-2 sm:grid-cols-2">
            <UFormField
              label="Analysis plan (hashed into analysisPlanHash)"
              size="sm"
              hint="never typed by hand"
            >
              <UTextarea v-model="draft.analysisPlan" :rows="3" size="sm" class="w-full" />
            </UFormField>
            <UFormField label="Exclusions (one per line; empty = none)" size="sm">
              <UTextarea v-model="draft.exclusions" :rows="3" size="sm" class="w-full" />
            </UFormField>
          </div>

          <div class="grid gap-2 sm:grid-cols-2">
            <UFormField label="Blinding" size="sm">
              <UInput v-model="draft.blinding" size="sm" class="w-full" />
            </UFormField>
            <UFormField label="Notes" size="sm">
              <UInput v-model="draft.notes" size="sm" class="w-full" />
            </UFormField>
          </div>
        </div>

        <div class="flex flex-col gap-3 min-w-0">
          <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
            <div class="text-[11px] uppercase tracking-wide text-muted">expected outcome</div>
            <div class="text-sm text-highlighted">{{ expectation }}</div>
          </div>

          <UAlert
            v-if="info"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-x"
            :title="`${info.name} (${info.code}) — ${stage}`"
            :description="info.message"
          />

          <StatTile v-if="built" label="registrationHash" size="sm">
            <template #value>
              <span class="block text-[11px] break-all leading-relaxed">{{ built.hash }}</span>
            </template>
            <template #note>
              {{ built.bytes }} canonical bytes hashed · the time bracket below binds this hash
            </template>
          </StatTile>

          <div v-if="built" class="min-w-0">
            <div class="text-[11px] uppercase tracking-wide text-muted mb-1">
              the envelope that gets hashed
            </div>
            <CodeSnippet :code="pretty" lang="json" :title="REGISTRATION_SCHEMA" />
          </div>
        </div>
      </div>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <template #footer>
      <HonestNote variant="caveat" title="Structure, not adequacy">
        Validation is structural. A registration that passes can still be underpowered, test the
        wrong thing, or be written after a first look at the data — the hash proves
        <strong class="text-highlighted">what</strong> was registered, never
        <strong class="text-highlighted">when</strong>. A self-hosted file is not a registry: publish
        the hash where you cannot rewrite it, and bound it from above with an outside witness.
      </HonestNote>
    </template>
  </DemoSection>
</template>
