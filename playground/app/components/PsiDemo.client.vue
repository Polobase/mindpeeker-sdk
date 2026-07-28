<script setup lang="ts">
import { binomialBayesFactor } from '@mindpeeker/psi'
import { localBytes } from '~/lib/entropy'

const BITS = 200
const W = 900
const H = 240

const intentionItems = [
  { label: 'Aim high (more 1s)', value: 'high' },
  { label: 'Aim low (more 0s)', value: 'low' },
  { label: 'Idle / baseline', value: 'baseline' },
]

const intention = ref('high')
const running = ref(false)
const canvasEl = ref<HTMLCanvasElement>()

const trials = ref(0)
const z = ref<number>()
const bf = ref<number>()

// Plain (non-reactive) accumulators — only the readouts need to re-render.
let hits = 0
let bits = 0
const zs: number[] = []

const fmt = (n: number | undefined, digits: number) => (n === undefined ? '—' : n.toFixed(digits))

function popcount(b: number): number {
  let c = 0
  for (let i = 0; i < 8; i++) c += (b >> i) & 1
  return c
}

function draw(): void {
  const ctx = canvasEl.value?.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#070b11'
  ctx.fillRect(0, 0, W, H)
  const mid = H / 2
  const yOf = (v: number) => mid - (v / 4) * (H / 2 - 10)
  // ±2 chance band + zero line
  ctx.fillStyle = 'rgba(122,162,255,0.10)'
  ctx.fillRect(0, yOf(2), W, yOf(-2) - yOf(2))
  ctx.strokeStyle = '#2b3a4d'
  ctx.beginPath()
  ctx.moveTo(0, mid)
  ctx.lineTo(W, mid)
  ctx.stroke()
  if (zs.length < 2) return
  ctx.strokeStyle = '#47e0c8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i < zs.length; i++) {
    const x = (i / (zs.length - 1)) * W
    const y = Math.max(2, Math.min(H - 2, yOf(zs[i] as number)))
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

async function runBatch(count: number): Promise<void> {
  running.value = true
  try {
    const aim = intention.value
    for (let t = 0; t < count; t++) {
      const bytes = await localBytes(BITS / 8)
      let ones = 0
      for (const b of bytes) ones += popcount(b)
      hits += aim === 'low' ? BITS - ones : ones
      bits += BITS
      zs.push((hits - bits / 2) / Math.sqrt(bits / 4))
    }
    trials.value = zs.length
    z.value = zs[zs.length - 1]
    bf.value = binomialBayesFactor(hits, bits)
    draw()
  } finally {
    running.value = false
  }
}

function reset(): void {
  hits = 0
  bits = 0
  zs.length = 0
  trials.value = 0
  z.value = undefined
  bf.value = undefined
  draw()
}

onMounted(draw)
</script>

<template>
  <div>
    <UCard>
      <div class="flex flex-wrap gap-4 items-end">
        <div>
          <label class="text-xs text-muted uppercase tracking-wide">Intention</label>
          <USelect v-model="intention" :items="intentionItems" class="w-56 mt-1" />
        </div>
        <UButton :loading="running" @click="runBatch(100)">Run 100 trials</UButton>
        <UButton variant="soft" color="neutral" :disabled="running" @click="reset">Reset</UButton>
        <UBadge color="neutral" variant="subtle">{{ BITS }} bits per trial · local CSPRNG</UBadge>
      </div>
    </UCard>

    <div class="grid sm:grid-cols-3 gap-4 mt-4">
      <UCard>
        <div class="text-xs text-muted uppercase tracking-wide">trials</div>
        <div class="mt-1 font-mono text-3xl">{{ trials }}</div>
      </UCard>
      <UCard>
        <div class="text-xs text-muted uppercase tracking-wide">cumulative Stouffer Z</div>
        <div class="mt-1 font-mono text-3xl">{{ fmt(z, 2) }}</div>
      </UCard>
      <UCard>
        <div class="text-xs text-muted uppercase tracking-wide">Bayes factor (BF₁₀)</div>
        <div class="mt-1 font-mono text-3xl">{{ fmt(bf, 3) }}</div>
      </UCard>
    </div>

    <UCard class="mt-4">
      <h3 class="font-semibold mb-2">Cumulative Z vs the ±2 chance band</h3>
      <canvas
        ref="canvasEl"
        :width="W"
        :height="H"
        class="w-full rounded border border-default bg-black"
      />
      <p class="text-xs text-muted mt-2">
        With a fair CSPRNG there is no effect: Z wanders inside the ±2 band and the Bayes factor
        hugs 1. That “nothing” is exactly the point.
      </p>
    </UCard>
  </div>
</template>
