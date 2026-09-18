<script setup lang="ts">
/**
 * Section 2 — the uniqueness break 0.2.0 closed.
 *
 * For each T the worker evaluates honestly, then proves the NEGATED claim n − y
 * the way 0.1.0 allowed, checks it with a range-only verifier written for this
 * page (which accepts), and with the shipped `pietrzakVerify` (which does not).
 * The same for Wesolowski's n − π.
 */
import { getBytes, sourceSummary } from '~/lib/entropy'
import { fmtDuration, fmtNum, toHex } from '~/lib/format'
import type { ForgeryResult, ModulusId } from '~/lib/vdf/jobs'
import { ellipsizeHex, MODULUS_META } from '~/lib/vdf/jobs'
import { runVdfJob } from '~/lib/vdf/worker-client'

const T_CHOICES = [
  { label: '3', value: '3' },
  { label: '5', value: '5' },
  { label: '1000', value: '1000' },
  { label: '1024', value: '1024' },
]

const chosen = ref<string[]>(['3', '5', '1000', '1024'])
const modulusId = ref<ModulusId>('rsa2048')
const phase = ref<string>()
const inputHex = ref<string>()

const task = useTask<ForgeryResult>()

const MODULUS_ITEMS = Object.values(MODULUS_META).map((m) => ({ label: m.label, value: m.id }))

const orderedTs = computed(() =>
  T_CHOICES.filter((c) => chosen.value.includes(c.value)).map((c) => Number(c.value)),
)
const result = computed(() => task.result.value)

const allRejected = computed(() => {
  const rows = result.value?.rows ?? []
  return (
    rows.length > 0 &&
    rows.every((r) => !r.sdkVerifyNegated && r.sdkVerifyHonest && !r.wesolowskiNegatedPi)
  )
})
const allForgedUnder01 = computed(() => {
  const rows = result.value?.rows ?? []
  return rows.length > 0 && rows.every((r) => r.rawAccepts)
})

function repairLabel(row: ForgeryResult['rows'][number]): string {
  if (row.repairedBy === 'odd-round') return `odd Tᵢ at round ${row.repairedAtRound}`
  if (row.repairedBy === 'flipped-midpoint') return `sent n − μ at round ${row.repairedAtRound}`
  return 'never repaired'
}

const code = `import { evaluate, pietrzakProve, pietrzakVerify, wesolowskiProve, wesolowskiVerify, RSA2048 } from '@mindpeeker/vdf'

const { y } = await evaluate(input, T)          // canonical: y ≤ (n − 1)/2
const negated = RSA2048.n - y                    // the SAME group element, other representative

// 0.2.0 refuses to even prove it:
await pietrzakProve(input, T, negated)           // throws VdfError('invalid_input')

// and refuses to verify a proof re-derived for it (this page rebuilds that proof
// from hashToGroup + fiatShamirChallenge — see app/lib/vdf/forgery.ts):
await pietrzakVerify(input, T, negated, forged)  // → false

const { pi } = await wesolowskiProve(input, T, y)
await wesolowskiVerify(input, T, y, { T, y, pi: RSA2048.n - pi }) // → false`

async function run(): Promise<void> {
  await task.run(async (signal, setProgress) => {
    setProgress(null)
    phase.value = 'drawing the input bytes'
    const input = await getBytes(32, { signal })
    inputHex.value = toHex(input, { max: 12 })
    return await runVdfJob(
      'forgery',
      { input, Ts: orderedTs.value, modulusId: modulusId.value },
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
</script>

<template>
  <DemoSection
    id="forgery"
    title="The forgery 0.2.0 closed"
    description="0.1.0 verified proofs on raw representatives of Z_n*, where −1 has order 2. A prover claiming the negated output n − y could walk the sign out of the transcript and get a second 'verified' answer for one input. The shipped verifier now works in the signed quadratic residues and rejects every one of these."
    :api="['evaluate', 'pietrzakProve', 'pietrzakVerify', 'wesolowskiProve', 'wesolowskiVerify']"
  >
    <template #controls>
      <UCheckboxGroup
        v-model="chosen"
        :items="T_CHOICES"
        legend="Delays T to attack"
        orientation="horizontal"
        size="sm"
        :ui="{ fieldset: 'flex-wrap gap-x-4' }"
      />
      <UFormField label="Modulus" size="sm" class="w-full sm:w-72">
        <USelect v-model="modulusId" :items="MODULUS_ITEMS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Forge the negated output"
        busy-label="Forging…"
        :disabled="orderedTs.length === 0"
        :hint="
          task.busy.value
            ? phase
            : `${orderedTs.length} delay${orderedTs.length === 1 ? '' : 's'} · ≈1–2 s at RSA-2048, milliseconds at the demo modulus · input from ${sourceSummary().label}`
        "
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <HonestNote variant="fixed-in-0.2" title="Fixed in 0.2.0 — and breaking for stored proofs">
        About half of all 0.1.0 outputs were the non-canonical representative, so every output, proof
        and seal stored under 0.1.0 has to be recomputed.
        <code class="text-primary">hashToGroup</code>, <code class="text-primary">evaluate</code> and
        both provers now return canonical elements in [1, (n−1)/2];
        <code class="text-primary">pietrzakVerify</code> and
        <code class="text-primary">verifySeal</code> return false for any non-canonical y or μᵢ, and
        for an inadmissible Jacobi symbol. The domain tag is
        <code class="text-primary">mindpeeker-vdf-v2</code> and every hash binds the modulus, so
        0.1.0 proof bytes throw <code class="text-primary">unsupported_version</code>.
      </HonestNote>

      <div v-if="!result" class="rounded-md border border-dashed border-default px-3 py-6 text-center text-sm text-muted">
        Nothing forged yet. The attack needs no secret: it only needs a verifier that accepts both
        representatives of the same group element.
      </div>

      <template v-else>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="range-only verifier (0.1.0 logic)"
            :value="allForgedUnder01 ? 'accepted all' : 'mixed'"
            :tone="allForgedUnder01 ? 'error' : 'warning'"
            mono
            note="written for this page, not SDK code — this is what the fix removed"
          />
          <StatTile
            label="pietrzakVerify / wesolowskiVerify"
            :value="allRejected ? 'rejected all' : 'CHECK THIS'"
            :tone="allRejected ? 'success' : 'error'"
            mono
            note="the shipped verifiers, on the same forged transcripts"
          />
          <StatTile
            label="forging cost"
            :value="fmtDuration(result.totalMs)"
            note="no factorization, no secret — just a sign the verifier did not pin down"
          />
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">
              Per delay: how the sign was repaired, and what each verifier answered
            </caption>
            <thead class="text-xs uppercase tracking-wide text-muted">
              <tr class="border-b border-default">
                <th scope="col" class="py-1.5 text-left font-medium">T</th>
                <th scope="col" class="py-1.5 text-right font-medium">Rounds</th>
                <th scope="col" class="py-1.5 text-left font-medium ps-3">Sign repaired by</th>
                <th scope="col" class="py-1.5 text-center font-medium">Range-only</th>
                <th scope="col" class="py-1.5 text-center font-medium">pietrzakVerify</th>
                <th scope="col" class="py-1.5 text-center font-medium">honest y</th>
                <th scope="col" class="py-1.5 text-center font-medium">n − π</th>
              </tr>
            </thead>
            <tbody class="tabular-nums">
              <tr v-for="row in result.rows" :key="row.T" class="border-b border-default/60">
                <td class="py-1.5 font-mono">
                  {{ row.T }}
                  <UBadge v-if="row.powerOfTwo" color="neutral" variant="subtle" size="sm" class="ms-1">2ᵏ</UBadge>
                </td>
                <td class="py-1.5 text-right font-mono">{{ row.rounds }}</td>
                <td class="py-1.5 ps-3 text-xs text-muted">{{ repairLabel(row) }}</td>
                <td class="py-1.5 text-center font-mono text-xs" :class="row.rawAccepts ? 'text-error' : 'text-muted'">
                  {{ row.rawAccepts ? 'accepted' : 'rejected' }}
                </td>
                <td class="py-1.5 text-center font-mono text-xs" :class="row.sdkVerifyNegated ? 'text-error' : 'text-success'">
                  {{ row.sdkVerifyNegated }}
                </td>
                <td class="py-1.5 text-center font-mono text-xs" :class="row.sdkVerifyHonest ? 'text-success' : 'text-error'">
                  {{ row.sdkVerifyHonest }}
                </td>
                <td class="py-1.5 text-center font-mono text-xs" :class="row.wesolowskiNegatedPi ? 'text-error' : 'text-success'">
                  {{ row.wesolowskiNegatedPi }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="result.rows[0]" class="grid gap-3 lg:grid-cols-2">
          <div class="rounded-md border border-default bg-elevated/40 p-3">
            <p class="text-xs uppercase tracking-wide text-muted">
              Two representatives, one group element (T = {{ result.rows[0].T }})
            </p>
            <dl class="mt-2 space-y-1 text-xs">
              <div class="flex gap-2">
                <dt class="w-28 shrink-0 text-muted">canonical y</dt>
                <dd class="font-mono text-success break-all">{{ ellipsizeHex(result.rows[0].honestYHex, 24, 10) }}</dd>
              </div>
              <div class="flex gap-2">
                <dt class="w-28 shrink-0 text-muted">n − y</dt>
                <dd class="font-mono text-error break-all">{{ ellipsizeHex(result.rows[0].negatedYHex, 24, 10) }}</dd>
              </div>
            </dl>
            <p class="mt-2 text-xs text-muted">
              Canonicalisation |a| = min(a, n − a) identifies a with −a, so the order-2 element −1
              disappears and exactly one of these is ever accepted.
            </p>
          </div>

          <div class="rounded-md border border-default bg-elevated/40 p-3">
            <p class="text-xs uppercase tracking-wide text-muted">The prover refuses too</p>
            <p v-if="result.rows[0].proveNegated" class="mt-2 font-mono text-xs text-error break-words">
              {{ result.rows[0].proveNegated.name }} ({{ result.rows[0].proveNegated.code }}):
              {{ result.rows[0].proveNegated.message }}
            </p>
            <p v-else class="mt-2 text-xs text-warning">
              pietrzakProve accepted the negated claim — that should not happen.
            </p>
            <p class="mt-2 text-xs text-muted">
              0.1.0 accepted any y in [1, n). A malformed argument throws; a
              <em>wrong</em> proof only ever returns false.
            </p>
            <p v-if="result.rows[0].signBlindProduct" class="mt-2 text-xs text-muted">
              Wesolowski: |π'^ℓ · x^r| still equals y for π' = n − π, because (n − π)^ℓ = −π^ℓ for odd
              ℓ. A verifier that canonicalised only the product would have accepted two proofs;
              <code class="text-primary">wesolowskiVerify</code> rejects π' for being outside
              [1, (n−1)/2].
            </p>
          </div>
        </div>

        <p v-if="inputHex" class="text-xs text-dimmed">
          input <span class="font-mono">{{ inputHex }}</span> ·
          {{ MODULUS_META[result.modulusId].short }}
        </p>
      </template>

      <CodeSnippet :code="code" title="the calls behind this section" />

      <HonestNote variant="caveat" title="Read the 'accepted' column correctly">
        The range-only verifier is <strong class="text-highlighted">code written for this page</strong>
        (app/lib/vdf/forgery.ts) that reproduces what 0.1.0 did; it is not, and never was, part of
        0.2.0. The transcripts it accepts are built from the shipped, modulus-bound v2 hashes, so the
        comparison isolates exactly one change: the group. Nothing here demonstrates a weakness in
        the current release — it demonstrates why the current release is a breaking change.
      </HonestNote>
    </div>

    <template #footer>
      Pietrzak's soundness argument assumes a group without low-order elements. For n a product of
      two safe primes QR_n^+ has none; RSA-2048's primes are not known to be safe, so the residual
      assumption is that finding a low-order element is hard — as hard as factoring for a
      non-negligible portion of RSA moduli (Seres–Burcsi, eprint 2020/402).
    </template>
  </DemoSection>
</template>
