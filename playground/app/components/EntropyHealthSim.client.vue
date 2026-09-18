<script setup lang="ts">
/** Section 4b — cookbook recipe 12 in the browser: a synthetic device with an
 * injected fault, run through serialEntropy's health tests under both failure
 * modes. */
import { nextMacrotask } from '~/lib/async'
import { cutoffsAt } from '~/lib/entropy/cutoffs'
import {
  CREDIT_BITS_PER_BYTE,
  FAULT_NOTE,
  HEALTH_CASES,
  HEALTH_SNIPPET,
  type HealthOutcome,
  runHealthCase,
  STARTUP_NOTE,
} from '~/lib/entropy/health'
import { fmtDuration, fmtP } from '~/lib/format'

// A raw read of n bytes consumes exactly n raw samples (the 1024 start-up
// samples are released once they pass), and the faults are injected at raw
// offset 2048 — so a case must read past 2 KiB to meet its fault at all.
const sizes = [4096, 8192, 16_384].map((n) => ({
  label: `${n.toLocaleString('en-US')} bytes`,
  value: n,
}))
const bytes = ref(4096)
const results = ref<HealthOutcome[]>([])
const task = useTask<void>()

const cutoffs = computed(() => cutoffsAt(CREDIT_BITS_PER_BYTE, 512))

function run(): void {
  void task.run(async (signal, setProgress) => {
    results.value = []
    for (const [i, testCase] of HEALTH_CASES.entries()) {
      setProgress(i / HEALTH_CASES.length)
      const outcome = await runHealthCase(testCase, bytes.value, signal)
      results.value = [...results.value, outcome]
      await nextMacrotask()
    }
    setProgress(1)
  })
}

const faults = Object.entries(FAULT_NOTE) as [string, string][]
</script>

<template>
  <DemoSection
    title="What the health tests catch — and what they miss"
    :api="['defineProvider', 'serialEntropy', 'onHealthFailure', 'maxHealthFailures']"
    description="A synthetic device with a known fault, wrapped in serialEntropy's SP 800-90B pipeline at a credit of 7 bits per byte. Its clean bytes come from a fixed DRBG seed, so the whole table is reproducible."
  >
    <template #controls>
      <UFormField label="Bytes per case" size="sm">
        <USelect v-model="bytes" :items="sizes" size="sm" class="w-44" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Run 6 cases"
        busy-label="Testing devices…"
        icon="i-lucide-heart-pulse"
        hint="Six cases, two failure modes, both conditioning modes — no network, no hardware. 4 KiB per case finishes in a few hundred milliseconds."
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-3 sm:grid-cols-3 mb-4">
      <StatTile
        label="Credited H"
        :value="`${CREDIT_BITS_PER_BYTE} b/B`"
        note="what this device claims per raw byte"
      />
      <StatTile
        label="RCT cutoff"
        :value="cutoffs.rct"
        :digits="0"
        note="identical bytes in a row before an alarm"
      />
      <StatTile
        label="APT cutoff"
        :value="cutoffs.apt"
        :digits="0"
        note="one value's count in a 512-sample window"
      />
    </div>

    <div class="overflow-x-auto rounded-md border border-default">
      <table class="w-full text-sm border-collapse">
        <caption class="sr-only">Health-test outcome per simulated device fault and failure mode</caption>
        <thead class="bg-elevated/60 text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" class="text-left font-medium px-3 py-2">Device</th>
            <th scope="col" class="text-left font-medium px-3 py-2">onHealthFailure</th>
            <th scope="col" class="text-left font-medium px-3 py-2">Conditioning</th>
            <th scope="col" class="text-left font-medium px-3 py-2">Outcome</th>
            <th scope="col" class="text-right font-medium px-3 py-2">Byte χ² p</th>
            <th scope="col" class="text-right font-medium px-3 py-2">MCV H</th>
            <th scope="col" class="text-right font-medium px-3 py-2">Time</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in results" :key="row.label" class="border-t border-default align-top">
            <td class="px-3 py-2 font-mono text-xs">{{ row.fault }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ row.mode }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ row.raw ? 'raw' : 'conditioned' }}</td>
            <td class="px-3 py-2">
              <UBadge v-if="row.delivered" size="sm" color="success" variant="subtle">
                delivered {{ row.delivered.toLocaleString('en-US') }} bytes
              </UBadge>
              <template v-else>
                <UBadge size="sm" color="error" variant="subtle">{{ row.code }}</UBadge>
                <div class="mt-1 text-xs text-muted max-w-md">{{ row.message }}</div>
              </template>
            </td>
            <td class="px-3 py-2 text-right font-mono text-xs">
              {{ row.chi2P === undefined ? '—' : fmtP(row.chi2P) }}
            </td>
            <td class="px-3 py-2 text-right font-mono text-xs">
              {{ row.mcv === undefined ? '—' : `${row.mcv.toFixed(2)} b/B` }}
            </td>
            <td class="px-3 py-2 text-right font-mono text-xs">{{ fmtDuration(row.ms) }}</td>
          </tr>
          <tr v-if="!results.length && !task.busy.value">
            <td colspan="7" class="px-3 py-6 text-center text-sm text-muted">
              Run the cases to fill this table.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul class="mt-4 grid gap-2 sm:grid-cols-2">
      <li v-for="[fault, note] in faults" :key="fault" class="text-xs">
        <code class="font-mono text-primary">{{ fault }}</code>
        <span class="text-muted"> — {{ note }}</span>
      </li>
    </ul>

    <HonestNote variant="exact" class="mt-4">
      A 16-byte stuck burst fails at once with <code class="font-mono">'throw'</code> and is survived
      with <code class="font-mono">'retest'</code>; a device that goes dead fails at its third alarm
      (the message says “alarm 3 of 3”). {{ STARTUP_NOTE }} In raw mode those held samples are
      released once they pass, so a read of n bytes consumes exactly n raw samples — and because
      both faults are injected at raw offset 2048, a case has to read past 2 KiB to meet its fault
      at all. That is why the smallest size offered here is 4 KiB.
    </HonestNote>

    <HonestNote variant="caveat" class="mt-3">
      The biased device — each bit 1 with probability 17/32 — <strong>passes</strong> the health
      tests, and it should: its true min-entropy, 8·log₂(32/17) ≈ 7.30 bits per byte, is above the
      credit of 7. Health tests certify the credited min-entropy, not fairness. The byte χ² column
      is what catches it (p ≈ 10⁻³⁸ at 16 KiB), and the same device conditioned through SHA-256
      passes both — which must never be read as evidence that the raw device is fair. Most-common-value
      estimates are conservative at these sample sizes, which is why even clean output reads about
      7.2 b/B rather than 8.
    </HonestNote>

    <CodeSnippet class="mt-4" :code="HEALTH_SNIPPET" title="what each row ran" />

    <template #footer>
      In 0.1 the first alarm was fatal, so 6 % of healthy 1 MiB reads failed; 0.2.0 discards the
      pending window, reruns the start-up test and only throws on the third alarm. For unattended
      long-running streams raise <code class="font-mono">maxHealthFailures</code> (e.g. 1000) or
      reopen the stream on <code class="font-mono">health_test</code>.
    </template>
  </DemoSection>
</template>
