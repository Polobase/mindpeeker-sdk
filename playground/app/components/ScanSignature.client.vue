<script setup lang="ts">
/**
 * Tab 4 — signatures: the deterministic SHA-256 → rate mapping, its NFC
 * normalization, and the uniformity of its digits at base 44 and base 336.
 */
import { formatRate, type Rate } from '@mindpeeker/rate'
import { rateFromCharCodes, sha256Hex, signatureToRate } from '@mindpeeker/scan'
import { createYielder } from '~/lib/async'
import { fmtNum } from '~/lib/format'
import { chiSquareUniform, histogramCounts, shortHash } from '~/lib/scan/stats'

const signature = ref('notebook, page 12')
const digitCount = ref(6)

interface Derived {
  base44: Rate
  base336: Rate
  digest: string
  charCodes: number
}
const derived = shallowRef<Derived>()
const deriveError = ref<unknown>()

watch(
  [signature, digitCount],
  async ([text, len]) => {
    try {
      const [base44, base336, digest] = await Promise.all([
        signatureToRate(text, { length: len, base: 44 }),
        signatureToRate(text, { length: len, base: 336 }),
        sha256Hex(text),
      ])
      derived.value = { base44, base336, digest, charCodes: rateFromCharCodes(text) }
      deriveError.value = undefined
    } catch (error) {
      derived.value = undefined
      deriveError.value = error
    }
  },
  { immediate: true },
)

// ── NFC: the same text a person typed, two encodings ──────────────────────
const PRECOMPOSED = String.fromCharCode(99, 97, 102, 0x00e9) // 'café' — precomposed
const DECOMPOSED = String.fromCharCode(99, 97, 102, 101, 0x0301) // 'café' — e + combining acute
const PRECOMPOSED_LABEL = 'caf + U+00E9 (precomposed e-acute)'
const DECOMPOSED_LABEL = 'cafe + U+0301 (combining acute)'
const nfc = shallowRef<{ a: string; b: string; equal: boolean }>()
onMounted(async () => {
  const [a, b] = await Promise.all([
    signatureToRate(PRECOMPOSED, { base: 44 }),
    signatureToRate(DECOMPOSED, { base: 44 }),
  ])
  nfc.value = { a: formatRate(a, { pad: true }), b: formatRate(b, { pad: true }), equal: formatRate(a) === formatRate(b) }
})

// ── uniformity over many signatures ───────────────────────────────────────
const base = ref(44)
const sampleSize = ref(300)

interface Uniformity {
  base: number
  digits: number[]
  counts: number[]
  distinct: number
  signatures: number
  fit: { statistic: number; df: number; p: number }
}
const task = useTask<Uniformity>()
const uniformity = computed(() => task.result.value)

function go(): void {
  void task.run(async (signal, setProgress) => {
    const tick = createYielder(8, signal)
    const b = base.value
    const n = sampleSize.value
    const digits: number[] = []
    for (let i = 0; i < n; i++) {
      const rate = await signatureToRate(`${signature.value} #${i + 1}`, { length: digitCount.value, base: b })
      for (const d of rate.digits) digits.push(d)
      if ((i & 15) === 0) {
        setProgress(i / n)
        await tick()
      }
    }
    const counts = histogramCounts(digits, b)
    const distinct = counts.reduce((acc, c) => acc + (c > 0 ? 1 : 0), 0)
    return {
      base: b,
      digits,
      counts,
      distinct,
      signatures: n,
      fit: chiSquareUniform(counts, digits.length / b),
    }
  })
}

const bins = computed(() => {
  const b = uniformity.value?.base ?? base.value
  return b <= 64 ? b : 84
})
const expectedDensity = computed(() => {
  const b = uniformity.value?.base ?? base.value
  return () => 1 / b
})
const expectedPerDigit = computed(() =>
  uniformity.value ? uniformity.value.digits.length / uniformity.value.base : 0,
)

const snippet = computed(
  () => `import { rateFromCharCodes, sha256Hex, signatureToRate } from '@mindpeeker/scan'
import { formatRate } from '@mindpeeker/rate'

const rate = await signatureToRate(${JSON.stringify(signature.value)}, { length: ${digitCount.value}, base: ${base.value} })
formatRate(rate, { pad: true })          // '${derived.value ? formatRate(base.value === 336 ? derived.value.base336 : derived.value.base44, { pad: true }) : '…'}'
await sha256Hex(${JSON.stringify(signature.value)})   // the witness hash a receipt records
rateFromCharCodes(${JSON.stringify(signature.value)}) // ${derived.value ? derived.value.charCodes : '…'} — AetherOnePi's LED rate, √Σ charCodes

// NFC first: U+00E9 and 'e' + U+0301 are the same text, so the same rate.`,
)
</script>

<template>
  <div class="flex flex-col gap-6">
    <DemoSection
      id="scan-signature"
      title="1 · A signature becomes a rate"
      description="A deterministic SHA-256 mapping: normalize to NFC, then read each digit from the hash bit stream by rejection, so every digit is exactly uniform. Nothing is drawn from an entropy source, and nothing is sent anywhere."
      :api="['signatureToRate', 'sha256Hex', 'rateFromCharCodes', 'formatRate']"
    >
      <div class="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <UFormField label="Witness signature" help="a name, a phrase, anything reproducible">
          <UInput v-model="signature" class="w-full" />
        </UFormField>
        <UFormField label="Rate digits (length)" help="1…4096">
          <UInputNumber v-model="digitCount" :min="1" :max="24" class="w-full" />
        </UFormField>
      </div>

      <ErrorAlert :err="deriveError" :dismissible="false" title="signatureToRate rejected that input" />

      <div v-if="derived" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="base 44 rate" size="sm" tone="primary">
          <template #value>
            <span class="text-lg">{{ formatRate(derived.base44, { pad: true }) }}</span>
          </template>
          <template #note>6-bit draws, accepted below 44 — exactly uniform</template>
        </StatTile>
        <StatTile label="base 336 rate (Combe)" size="sm" tone="primary">
          <template #value>
            <span class="text-lg">{{ formatRate(derived.base336, { pad: true }) }}</span>
          </template>
          <template #note>9-bit draws — every digit reachable</template>
        </StatTile>
        <StatTile label="SHA-256 (witness hash)" :value="shortHash(derived.digest, 14)" size="sm" note="what a receipt records" />
        <StatTile
          label="rateFromCharCodes"
          :value="derived.charCodes"
          :digits="2"
          size="sm"
          note="√Σ char codes — AetherOnePi's LED rate"
        />
      </div>

      <div v-if="nfc" class="mt-3 flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <UBadge :color="nfc.equal ? 'success' : 'error'" variant="subtle" :icon="nfc.equal ? 'i-lucide-check' : 'i-lucide-x'">
            NFC normalization
          </UBadge>
          <code class="font-mono text-xs">{{ PRECOMPOSED_LABEL }} &#8594; {{ nfc.a }}</code>
          <span class="text-muted">·</span>
          <code class="font-mono text-xs">{{ DECOMPOSED_LABEL }} &#8594; {{ nfc.b }}</code>
        </div>
        <p class="text-xs text-muted">
          Precomposed é and e + combining acute are the same text to a person and to a keyboard, and
          now to the mapping: both normalize to NFC before hashing.
        </p>
      </div>

      <CodeSnippet :code="snippet" title="the mapping, end to end" />

      <HonestNote variant="fixed-in-0.2">
        0.1 took <code class="font-mono">⌊byte · base / 256⌋</code> per digit — as non-uniform as
        <code class="font-mono">% base</code> for 44, able to reach only 256 of base 336's digits,
        and it repeated the digest past 32 digits. 0.2.0 rejection-samples from an extended digest,
        so base 44 is exactly uniform and base 336 is fully reachable. The rates differ from 0.1's
        for the same signature.
      </HonestNote>

      <template #footer>
        Using a signature as a witness goes back to Abrams' 1923 handwriting claims. The hash is a
        fixed function of the text: it carries no information about the person, and the rate it
        produces is a label, not a measurement.
      </template>
    </DemoSection>

    <DemoSection
      id="scan-signature-uniformity"
      title="2 · Are the digits uniform?"
      description="Hash many signatures, count every digit, and compare the counts with the flat expectation. Modelling SHA-256 as a random function, each digit is exactly uniform — so this is a check on the implementation, not a discovery."
      :api="['signatureToRate', 'chi2Sf']"
    >
      <template #controls>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          :label="`Hash ${sampleSize} signatures`"
          busy-label="Hashing…"
          hint="no entropy source is touched — SHA-256 only"
          @run="go"
          @cancel="task.cancel()"
        >
          <UFormField label="base" size="xs" class="w-28">
            <USelect
              v-model="base"
              :items="[
                { label: '44', value: 44 },
                { label: '336', value: 336 },
                { label: '10', value: 10 },
                { label: '100', value: 100 },
              ]"
              class="w-full"
            />
          </UFormField>
          <UFormField label="signatures" size="xs" class="w-32">
            <UInputNumber v-model="sampleSize" :min="20" :max="3000" :step="100" class="w-full" />
          </UFormField>
        </RunControls>
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div v-if="uniformity" class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="digits drawn"
            :value="uniformity.digits.length"
            :digits="0"
            size="sm"
            :note="`${uniformity.signatures} signatures × ${digitCount}`"
          />
          <StatTile
            label="distinct digits seen"
            :value="`${uniformity.distinct} of ${uniformity.base}`"
            size="sm"
            :tone="uniformity.distinct === uniformity.base ? 'success' : 'neutral'"
            note="base 336 must reach all 336"
          />
          <StatTile
            label="expected per digit"
            :value="expectedPerDigit"
            :digits="1"
            size="sm"
            note="flat expectation"
          />
          <StatTile
            label="χ² goodness of fit"
            :value="uniformity.fit.statistic"
            :digits="1"
            size="sm"
            :note="`df ${uniformity.fit.df} — expected ≈ ${uniformity.fit.df}`"
          />
        </div>
        <div class="flex flex-wrap items-center gap-3 text-sm">
          <span class="text-muted">uniformity of the digit counts</span>
          <PValue :p="uniformity.fit.p" kind="exact" label="χ² p" />
          <span class="text-xs text-muted">
            a p near 0 or 1 is equally unremarkable here — this tests the implementation, not a
            hypothesis about anyone.
          </span>
        </div>
        <Histogram
          :values="uniformity.digits"
          :bins="bins"
          :domain="[0, uniformity.base]"
          density
          :reference="expectedDensity"
          :reference-label="`uniform 1/${uniformity.base}`"
          x-label="digit"
          y-label="density"
          :height="240"
          :aria-label="`Digit frequencies over ${uniformity.digits.length} rate digits at base ${uniformity.base}, against the uniform expectation`"
        />
        <p class="text-xs text-muted">
          {{
            uniformity.base <= 64
              ? 'One bar per digit.'
              : `Bars group ${fmtNum(uniformity.base / bins, { digits: 1 })} digits each; the “distinct digits seen” tile is the exact reachability check.`
          }}
        </p>
      </div>
      <p v-else-if="!task.busy.value" class="text-sm text-muted">
        Nothing has run yet. At base 44 the acceptance rate is 44/64 per 6-bit draw; at base 336 it
        is 336/512 per 9-bit draw. Both are exactly uniform by construction — the chart is a check,
        not a claim.
      </p>

      <template #footer>
        The mapping is deterministic: the same signature always yields the same rate, because it is
        a function of a hash and not a draw from an entropy source.
      </template>
    </DemoSection>
  </div>
</template>
