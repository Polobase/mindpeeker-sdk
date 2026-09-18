<script setup lang="ts">
/**
 * §6b — Toeplitz extraction, the accounted pipeline, and the SP 800-90B
 * Output_Entropy calculator behind every conditioning credit.
 */
import {
  type AccountedBytes,
  claimBytes,
  conditionAccounted,
  debiasAccounted,
  extractAccounted,
  outputEntropy,
  toeplitzExtractor,
  toeplitzOutputBits,
  vettedOutputEntropy,
} from '@mindpeeker/negentropy'
import { errorLine } from '~/lib/errors'
import { getBytes } from '~/lib/entropy'
import { fmtBytes, fmtNum, toHex } from '~/lib/format'

const INPUT_BITS = [1024, 2048, 4096].map((n) => ({ label: `${n} bits`, value: n }))
const EPSILONS = [
  { label: 'ε = 2⁻³² (default)', value: 32 },
  { label: 'ε = 2⁻⁶⁴', value: 64 },
  { label: 'ε = 2⁻⁸⁰', value: 80 },
]
const METHODS = [
  { label: "debias 'peres'", value: 'peres' },
  { label: "debias 'von-neumann'", value: 'von-neumann' },
]
const BASES = [
  { label: "'conservative' — never raise the claim", value: 'conservative' },
  { label: "'iid' — full 8 bits per output byte", value: 'iid' },
]
const FINISH = [
  { label: 'conditionAccounted — SHA-256', value: 'condition' },
  { label: 'extractAccounted — Toeplitz', value: 'extract' },
]

/* ---------------------------------------------------------------- Toeplitz */
const inputBits = ref(2048)
const claimPerByte = ref(2)
const epsilonExp = ref(32)

const toeplitzPlan = computed(() => {
  const k = (inputBits.value / 8) * claimPerByte.value
  try {
    const bits = toeplitzOutputBits(k, 2 ** -epsilonExp.value)
    const outputBits = Math.min(bits, inputBits.value - 1)
    return {
      k,
      outputBits,
      clamped: bits > inputBits.value - 1,
      seedBytes: Math.ceil((inputBits.value + outputBits - 1) / 8),
      error: undefined as string | undefined,
    }
  } catch (error) {
    return { k, outputBits: 0, clamped: false, seedBytes: 0, error: errorLine(error) }
  }
})

const extraction = useTask<{ hex: string; outputBits: number; seedBytes: number; k: number }>()
const extracted = computed(() => extraction.result.value)

function runExtract(): void {
  void extraction.run(async (signal, setProgress) => {
    const plan = toeplitzPlan.value
    if (plan.error) throw new Error(plan.error)
    setProgress(0.2)
    const inputBytes = await getBytes(inputBits.value / 8, { signal })
    // The seed may be public, but it must be uniform and INDEPENDENT of the
    // input — a separate draw, never a slice of the stream being extracted.
    const seed = await getBytes(plan.seedBytes, { signal })
    setProgress(0.7)
    const extractor = toeplitzExtractor(seed, inputBits.value, plan.outputBits)
    const out = extractor.extract(inputBytes)
    setProgress(1)
    return {
      hex: toHex(out, { max: 20 }),
      outputBits: plan.outputBits,
      seedBytes: plan.seedBytes,
      k: plan.k,
    }
  })
}

/* ---------------------------------------------------------------- pipeline */
const pipelineBytes = ref(1024)
const pipelineClaim = ref(2)
const method = ref('peres')
const basis = ref('conservative')
const finish = ref('condition')

const pipeline = useTask<AccountedBytes>()
const accounted = computed(() => pipeline.result.value)

function runPipeline(): void {
  void pipeline.run(async (signal, setProgress) => {
    setProgress(0.15)
    const bytes = await getBytes(pipelineBytes.value, { signal })
    let step = claimBytes(bytes, pipelineClaim.value, 'measured')
    setProgress(0.45)
    step = debiasAccounted(step, method.value === 'peres' ? 'peres' : 'von-neumann', {
      basis: basis.value === 'iid' ? 'iid' : 'conservative',
    })
    setProgress(0.7)
    if (finish.value === 'condition') {
      step = await conditionAccounted(step)
    } else {
      const bitsIn = step.bytes.length * 8
      const out = Math.min(toeplitzOutputBits(step.claim.minEntropy), bitsIn - 1)
      const seed = await getBytes(Math.ceil((bitsIn + out - 1) / 8), { signal })
      step = extractAccounted(step, toeplitzExtractor(seed, bitsIn, out))
    }
    setProgress(1)
    return step
  })
}

/* -------------------------------------------------------- Output_Entropy */
const nIn = ref(512)
const nOut = ref(256)
const nw = ref(256)
const hIn = ref(256)

const PRESETS = [
  { label: '512 bits carrying 256', nIn: 512, nOut: 256, nw: 256, hIn: 256, expect: '255.0' },
  { label: '8000 bits carrying 255', nIn: 8000, nOut: 256, nw: 256, hIn: 255, expect: '254.415' },
  { label: '256 bits carrying 256 (ω term)', nIn: 256, nOut: 256, nw: 256, hIn: 256, expect: '251.7' },
  {
    label: 'conditionStream safetyFactor 2 at h = 8',
    nIn: 512,
    nOut: 256,
    nw: 256,
    hIn: 512,
    expect: '255.744',
  },
]

function applyPreset(preset: (typeof PRESETS)[number]): void {
  nIn.value = preset.nIn
  nOut.value = preset.nOut
  nw.value = preset.nw
  hIn.value = preset.hIn
}

const entropyCredit = computed(() => {
  try {
    return {
      raw: outputEntropy(nIn.value, nOut.value, nw.value, hIn.value),
      vetted: vettedOutputEntropy(hIn.value, nOut.value, nIn.value, nw.value),
      cap: 0.999 * nOut.value,
      error: undefined as string | undefined,
    }
  } catch (error) {
    return { raw: Number.NaN, vetted: Number.NaN, cap: Number.NaN, error: errorLine(error) }
  }
})

const snippet = computed(
  () => `import {
  claimBytes, debiasAccounted, conditionAccounted, extractAccounted,
  toeplitzExtractor, toeplitzOutputBits, vettedOutputEntropy,
} from '@mindpeeker/negentropy'

let x = claimBytes(raw, ${pipelineClaim.value}, 'measured')        // ${pipelineBytes.value} bytes, measured bits/byte
x = debiasAccounted(x, '${method.value}', { basis: '${basis.value}' })
${
  finish.value === 'condition'
    ? "x = await conditionAccounted(x)             // min(Output_Entropy(8·inBytes, 256, 256, h_in), 0.999·256)"
    : 'x = extractAccounted(x, toeplitzExtractor(seed, bitsIn, out))  // leftover hash lemma enforced'
}
x.claim   // { minEntropy, epsilon, basis, assumptions }
x.trace   // one row per step: in/out bytes and in/out min-entropy`,
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      id="toeplitz"
      title="Toeplitz extraction"
      description="A seeded 2-universal hash is a strong extractor: with k bits of input min-entropy, m ≤ k − 2·log₂(1/ε) output bits are within ε of uniform even if the seed is public. The seed must be uniform and independent of the input — it is drawn separately here."
      :api="['toeplitzOutputBits', 'toeplitzExtractor']"
    >
      <template #controls>
        <UFormField label="Input" size="sm" class="w-36">
          <USelect v-model="inputBits" :items="INPUT_BITS" size="sm" class="w-full" />
        </UFormField>
        <UFormField
          :label="`Claimed min-entropy: ${claimPerByte.toFixed(2)} bits/byte`"
          size="sm"
          class="w-56"
        >
          <USlider
            v-model="claimPerByte"
            :min="0.25"
            :max="8"
            :step="0.25"
            aria-label="Claimed min-entropy per byte"
          />
        </UFormField>
        <UFormField label="Statistical distance" size="sm" class="w-44">
          <USelect v-model="epsilonExp" :items="EPSILONS" size="sm" class="w-full" />
        </UFormField>
        <RunControls
          :busy="extraction.busy.value"
          :progress="extraction.progress.value"
          :disabled="!!toeplitzPlan.error"
          label="Extract"
          icon="i-lucide-scale"
          :hint="`${fmtBytes(inputBits / 8)} input + ${fmtBytes(toeplitzPlan.seedBytes)} of independent seed`"
          @run="runExtract"
          @cancel="extraction.cancel()"
        />
      </template>

      <ErrorAlert :err="extraction.error.value" @dismiss="extraction.reset()" />
      <UAlert
        v-if="toeplitzPlan.error"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Not enough min-entropy to extract a single bit"
        :description="toeplitzPlan.error"
      />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Input min-entropy k"
          :value="toeplitzPlan.k"
          :digits="1"
          :note="`${inputBits} input bits × ${claimPerByte} bits/byte claim`"
        />
        <StatTile
          label="Output bits m"
          :value="toeplitzPlan.outputBits"
          :digits="0"
          :note="toeplitzPlan.clamped
            ? `clamped: the extractor needs m < inputBits (${inputBits})`
            : `⌊k − 2·log₂(1/ε)⌋ = ⌊${fmtNum(toeplitzPlan.k, { digits: 1 })} − ${2 * epsilonExp}⌋`"
        />
        <StatTile
          label="Seed"
          :value="fmtBytes(toeplitzPlan.seedBytes)"
          :mono="false"
          note="inputBits + outputBits − 1 bits, drawn separately"
        />
        <StatTile
          label="Extracted"
          :value="extracted ? `${extracted.outputBits} bits` : '—'"
          :mono="false"
          :note="extracted?.hex ?? 'press Extract'"
        />
      </div>

      <template #footer>
        <code class="text-primary">toeplitzOutputBits</code> throws
        <code>insufficient_data</code> naming the required k when not even one bit can be extracted
        (k &lt; 65 at ε = 2⁻³²) — never a zero, negative or NaN length. Drag the slider down to see it.
      </template>
    </DemoSection>

    <DemoSection
      id="accounting"
      title="A pipeline that never inflates its own claim"
      description="Every step records what it received and what it credits. No step ever raises the claim it was given — a deterministic map cannot add min-entropy — and no claim exceeds 8 bits per byte held."
      :api="['claimBytes', 'debiasAccounted', 'conditionAccounted', 'extractAccounted']"
    >
      <template #controls>
        <UFormField label="Raw input" size="sm" class="w-32">
          <UInputNumber v-model="pipelineBytes" :min="64" :max="8192" :step="64" size="sm" class="w-full" />
        </UFormField>
        <UFormField
          :label="`Measured h = ${pipelineClaim.toFixed(2)} bits/byte`"
          size="sm"
          class="w-56"
        >
          <USlider
            v-model="pipelineClaim"
            :min="0.25"
            :max="8"
            :step="0.25"
            aria-label="Measured min-entropy per byte"
          />
        </UFormField>
        <UFormField label="Debias" size="sm" class="w-44">
          <USelect v-model="method" :items="METHODS" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Credit basis" size="sm" class="w-64">
          <USelect v-model="basis" :items="BASES" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Final step" size="sm" class="w-60">
          <USelect v-model="finish" :items="FINISH" size="sm" class="w-full" />
        </UFormField>
        <RunControls
          :busy="pipeline.busy.value"
          :progress="pipeline.progress.value"
          label="Run the pipeline"
          icon="i-lucide-layers"
          :hint="`${fmtBytes(pipelineBytes)} raw · claim ${fmtNum(pipelineBytes * pipelineClaim, { digits: 0 })} bits in total`"
          @run="runPipeline"
          @cancel="pipeline.cancel()"
        />
      </template>

      <ErrorAlert :err="pipeline.error.value" @dismiss="pipeline.reset()" />

      <div v-if="accounted" class="flex flex-col gap-3">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-muted text-xs uppercase">
              <tr>
                <th class="text-left py-1.5 pr-3 font-medium">step</th>
                <th class="text-right py-1.5 px-3 font-medium">bytes in</th>
                <th class="text-right py-1.5 px-3 font-medium">bytes out</th>
                <th class="text-right py-1.5 px-3 font-medium">min-entropy in</th>
                <th class="text-right py-1.5 pl-3 font-medium">min-entropy out</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(step, i) in accounted.trace"
                :key="i"
                class="border-t border-default font-mono text-xs tabular-nums"
              >
                <td class="py-1.5 pr-3 text-primary">{{ step.op }}</td>
                <td class="py-1.5 px-3 text-right">{{ step.inBytes }}</td>
                <td class="py-1.5 px-3 text-right">{{ step.outBytes }}</td>
                <td class="py-1.5 px-3 text-right">{{ fmtNum(step.inMinEntropy, { digits: 2 }) }}</td>
                <td class="py-1.5 pl-3 text-right">{{ fmtNum(step.outMinEntropy, { digits: 2 }) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Final min-entropy"
            :value="accounted.claim.minEntropy"
            :digits="2"
            :note="`over ${accounted.bytes.length} bytes — the invariant is 0 ≤ claim ≤ ${accounted.bytes.length * 8}`"
          />
          <StatTile
            label="Bits per output byte"
            :value="accounted.claim.minEntropy / Math.max(1, accounted.bytes.length)"
            :digits="3"
            note="what you may actually spend"
          />
          <StatTile
            label="ε (distance from uniform)"
            :value="accounted.claim.epsilon"
            :digits="12"
            note="union bound over extraction steps"
          />
          <StatTile label="Basis" :value="accounted.claim.basis" :mono="false" note="declared → derived" />
        </div>

        <div class="rounded-md border border-default bg-elevated/40 px-3 py-2">
          <div class="text-[11px] uppercase tracking-wide text-muted">Assumptions carried</div>
          <ul class="mt-1 list-disc pl-4 text-xs text-muted">
            <li v-for="assumption in accounted.claim.assumptions" :key="assumption">
              {{ assumption }}
            </li>
          </ul>
        </div>

        <CodeSnippet :code="snippet" title="the pipeline" />
      </div>

      <template #footer>
        <HonestNote variant="fixed-in-0.2">
          <code>debiasAccounted</code> now caps the credit at the input claim unless you pass
          <code>{{ "{ basis: 'iid' }" }}</code>: a measured claim on possibly correlated bits must
          not be inflated by the debiaser's iid assumption. Switch the basis above and watch the
          final claim move.
        </HonestNote>
      </template>
    </DemoSection>

    <DemoSection
      id="output-entropy"
      title="Output_Entropy — where a conditioning credit comes from"
      description="SP 800-90B §3.1.5.1.2, evaluated entirely in the log₂ domain so input widths of millions of bits work. vettedOutputEntropy caps it at 0.999·n_out — house policy borrowed from the non-vetted §3.1.5.2 rule."
      :api="['outputEntropy', 'vettedOutputEntropy', 'conditionStream']"
    >
      <template #controls>
        <UFormField label="n_in (bits)" size="sm" class="w-32">
          <UInputNumber v-model="nIn" :min="1" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="n_out (bits)" size="sm" class="w-32">
          <UInputNumber v-model="nOut" :min="1" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="nw (narrowest width)" size="sm" class="w-44">
          <UInputNumber v-model="nw" :min="1" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="h_in (bits)" size="sm" class="w-32">
          <UInputNumber v-model="hIn" :min="0" size="sm" class="w-full" />
        </UFormField>
      </template>

      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="preset in PRESETS"
            :key="preset.label"
            size="xs"
            color="neutral"
            variant="subtle"
            @click="applyPreset(preset)"
          >
            {{ preset.label }} → {{ preset.expect }}
          </UButton>
        </div>

        <UAlert
          v-if="entropyCredit.error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Invalid arguments"
          :description="entropyCredit.error"
        />

        <div v-else class="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="outputEntropy(n_in, n_out, nw, h_in)"
            :value="entropyCredit.raw"
            :digits="4"
            note="h_out = −log₂ max(ψ, ω)"
          />
          <StatTile
            label="vettedOutputEntropy"
            :value="entropyCredit.vetted"
            :digits="4"
            :tone="entropyCredit.vetted < entropyCredit.raw ? 'warning' : 'neutral'"
            :note="`capped at 0.999·n_out = ${fmtNum(entropyCredit.cap, { digits: 3 })}`"
          />
          <StatTile
            label="Credit lost to the cap"
            :value="entropyCredit.raw - entropyCredit.vetted"
            :digits="4"
            note="0 when the collision terms already bite harder than the cap"
          />
        </div>

        <p class="text-xs text-muted">
          With <code class="text-primary">n_in</code> omitted the function assumes
          n_in = ⌈h_in⌉ — the most conservative width, since Output_Entropy grows with n_in.
          <code class="text-primary">conditionStream</code> credits each 32-byte block
          <code>vettedOutputEntropy(h·n, 256, 8·n)</code>, which is never a full 256 bits: 255.744
          at safetyFactor 2 with h = 8, 251.69 at safetyFactor 1 with h = 8 (the ω multicollision
          term), 255.0 at safetyFactor 1 with h = 4 (the ψ term).
        </p>
      </div>

      <template #footer>
        Before 0.2.0 the vetted credit was min(h_in, 0.999·n_out), which ignores the collision term
        and overcredits by up to ~0.77 bits near h_in ≈ n_out — 255.744 instead of 255.0 for 512
        input bits carrying 256.
      </template>
    </DemoSection>
  </div>
</template>
