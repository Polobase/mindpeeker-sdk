<script setup lang="ts">
/** Section 6 — drbgProvider as the control arm: byte-exact replay, and the
 * two ways a replay silently stops being one. */
import {
  CONTROL_SNIPPET,
  probeSeedLength,
  type ReplayReport,
  replayReport,
} from '~/lib/entropy/control'
import { fmtDuration } from '~/lib/format'

const seedLabel = ref(currentSeedLabel())
const personalization = ref('entropy-page/session-42')
const bytes = ref(32)
const byteItems = [16, 32, 64].map((n) => ({ label: `${n} bytes`, value: n }))

const task = useTask<ReplayReport>()
const report = computed(() => task.result.value)

function run(): void {
  void task.run(async () => await replayReport(seedLabel.value, personalization.value, bytes.value))
}

const SEED_LENGTHS = [16, 31, 32, 48]
const seedProbes = computed(() =>
  SEED_LENGTHS.map((length) => ({ length, probe: probeSeedLength(length) })),
)

onMounted(() => run())
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      title="The deterministic control arm"
      :api="['drbgProvider', 'personalization', 'EntropyProvider.name']"
      description="Psi and negentropy protocols compare a physical source against a matched pseudo-random control that replays byte-exactly. drbgProvider is NIST SP 800-90A HMAC_DRBG (SHA-256) over WebCrypto, tested against the NIST CAVP vectors."
    >
      <template #controls>
        <UFormField label="Seed label" size="sm">
          <UInput v-model="seedLabel" size="sm" class="w-56" placeholder="mindpeeker playground" />
        </UFormField>
        <UFormField label="Personalization" size="sm">
          <UInput v-model="personalization" size="sm" class="w-56" placeholder="session-42" />
        </UFormField>
        <UFormField label="Bytes per run" size="sm">
          <USelect v-model="bytes" :items="byteItems" size="sm" class="w-28" />
        </UFormField>
        <RunControls
          :busy="task.busy.value"
          label="Replay"
          busy-label="Generating…"
          icon="i-lucide-repeat"
          hint="Four runs off one seed — instant, and identical on every machine."
          @run="run"
          @cancel="task.cancel()"
        />
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div v-if="report" class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Provider fingerprint"
            :value="report.providerName"
            note="first 4 bytes of SHA-256(seed)"
          />
          <StatTile
            label="Seed length"
            :value="`${report.seedLength} bytes`"
            note="≥ 32 required; ≥ 48 for a conforming 256-bit instantiation"
          />
          <StatTile label="Four runs took" :value="fmtDuration(report.ms)" note="all in WebCrypto" />
        </div>

        <div class="overflow-x-auto rounded-md border border-default">
          <table class="w-full text-sm border-collapse">
            <caption class="sr-only">Four DRBG runs off the same seed and how they compare</caption>
            <thead class="bg-elevated/60 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" class="text-left font-medium px-3 py-2">Run</th>
                <th scope="col" class="text-left font-medium px-3 py-2">First bytes</th>
                <th scope="col" class="text-left font-medium px-3 py-2">vs run A</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.rows" :key="row.label" class="border-t border-default align-top">
                <td class="px-3 py-2">
                  <div class="text-sm text-highlighted">{{ row.label }}</div>
                  <div class="text-xs text-muted">{{ row.detail }}</div>
                </td>
                <td class="px-3 py-2 font-mono text-[11px] break-all text-highlighted">
                  {{ row.hex }}
                </td>
                <td class="px-3 py-2">
                  <UBadge
                    size="sm"
                    :color="row.identical ? 'success' : 'warning'"
                    variant="subtle"
                  >
                    {{ row.identical ? 'byte-identical' : `differs at byte ${row.firstDifference}` }}
                  </UBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <HonestNote variant="exact" class="mt-4">
        One provider is one DRBG instance: <code class="font-mono">getBytes</code> calls and stream
        pulls advance the same state in call order, and each request of n bytes performs
        ⌈n / 65 536⌉ SP 800-90A generate calls. The bytes therefore depend on the seed
        <em>and</em> on the sequence of request sizes — which is why run C above, asking for two
        halves instead of one whole, is a different stream. There is no reseeding.
      </HonestNote>

      <HonestNote variant="caveat" class="mt-3">
        A DRBG is a <strong>control, never a secret</strong>. Anyone holding the seed reproduces
        every byte, so a recorded seed must never protect anything. In an experiment the control arm
        exists to show what your analysis does to bytes that carry no effect at all: if the control
        arm also “shows” the effect, the effect is in the analysis, not in the source.
      </HonestNote>

      <CodeSnippet class="mt-4" :code="CONTROL_SNIPPET" title="what this panel runs" />

      <template #footer>
        The header's “Seeded DRBG” source builds exactly this provider from the seed label you set
        there, so every demo on this site can be replayed byte for byte. This panel adds a
        <code class="font-mono">personalization</code> string, which is part of the SP 800-90A
        instantiation and forks the stream.
      </template>
    </DemoSection>

    <DemoSection
      title="Seed validation"
      :level="3"
      :api="['drbgProvider', 'EntropyError', 'invalid_request']"
      description="The factory validates its seed at construction: under 32 bytes there is not enough material for a 256-bit instantiation, and it says so instead of producing weak bytes."
    >
      <div class="grid gap-2 sm:grid-cols-2">
        <div
          v-for="row in seedProbes"
          :key="row.length"
          class="rounded-md border border-default p-3 flex flex-col gap-1"
        >
          <div class="flex items-center justify-between gap-2">
            <code class="font-mono text-xs text-primary">
              drbgProvider({{ '{' }} seed: new Uint8Array({{ row.length }}) {{ '}' }})
            </code>
            <UBadge size="sm" :color="row.probe.ok ? 'success' : 'error'" variant="subtle">
              {{ row.probe.ok ? 'constructs' : row.probe.error?.code }}
            </UBadge>
          </div>
          <p class="text-xs text-muted break-all">
            {{ row.probe.ok ? row.probe.name : row.probe.error?.message }}
          </p>
        </div>
      </div>
      <template #footer>
        Note that a 32-byte all-zero seed constructs happily — the library checks length, not
        quality. Record a seed drawn from <code class="font-mono">crypto.getRandomValues</code>
        alongside the experiment it controls.
      </template>
    </DemoSection>
  </div>
</template>
