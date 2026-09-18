<script setup lang="ts">
/**
 * Section 1, exact half — the prover's cost and the proof's size are closed
 * forms the package computes, so they can be drawn before anything is measured
 * and checked against the measurement afterwards.
 */
import { pietrzakProveCost, pietrzakRounds } from '@mindpeeker/vdf'
import { fmtBytes, fmtNum } from '~/lib/format'
import type { PipelineResult } from '~/lib/vdf/jobs'
import { MODULUS_META, superscript, T_EXPONENTS } from '~/lib/vdf/jobs'

const props = defineProps<{ exponent: number; result?: PipelineResult }>()

const width = computed(() => MODULUS_META[props.result?.modulusId ?? 'rsa2048'].width)

/** ⌈T/⌈√T⌉⌉ — the checkpoint spacing `sealBeacon` and this page both default to. */
function defaultInterval(T: number): number {
  return Math.ceil(T / Math.ceil(Math.sqrt(T)))
}

const curve = computed(() => {
  const xs: number[] = []
  const naive: number[] = []
  const plain: number[] = []
  const checkpointed: number[] = []
  for (const e of T_EXPONENTS) {
    const T = 2 ** e
    xs.push(e)
    naive.push(T)
    plain.push(pietrzakProveCost(T))
    checkpointed.push(pietrzakProveCost(T, defaultInterval(T)))
  }
  return { xs, naive, plain, checkpointed }
})

const savings = computed(() => {
  const T = 2 ** props.exponent
  const withCk = pietrzakProveCost(T, defaultInterval(T))
  return { T, plain: pietrzakProveCost(T), withCk, ratio: withCk / T }
})

const sizes = computed(() => {
  const T = 2 ** props.exponent
  const w = width.value
  const rounds = pietrzakRounds(T)
  return {
    rounds,
    pietrzak: 14 + w * (1 + rounds),
    wesolowski: 14 + 2 * w,
    seal: 46 + w * (1 + rounds),
  }
})
</script>

<template>
  <div class="flex flex-col gap-3 rounded-md border border-default bg-elevated/30 p-3 sm:p-4">
    <h3 class="text-sm font-semibold text-highlighted">Exact costs, before anything is measured</h3>

    <LineChart
      :series="[
        { name: 're-evaluating the chain (T)', y: curve.naive, color: 'muted', dashed: true },
        { name: 'pietrzakProve, no checkpoints', y: curve.plain, color: 1 },
        { name: 'pietrzakProve, √T checkpoints', y: curve.checkpointed, color: 2 },
      ]"
      :x="curve.xs"
      :vlines="[{ value: props.exponent, label: `chosen T = 2${superscript(props.exponent)}`, color: 'primary' }]"
      log-y
      x-label="log₂ T"
      y-label="squarings the prover performs"
      aria-label="prover cost against delay, with and without checkpoints"
      :height="250"
      :format="(v) => fmtNum(v, { digits: 0 })"
    />

    <p class="text-xs text-muted">
      At T = {{ fmtNum(savings.T, { digits: 0 }) }} the prover does
      <strong class="text-highlighted">{{ fmtNum(savings.withCk, { digits: 0 }) }}</strong> squarings
      with ⌈√T⌉ stored powers instead of
      <strong class="text-highlighted">{{ fmtNum(savings.plain, { digits: 0 }) }}</strong> without —
      {{ fmtNum(savings.ratio * 100, { digits: 1 }) }}% of the delay, for ⌈√T⌉ group elements of
      memory and not one extra squaring during evaluation. The proof bytes are identical either way.
    </p>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="sr-only">
          Exact wire sizes against the measured proof bytes
        </caption>
        <thead class="text-xs uppercase tracking-wide text-muted">
          <tr class="border-b border-default">
            <th scope="col" class="py-1.5 text-left font-medium">Encoding</th>
            <th scope="col" class="py-1.5 text-left font-medium">Exact size</th>
            <th scope="col" class="py-1.5 text-right font-medium">Bytes</th>
            <th scope="col" class="py-1.5 text-right font-medium">Measured</th>
          </tr>
        </thead>
        <tbody class="tabular-nums">
          <tr class="border-b border-default/60">
            <td class="py-1.5 font-mono text-xs text-highlighted">proofToBytes</td>
            <td class="py-1.5 font-mono text-xs text-muted">14 + w(1 + ⌈log₂T⌉) = 14 + {{ width }}·{{ 1 + sizes.rounds }}</td>
            <td class="py-1.5 text-right font-mono">{{ fmtNum(sizes.pietrzak, { digits: 0 }) }}</td>
            <td class="py-1.5 text-right font-mono" :class="result && result.pietrzak.bytes !== sizes.pietrzak ? 'text-warning' : 'text-success'">
              {{ result ? fmtNum(result.pietrzak.bytes, { digits: 0 }) : '—' }}
            </td>
          </tr>
          <tr class="border-b border-default/60">
            <td class="py-1.5 font-mono text-xs text-highlighted">wesolowskiToBytes</td>
            <td class="py-1.5 font-mono text-xs text-muted">14 + 2w — constant in T</td>
            <td class="py-1.5 text-right font-mono">{{ fmtNum(sizes.wesolowski, { digits: 0 }) }}</td>
            <td class="py-1.5 text-right font-mono" :class="result && result.wesolowski.bytes !== sizes.wesolowski ? 'text-warning' : 'text-success'">
              {{ result ? fmtNum(result.wesolowski.bytes, { digits: 0 }) : '—' }}
            </td>
          </tr>
          <tr>
            <td class="py-1.5 font-mono text-xs text-highlighted">sealToBytes</td>
            <td class="py-1.5 font-mono text-xs text-muted">46 + w(1 + ⌈log₂T⌉) — 32 of them the pulse digest</td>
            <td class="py-1.5 text-right font-mono">{{ fmtNum(sizes.seal, { digits: 0 }) }}</td>
            <td class="py-1.5 text-right font-mono text-dimmed">see the seal section</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-dimmed">
      w = {{ width }} bytes, the modulus width. A Pietrzak proof grows by one group element every
      time T doubles ({{ fmtBytes(sizes.pietrzak) }} here); a Wesolowski proof is
      {{ fmtBytes(sizes.wesolowski) }} for every T up to 2³² − 1.
    </p>
  </div>
</template>
