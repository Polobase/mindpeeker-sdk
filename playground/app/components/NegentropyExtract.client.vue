<script setup lang="ts">
/**
 * §6a — debiasing: von Neumann, Peres, and the streaming form, over bits
 * deliberately biased away from fair.
 */
import {
  type DebiasMethod,
  debiasStream,
  monobit,
  normalP,
  peres,
  peresRate,
  toBits,
  vonNeumann,
} from '@mindpeeker/negentropy'
import { nextMacrotask, throwIfAborted } from '~/lib/async'
import { getBytes, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum, toHex } from '~/lib/format'
import { binaryEntropy, mixBits, packBits } from '~/lib/negentropy/synth'

const SIZES = [
  { label: '2 KiB', value: 2048 },
  { label: '8 KiB', value: 8192 },
  { label: '32 KiB', value: 32768 },
]
const METHODS: { label: string; value: DebiasMethod }[] = [
  { label: "'peres' (Zhou–Bruck random stream)", value: 'peres' },
  { label: "'von-neumann' (pairs)", value: 'von-neumann' },
]
const PERES_DEPTH = 16
const SEED = 0x7f4a7c15

const size = ref(8192)
const bias = ref(0.15)
const method = ref<DebiasMethod>('peres')
const maxDepth = ref(16)

const p1 = computed(() => 0.5 + bias.value)

interface Batch {
  inputBits: number
  vonNeumannBits: number
  peresBits: number
  vonNeumannRate: number
  peresObserved: number
  peresTheory: number
  vonNeumannTheory: number
  shannonBound: number
  inputMonobit: { z: number; p: number; onesFraction: number }
  outputMonobit: { z: number; p: number; onesFraction: number }
  hex: string
}

interface Stream {
  method: DebiasMethod
  inputBytes: number
  outputBytes: number
  rate: number
  matchesBatch: boolean | null
  hex: string
}

const batchTask = useTask<Batch>()
const batch = computed(() => batchTask.result.value)
const streamTask = useTask<Stream>()
const streamed = computed(() => streamTask.result.value)

function runBatch(): void {
  void batchTask.run(async (signal, setProgress) => {
    setProgress(0.1)
    const raw = await getBytes(size.value, { signal })
    const bits = mixBits(toBits(raw), { bias: bias.value, stickiness: 0, seed: SEED })
    setProgress(0.4)
    const vn = vonNeumann(bits)
    setProgress(0.7)
    const pz = peres(bits)
    const outputBits = Uint8Array.from(pz)
    const inputMono = monobit(bits)
    const outputMono = monobit(outputBits)
    const p = p1.value
    setProgress(1)
    return {
      inputBits: bits.length,
      vonNeumannBits: vn.length,
      peresBits: pz.length,
      vonNeumannRate: vn.length / bits.length,
      peresObserved: pz.length / bits.length,
      peresTheory: peresRate(p, PERES_DEPTH),
      vonNeumannTheory: p * (1 - p),
      shannonBound: binaryEntropy(p),
      inputMonobit: {
        z: inputMono.z,
        p: normalP(inputMono.z, 'two'),
        onesFraction: inputMono.onesFraction,
      },
      outputMonobit: {
        z: outputMono.z,
        p: normalP(outputMono.z, 'two'),
        onesFraction: outputMono.onesFraction,
      },
      hex: toHex(packBits(pz), { max: 16 }),
    }
  })
}

function runStream(): void {
  void streamTask.run(async (signal, setProgress) => {
    const bytes = size.value
    const chunkBytes = 512
    setProgress(0.05)
    const raw = await getBytes(bytes, { signal })
    const biased = packBits(mixBits(toBits(raw), { bias: bias.value, stickiness: 0, seed: SEED }))

    async function* chunks(): AsyncGenerator<Uint8Array> {
      for (let offset = 0; offset < biased.length; offset += chunkBytes) {
        throwIfAborted(signal)
        await nextMacrotask()
        yield biased.subarray(offset, Math.min(offset + chunkBytes, biased.length))
      }
    }

    const out: number[] = []
    for await (const chunk of debiasStream(chunks(), method.value, {
      signal,
      maxDepth: maxDepth.value,
    })) {
      for (const byte of chunk) out.push(byte)
      setProgress(Math.min(0.99, out.length / (biased.length * 0.4)))
    }
    const output = Uint8Array.from(out)

    // Documented invariant: the streaming von Neumann equals the batch
    // vonNeumann over the whole input; the streaming Peres does not (its
    // output order is Zhou & Bruck's, and a pending bit is never released).
    const reference = packBits(
      method.value === 'von-neumann'
        ? vonNeumann(toBits(biased))
        : peres(toBits(biased)),
    )
    const matchesBatch =
      reference.length === output.length && reference.every((byte, i) => byte === output[i])
    setProgress(1)
    return {
      method: method.value,
      inputBytes: biased.length,
      outputBytes: output.length,
      rate: (output.length * 8) / (biased.length * 8),
      matchesBatch,
      hex: toHex(output, { max: 16 }),
    }
  })
}

const rateChart = computed(() => {
  const b = batch.value
  if (!b) return { categories: [] as string[], values: [] as number[] }
  return {
    categories: ['von Neumann', 'Peres (batch)', `peresRate(p, ${PERES_DEPTH})`, 'H(p) bound'],
    values: [b.vonNeumannRate, b.peresObserved, b.peresTheory, b.shannonBound],
  }
})

const snippet = computed(
  () => `import { peres, peresRate, vonNeumann, debiasStream, toBits } from '@mindpeeker/negentropy'

const bits = toBits(biasedBytes)            // P(1) = ${p1.value.toFixed(3)}
const vn = vonNeumann(bits)                 // 01→0, 10→1; rate → p·q = ${(p1.value * (1 - p1.value)).toFixed(4)}
const pz = peres(bits)                      // recycles what von Neumann discards
peresRate(${p1.value.toFixed(3)}, ${PERES_DEPTH})                    // exact expected rate at depth ${PERES_DEPTH}

// streaming form, state carried across chunks, abort-raced:
for await (const chunk of debiasStream(source.stream(), '${method.value}', { signal, maxDepth: ${maxDepth.value} })) {
  sink(chunk)
}`,
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      id="debias"
      title="Debiasing: paying for uniformity in yield"
      description="A deliberately biased bit stream in, exactly unbiased bits out — under the debiaser's one assumption, that the input bits are independent. Von Neumann's yield ceiling is p·q; Peres recycles what von Neumann throws away and approaches the Shannon bound H(p)."
      :api="['vonNeumann', 'peres', 'peresRate', 'monobit', 'toBits']"
    >
      <template #controls>
        <UFormField label="Input" size="sm" class="w-32">
          <USelect v-model="size" :items="SIZES" size="sm" class="w-full" />
        </UFormField>
        <UFormField :label="`Bias: P(1) = ${p1.toFixed(3)}`" size="sm" class="w-56">
          <USlider v-model="bias" :min="0.01" :max="0.35" :step="0.01" aria-label="Input bias" />
        </UFormField>
        <RunControls
          :busy="batchTask.busy.value"
          :progress="batchTask.progress.value"
          label="Debias"
          icon="i-lucide-filter"
          :hint="`${fmtBytes(size)} from the selected source, biased to P(1) = ${p1.toFixed(3)} before debiasing`"
          @run="runBatch"
          @cancel="batchTask.cancel()"
        />
      </template>

      <ErrorAlert :err="batchTask.error.value" @dismiss="batchTask.reset()" />

      <div v-if="batch" class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Input bits"
            :value="batch.inputBits"
            :digits="0"
            :note="`ones ${fmtNum(batch.inputMonobit.onesFraction * 100, { digits: 2 })}% · monobit z = ${fmtNum(batch.inputMonobit.z, { digits: 1 })}`"
          />
          <StatTile
            label="von Neumann out"
            :value="batch.vonNeumannBits"
            :digits="0"
            :note="`rate ${fmtNum(batch.vonNeumannRate, { digits: 4 })} vs p·q = ${fmtNum(batch.vonNeumannTheory, { digits: 4 })}`"
          />
          <StatTile
            label="Peres out"
            :value="batch.peresBits"
            :digits="0"
            :note="`rate ${fmtNum(batch.peresObserved, { digits: 4 })} vs peresRate = ${fmtNum(batch.peresTheory, { digits: 4 })}`"
          />
          <StatTile label="Output monobit" :value="batch.outputMonobit.z" :digits="3">
            <template #note>
              <div class="flex flex-col gap-1">
                <PValue :p="batch.outputMonobit.p" kind="pointwise" :show-kind="false" />
                <span>ones {{ fmtNum(batch.outputMonobit.onesFraction * 100, { digits: 2 }) }}% — the bias is gone</span>
              </div>
            </template>
          </StatTile>
        </div>

        <BarChart
          :categories="rateChart.categories"
          :values="rateChart.values"
          :expected="batch.shannonBound"
          expected-label="H(p) — the information-theoretic ceiling"
          y-label="bits out per bit in"
          :height="240"
          aria-label="Extraction rates of von Neumann and Peres against their exact references"
        />
        <p class="text-xs text-muted">
          First output bytes: <code class="font-mono text-primary">{{ batch.hex }}</code> ·
          drawn from {{ sourceSummary().providerName }}
        </p>

        <CodeSnippet :code="snippet" title="what these buttons ran" />
      </div>

      <template #footer>
        <HonestNote variant="caveat">
          Both debiasers are exact only for <em>independent</em> input bits. Correlated input — a
          sticky sensor, a resonating oscillator — comes out biased anyway, which is why the
          accounting below refuses to raise a claim on the strength of the iid assumption unless you
          ask for it explicitly.
        </HonestNote>
      </template>
    </DemoSection>

    <DemoSection
      id="debias-stream"
      title="The streaming debiaser"
      description="debiasStream carries its state across chunks, races every pull against the abort signal and closes the upstream on exit. 'von-neumann' reproduces the batch function exactly; 'peres' is Zhou & Bruck's random-stream algorithm, whose output stopped at any length is unbiased and independent — in a different order from the batch."
      :api="['debiasStream', 'createDebiaser']"
    >
      <template #controls>
        <UFormField label="Method" size="sm" class="w-64">
          <USelect v-model="method" :items="METHODS" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="maxDepth (peres)" size="sm" class="w-36">
          <UInputNumber v-model="maxDepth" :min="1" :max="32" size="sm" class="w-full" />
        </UFormField>
        <RunControls
          :busy="streamTask.busy.value"
          :progress="streamTask.progress.value"
          label="Stream & debias"
          icon="i-lucide-waves"
          :hint="`${fmtBytes(size)} pushed through in 512-byte chunks`"
          @run="runStream"
          @cancel="streamTask.cancel()"
        />
      </template>

      <ErrorAlert :err="streamTask.error.value" @dismiss="streamTask.reset()" />

      <div v-if="streamed" class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Input" :value="fmtBytes(streamed.inputBytes)" :mono="false" note="biased bytes in" />
          <StatTile label="Output" :value="fmtBytes(streamed.outputBytes)" :mono="false" note="debiased bytes out" />
          <StatTile
            label="Rate"
            :value="streamed.rate"
            :digits="4"
            note="bits out per bit in, whole bytes only"
          />
          <StatTile
            label="Same as the batch call"
            :value="streamed.matchesBatch ? 'identical' : 'different order'"
            :tone="streamed.method === 'von-neumann' ? (streamed.matchesBatch ? 'success' : 'error') : 'neutral'"
            :note="streamed.method === 'von-neumann'
              ? 'the streaming von Neumann must equal the batch output'
              : 'expected: the random-stream algorithm emits in its own order'"
          />
        </div>
        <p class="text-xs text-muted">
          First output bytes: <code class="font-mono text-primary">{{ streamed.hex }}</code>
        </p>
      </div>

      <template #footer>
        An output bit still pending in a status-tree node when the input ends is never released —
        the price of the stream property. Emitting Peres's pair outputs immediately in batch order
        would be biased, which the package's tests show exhaustively.
      </template>
    </DemoSection>
  </div>
</template>
