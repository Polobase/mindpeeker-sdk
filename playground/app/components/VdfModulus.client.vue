<script setup lang="ts">
/**
 * Section 3 — `checkModulus` against six moduli, one per failure mode.
 *
 * Every rejection here is a modulus whose group order is known or trivially
 * computable, which silently removes the whole sequentiality guarantee. The
 * acceptances are the interesting half: "ok" means "not obviously broken".
 */
import { fmtDuration, fmtNum } from '~/lib/format'
import type { ModulusResult } from '~/lib/vdf/jobs'
import { runVdfJob } from '~/lib/vdf/worker-client'

const minBits = ref(2048)
const phase = ref<string>()
const task = useTask<ModulusResult>()

const MIN_BITS_ITEMS = [
  { label: '2048 — RECOMMENDED_MODULUS_BITS (default)', value: 2048 },
  { label: '1024 — below every current recommendation', value: 1024 },
  { label: '256 — test moduli only', value: 256 },
  { label: '64 — MIN_MODULUS_BITS, the hard floor', value: 64 },
]

const ISSUES: Record<string, string> = {
  not_positive: 'n ≤ 0 — not a modulus at all',
  even: 'even n is never an RSA modulus',
  too_small: 'fewer bits than the policy requires',
  small_factor: 'a prime factor below 2¹⁶ — trial division by all 6542 of them',
  perfect_power: 'n = rᵏ — an integer k-th root recovers r, so the order follows',
  prime: 'a prime has the public order n − 1: no sequentiality at all',
  not_1_mod_4: 'n ≡ 3 (mod 4): not a product of two safe primes, and the Jacobi check is vacuous',
}

const result = computed(() => task.result.value)
const okCount = computed(() => result.value?.rows.filter((r) => r.ok).length ?? 0)

const code = computed(
  () => `import { checkModulus, MIN_MODULUS_BITS, RECOMMENDED_MODULUS_BITS } from '@mindpeeker/vdf'

const check = checkModulus({ n }, { minBits: ${minBits.value} })
// { ok: boolean, bits: number, reasons: readonly [{ code, message }] }
if (!check.ok) throw new Error(check.reasons.map((r) => r.code).join(', '))`,
)

async function run(): Promise<void> {
  await task.run(async (signal, setProgress) => {
    setProgress(null)
    return await runVdfJob(
      'modulus',
      { minBits: minBits.value },
      {
        signal,
        onProgress: (label, fraction) => {
          phase.value = label
          setProgress(fraction)
        },
      },
    )
  })
  phase.value = undefined
}

watch(minBits, () => {
  void run()
})

onMounted(() => {
  void run()
})
</script>

<template>
  <DemoSection
    id="modulus"
    title="Is this modulus usable?"
    description="The whole construction rests on nobody knowing φ(n). checkModulus runs the cheap tests that catch a modulus whose order is obviously known — and says so about the ones it cannot check."
    :api="['checkModulus', 'MIN_MODULUS_BITS', 'RECOMMENDED_MODULUS_BITS']"
  >
    <template #controls>
      <UFormField label="minBits policy" size="sm" class="w-full sm:w-80">
        <USelect v-model="minBits" :items="MIN_BITS_ITEMS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Re-run the checks"
        busy-label="Checking…"
        icon="i-lucide-shield-check"
        :hint="task.busy.value ? phase : 'six moduli, one per failure mode — all local, no network'"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div v-if="!result" class="rounded-md border border-dashed border-default px-3 py-6 text-center text-sm text-muted">
        Running the modulus policy…
      </div>

      <template v-else>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="policy minBits" :value="fmtNum(result.minBits, { digits: 0 })" note="what this run required" />
          <StatTile label="hard floor" :value="fmtNum(result.hardFloor, { digits: 0 })" note="MIN_MODULUS_BITS — minBits cannot go below it" />
          <StatTile label="recommended" :value="fmtNum(result.recommended, { digits: 0 })" note="RECOMMENDED_MODULUS_BITS, the default" />
          <StatTile label="accepted" :value="`${okCount} / ${result.rows.length}`" :tone="okCount > 0 ? 'success' : 'neutral'" :note="`all six checked in ${fmtDuration(result.totalMs)}`" />
        </div>

        <div class="flex flex-col gap-2">
          <div
            v-for="row in result.rows"
            :key="row.id"
            class="rounded-md border p-3"
            :class="row.ok ? 'border-success/40 bg-success/5' : 'border-default bg-elevated/30'"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span class="text-sm font-semibold text-highlighted">{{ row.label }}</span>
              <span class="flex items-center gap-2 text-xs">
                <code class="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-muted">{{ row.expr }}</code>
                <span class="font-mono tabular-nums text-muted">{{ fmtNum(row.bits, { digits: 0 }) }} bits</span>
                <UBadge :color="row.ok ? 'success' : 'error'" variant="subtle" size="sm">
                  {{ row.ok ? 'ok' : `${row.reasons.length} reason${row.reasons.length === 1 ? '' : 's'}` }}
                </UBadge>
                <span class="font-mono tabular-nums text-dimmed">{{ fmtDuration(row.ms) }}</span>
              </span>
            </div>
            <p class="mt-1.5 text-xs text-muted">{{ row.note }}</p>
            <ul v-if="row.reasons.length" class="mt-2 space-y-1">
              <li v-for="reason in row.reasons" :key="reason.code" class="flex flex-wrap items-baseline gap-2 text-xs">
                <code class="rounded bg-error/10 px-1.5 py-0.5 font-mono text-[11px] text-error">{{ reason.code }}</code>
                <span class="text-highlighted">{{ reason.message }}</span>
                <span class="text-dimmed">— {{ ISSUES[reason.code] ?? '' }}</span>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <CodeSnippet :code="code" title="the call behind every row" />

      <HonestNote variant="caveat" title="'ok' is not 'safe'">
        These checks reject moduli whose order is <em>obviously</em> known. They cannot certify a
        good one: whether n = pq with safe primes, whether anyone still holds the factors, and
        whether low-order elements exist are all undecidable without the factorization. The 256-bit
        demo modulus above passes at minBits 256 — and its two primes are printed in this
        repository, so a VDF over it has no sequentiality whatsoever. RSA-2048 passes too, and rests
        on RSA Laboratories' statement that the primes were generated air-gapped and destroyed:
        a trust statement, not a proof, and there was no public ceremony.
      </HonestNote>
    </div>

    <template #footer>
      If that residual trust is unacceptable, plug in your own modulus — every API takes
      <code class="text-primary">{ n: bigint }</code> — for instance one from a multi-party RSA
      generation ceremony, and run <code class="text-primary">checkModulus</code> on it first.
    </template>
  </DemoSection>
</template>
