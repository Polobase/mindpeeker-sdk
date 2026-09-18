<script setup lang="ts">
import { digitToDegrees, rateMask, xorImprint } from '@mindpeeker/rate'
import { createYielder } from '~/lib/async'
import { getBytes, sourceSummary } from '~/lib/entropy'
import { fmtBytes, fmtNum, toHex } from '~/lib/format'
import { plugInEntropyBias, plugInEntropyBits } from '~/lib/rate/exact'
import {
  byteHistogram,
  collectBytes,
  countDifferences,
  ringPermutationMismatches,
} from '~/lib/rate/sampling'
import { parsedRate } from '~/lib/rate/state'

/** rateMask + xorImprint: reversible, entropy-preserving, and not cryptography. */

interface MaskRow {
  ring: number
  digit: number
  degrees: number
  mask: number
  exact: number
  matches: boolean
}

interface ImprintResult {
  length: number
  source: string
  maskRows: MaskRow[]
  maskHex: string
  periodMismatches: number
  changed: number
  changedExpected: number
  roundTripDiff: number
  ringMismatches: number
  histOriginal: Uint32Array
  histImprinted: Uint32Array
  histMax: number
  entropyOriginal: number
  entropyImprinted: number
  entropyBias: number
  hexOriginal: string
  hexImprinted: string
  hexRoundTrip: string
}

const sizeChoice = ref('1024')
const sizeItems = [
  { label: '256 bytes', value: '256' },
  { label: '1 KiB', value: '1024' },
  { label: '4 KiB', value: '4096' },
  { label: '16 KiB', value: '16384' },
]

const task = useTask<ImprintResult>()
const result = computed(() => task.result.value)
const hint = computed(() => `${fmtBytes(Number(sizeChoice.value))} from ${sourceSummary().label}`)

function start(): void {
  const rate = parsedRate.value
  if (!rate) return
  void task.run(async (signal, setProgress) => {
    const length = Number(sizeChoice.value)
    const rings = rate.digits.length
    const tick = createYielder(8, signal)
    setProgress(0)

    const bytes = await getBytes(length, { signal })
    setProgress(0.2)

    // One period of the mask, plus the long form: mask[i] must equal mask[i % r].
    const period = rateMask(rate, rings)
    const long = rateMask(rate, length)
    let periodMismatches = 0
    for (let i = 0; i < length; i++) {
      if ((long[i] as number) !== (period[i % rings] as number)) periodMismatches++
      if ((i & 4095) === 0) await tick()
    }

    const imprinted = await collectBytes(xorImprint(bytes, rate, { signal }), length, signal)
    const roundTrip = await collectBytes(xorImprint(imprinted, rate, { signal }), length, signal)
    setProgress(0.55)

    // A byte only changes where its ring's mask byte is non-zero — exactly.
    let changedExpected = 0
    for (let k = 0; k < rings; k++) {
      if ((period[k] as number) !== 0) changedExpected += Math.ceil((length - k) / rings)
    }

    const histOriginal = byteHistogram(bytes)
    const histImprinted = byteHistogram(imprinted)
    let histMax = 0
    for (let v = 0; v < 256; v++) {
      histMax = Math.max(histMax, histOriginal[v] as number, histImprinted[v] as number)
    }
    await tick()
    setProgress(0.85)

    const maskRows: MaskRow[] = rate.digits.map((digit, k) => {
      const exact = Math.round((digit * 256) / rate.base) % 256
      return {
        ring: k + 1,
        digit,
        degrees: digitToDegrees(digit, rate.base),
        mask: period[k] as number,
        exact,
        matches: (period[k] as number) === exact,
      }
    })

    setProgress(1)
    return {
      length,
      source: sourceSummary().providerName,
      maskRows,
      maskHex: toHex(period, { sep: ' ' }),
      periodMismatches,
      changed: countDifferences(bytes, imprinted),
      changedExpected,
      roundTripDiff: countDifferences(bytes, roundTrip),
      ringMismatches: ringPermutationMismatches(bytes, imprinted, period),
      histOriginal,
      histImprinted,
      histMax,
      entropyOriginal: plugInEntropyBits(histOriginal),
      entropyImprinted: plugInEntropyBits(histImprinted),
      entropyBias: plugInEntropyBias(256, length),
      hexOriginal: toHex(bytes, { max: 16, sep: ' ' }),
      hexImprinted: toHex(imprinted, { max: 16, sep: ' ' }),
      hexRoundTrip: toHex(roundTrip, { max: 16, sep: ' ' }),
    }
  })
}

onMounted(() => {
  if (!sourceSummary().network && parsedRate.value) start()
})

// The mask belongs to the rate that produced it: a new rate invalidates the run.
watch(parsedRate, () => task.reset())

const snippet = computed(() => {
  const r = result.value
  return `import { rateMask, xorImprint } from '@mindpeeker/rate'

const mask = rateMask(rate, rate.digits.length)   // ${r?.maskHex ?? '…'} — period = ring count
let out = new Uint8Array(0)
for await (const chunk of xorImprint(bytes, rate, { signal })) out = chunk
// The same generator accepts a live ByteSource instead of a buffer:
//   for await (const chunk of xorImprint(provider, rate, { signal })) { … }

// Imprinting twice with the same rate is the identity — XOR by a fixed byte
// is a bijection on 0..255, so nothing is added and nothing is lost.`
})
</script>

<template>
  <DemoSection
    id="modulation"
    title="Modulation — mask and imprint"
    description="The rate's angles become a byte keystream, and XOR-ing a stream with it is Rae's 'imprint' reproduced as ordinary arithmetic: deterministic, reversible, and carrying no claim whatsoever."
    :api="['rateMask', 'xorImprint']"
  >
    <template #controls>
      <UFormField label="Bytes to imprint" class="w-40">
        <USelect v-model="sizeChoice" :items="sizeItems" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!parsedRate"
        label="Draw bytes and imprint"
        :hint="hint"
        @run="start"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <p v-if="!parsedRate" class="text-sm text-muted">Fix the rate above to run this section.</p>

      <template v-else-if="result">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[30rem] text-sm">
            <caption class="sr-only">
              The mask byte each ring contributes
            </caption>
            <thead>
              <tr class="text-xs uppercase text-dimmed">
                <th scope="col" class="py-1.5 pr-3 text-left font-medium">Ring</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Digit</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">Angle</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">rateMask byte</th>
                <th scope="col" class="px-3 py-1.5 text-right font-medium">round(256·d/b) mod 256</th>
                <th scope="col" class="py-1.5 pl-3 text-right font-medium">agrees</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in result.maskRows" :key="row.ring" class="border-t border-default">
                <td class="py-1.5 pr-3 text-muted">#{{ row.ring }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-highlighted">{{ row.digit }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-muted">
                  {{ fmtNum(row.degrees, { digits: 2 }) }}°
                </td>
                <td class="px-3 py-1.5 text-right font-mono">
                  {{ row.mask }}
                  <span class="text-dimmed">({{ row.mask.toString(16).padStart(2, '0') }})</span>
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-muted">{{ row.exact }}</td>
                <td class="py-1.5 pl-3 text-right">
                  <UIcon
                    :name="row.matches ? 'i-lucide-check' : 'i-lucide-x'"
                    :class="row.matches ? 'text-success' : 'text-error'"
                    class="size-4"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="mask period" :value="result.maskRows.length" :digits="0" note="= ring count, by construction" />
          <StatTile
            label="periodicity violations"
            :value="result.periodMismatches"
            :digits="0"
            :tone="result.periodMismatches === 0 ? 'success' : 'error'"
            :note="`mask[i] = mask[i mod r] over all ${fmtNum(result.length)} bytes`"
          />
          <StatTile
            label="bytes changed"
            :value="result.changed"
            :digits="0"
            :tone="result.changed === result.changedExpected ? 'success' : 'warning'"
            :note="`predicted exactly ${fmtNum(result.changedExpected)} — rings whose mask byte is 0 pass through`"
          />
          <StatTile
            label="round-trip differences"
            :value="result.roundTripDiff"
            :digits="0"
            :tone="result.roundTripDiff === 0 ? 'success' : 'error'"
            note="imprint twice with the same rate = identity"
          />
        </div>

        <div class="rounded-md border border-default bg-elevated/40 p-3 font-mono text-xs">
          <p class="text-dimmed">mask period · {{ result.maskHex }}</p>
          <p class="mt-1.5 text-muted">source&nbsp;&nbsp;&nbsp;&nbsp;{{ result.hexOriginal }}</p>
          <p class="mt-0.5 text-primary">imprint&nbsp;&nbsp;&nbsp;{{ result.hexImprinted }}</p>
          <p class="mt-0.5 text-muted">twice&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{{ result.hexRoundTrip }}</p>
          <p class="mt-1.5 font-sans text-[11px] text-dimmed">first 16 bytes of each</p>
        </div>

        <div>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge :color="result.ringMismatches === 0 ? 'success' : 'error'" variant="subtle">
              <UIcon
                :name="result.ringMismatches === 0 ? 'i-lucide-check' : 'i-lucide-x'"
                class="size-3"
              />
              per-ring histogram permutation exact ({{ result.ringMismatches }} mismatches)
            </UBadge>
            <AccountingBadge :bytes-consumed="result.length" :source="result.source" />
          </div>
          <p class="mt-2 text-sm text-muted">
            For every ring k, imprinted value <span class="font-mono">v ⊕ mask[k]</span> occurs
            exactly as often as source value <span class="font-mono">v</span>: XOR by a fixed byte
            relabels the alphabet and does nothing else. That is the precise sense in which the
            imprint is entropy-preserving.
          </p>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div>
            <p class="mb-1 text-xs uppercase tracking-wide text-dimmed">Source byte density</p>
            <HeatmapCanvas
              :data="result.histOriginal"
              :rows="16"
              :cols="16"
              :min="0"
              :max="result.histMax"
              row-label="high nibble"
              col-label="low nibble"
              :height="200"
              aria-label="Byte-value density of the source bytes"
            />
          </div>
          <div>
            <p class="mb-1 text-xs uppercase tracking-wide text-dimmed">Imprinted byte density</p>
            <HeatmapCanvas
              :data="result.histImprinted"
              :rows="16"
              :cols="16"
              :min="0"
              :max="result.histMax"
              row-label="high nibble"
              col-label="low nibble"
              :height="200"
              aria-label="Byte-value density after the imprint"
            />
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="entropy, source"
            :value="`${fmtNum(result.entropyOriginal, { digits: 4 })} bits/byte`"
          />
          <StatTile
            label="entropy, imprinted"
            :value="`${fmtNum(result.entropyImprinted, { digits: 4 })} bits/byte`"
          />
          <StatTile
            label="plug-in bias"
            :value="`−${fmtNum(result.entropyBias, { digits: 4 })} bits`"
            tone="warning"
            note="(256−1)/(2N ln2): why a perfect source does not measure 8.000 here"
          />
        </div>
        <p class="text-xs text-muted">
          Both numbers sit the same distance below 8 bits/byte, and both are biased low by the same
          known amount — a plug-in estimate on {{ fmtNum(result.length) }} bytes cannot reach 8. The
          exact statement is the bijection above; the entropy figures are only a sanity check.
        </p>

        <HonestNote variant="caveat" title="Not cryptography">
          <code class="font-mono">rateMask</code> is a fixed, public function of the rate with period
          = digit count, and it carries no entropy of its own. XOR-ing with it provides no
          confidentiality whatsoever: anyone holding the rate — or guessing a few bytes — undoes it.
          Never use it as a key or a pad. The DSP here is invented by this package, labelled
          "modeled" in the README's table, and asserts nothing about imprinting anything.
        </HonestNote>
      </template>

      <p v-else-if="!task.busy.value" class="text-sm text-muted">
        Press Run to draw bytes and imprint them with this rate. Editing the rate clears the run —
        every number here belongs to the mask the rate produced.
      </p>

      <CodeSnippet :code="snippet" title="what this section ran" />
    </div>

    <template #footer>
      <code class="font-mono">xorImprint</code> and <code class="font-mono">phaseModulate</code> both
      accept a buffer, an async chunk stream, or any live <code class="font-mono">ByteSource</code> —
      the entropy providers satisfy that shape structurally, without either package importing the
      other.
    </template>
  </DemoSection>
</template>
