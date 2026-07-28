<script setup lang="ts">
import {
  chiSquareBytes,
  monobit,
  runsTest,
  serialCorrelation,
  shannonEntropy,
  spectralTest,
} from '@mindpeeker/negentropy'
import { localBytes } from '~/lib/entropy'

const N = 4096
const W = 1024
const H = 200
const INK = { bg: '#070b11', bar: '#47e0c8', expected: '#8b97a7' }

const fmt = (n: number, digits = 3) =>
  Number.isFinite(n) ? (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(digits)) : '—'

const canvasEl = ref<HTMLCanvasElement>()
const busy = ref(false)
const rows = ref<{ name: string; value: string; note: string }[]>([])

/** MSB-first bit expansion — the bit-level tests take one bit per element. */
function bytesToBits(bytes: Uint8Array): Uint8Array {
  const bits = new Uint8Array(bytes.length * 8)
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number
    for (let k = 0; k < 8; k++) bits[i * 8 + k] = (b >> (7 - k)) & 1
  }
  return bits
}

function drawHistogram(bytes: Uint8Array): void {
  const ctx = canvasEl.value?.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = INK.bg
  ctx.fillRect(0, 0, W, H)
  const hist = new Float64Array(256)
  for (const b of bytes) hist[b] = (hist[b] as number) + 1
  const max = Math.max(1, ...hist)
  const bw = W / 256
  ctx.fillStyle = INK.bar
  for (let i = 0; i < 256; i++) {
    const h = ((hist[i] as number) / max) * (H - 4)
    ctx.fillRect(i * bw, H - h, Math.max(1, bw - 0.5), h)
  }
  const expected = bytes.length / 256
  const y = H - (expected / max) * (H - 4)
  ctx.strokeStyle = INK.expected
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(W, y)
  ctx.stroke()
  ctx.setLineDash([])
}

async function run(): Promise<void> {
  busy.value = true
  try {
    const bytes = await localBytes(N)
    const bits = bytesToBits(bytes)
    const chi = chiSquareBytes(bytes)
    const mb = monobit(bits)
    const spec = spectralTest(bits)
    rows.value = [
      {
        name: 'Shannon entropy',
        value: fmt(shannonEntropy(bytes), 4),
        note: 'bits/byte — ideal 8.0',
      },
      {
        name: 'χ² uniformity (255 df)',
        value: fmt(chi.statistic, 1),
        note: `p = ${fmt(chi.pValue)}`,
      },
      {
        name: 'Monobit',
        value: `z = ${fmt(mb.z, 2)}`,
        note: `ones ${fmt(mb.onesFraction * 100, 2)}%`,
      },
      { name: 'Runs test', value: `z = ${fmt(runsTest(bits), 2)}`, note: 'alternation of bits' },
      {
        name: 'Serial correlation',
        value: fmt(serialCorrelation(bytes), 4),
        note: 'lag-1 — ideal 0',
      },
      { name: 'Spectral (DFT)', value: `p = ${fmt(spec.pValue)}`, note: 'hidden periodicity' },
    ]
    drawHistogram(bytes)
  } finally {
    busy.value = false
  }
}

onMounted(run)
</script>

<template>
  <div>
    <UCard>
      <div class="flex flex-wrap items-center gap-4">
        <UButton :loading="busy" icon="i-lucide-dices" @click="run">
          Draw a fresh 4 KB sample
        </UButton>
        <UBadge color="neutral" variant="subtle" class="ml-auto font-mono">
          {{ N }} bytes from crypto.getRandomValues
        </UBadge>
      </div>
    </UCard>

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <UCard>
        <h3 class="font-semibold mb-2">Test battery</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Test</th>
                <th class="text-right py-1.5 px-3 font-medium">Statistic</th>
                <th class="text-left py-1.5 pl-3 font-medium">Reading</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.name" class="border-t border-default">
                <td class="py-1.5 pr-3">{{ r.name }}</td>
                <td class="py-1.5 px-3 text-right font-mono">{{ r.value }}</td>
                <td class="py-1.5 pl-3 text-muted">{{ r.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <UCard>
        <h3 class="font-semibold mb-2">Byte histogram (0–255)</h3>
        <canvas
          ref="canvasEl"
          :width="W"
          :height="H"
          class="w-full h-[200px] block rounded border border-default bg-black"
        />
        <p class="mt-2 text-xs text-muted">
          dashed line = the {{ (N / 256).toFixed(0) }} counts per value expected under uniformity
        </p>
      </UCard>
    </div>
  </div>
</template>
