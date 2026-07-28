<script setup lang="ts">
import { attractors, type FieldResult, type Point, sampleField } from '@mindpeeker/field'
import { getBytes } from '~/lib/entropy'

const SIZE = 600
const COUNT = 360
const REGION = { kind: 'rect', width: 1, height: 1 } as const
// Canvas palette — the same ink the Vite site uses, so screenshots match.
const INK = { bg: '#070b11', point: '#7aa2ff', attractor: '#47e0c8', void: '#ffb454' }

const fmt = (n: number, digits = 3) =>
  Number.isFinite(n) ? (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(digits)) : '—'

const canvasEl = ref<HTMLCanvasElement>()
const busy = ref(false)
const result = ref<FieldResult>()

// `attractors` already returns the Clark–Evans fit it computed, so we read it
// off the result instead of paying for a second O(n²) nearest-neighbour pass.
const stats = computed(() => {
  const r = result.value
  if (!r) return []
  return [
    {
      k: 'Attractor',
      v: `${r.attractor.neighbours} nb`,
      note: `densest neighbourhood · Poisson p = ${fmt(r.attractor.pValue)}`,
    },
    {
      k: 'Void',
      v: `${r.void.neighbours} nb`,
      note: `sparsest neighbourhood · Poisson p = ${fmt(r.void.pValue)}`,
    },
    {
      k: 'Clark–Evans',
      v: `z = ${fmt(r.clarkEvans.z, 2)}`,
      note: `nearest-neighbour vs CSR · p = ${fmt(r.clarkEvans.pValue)}`,
    },
    {
      k: 'Field',
      v: `${COUNT} pts`,
      note: `radius ${fmt(r.radius)} · μ ${fmt(r.expectedNeighbours, 2)} nb/pt under CSR`,
    },
  ]
})

function draw(points: readonly Point[], r: FieldResult): void {
  const ctx = canvasEl.value?.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = INK.bg
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = INK.point
  for (const p of points) {
    ctx.beginPath()
    ctx.arc(p.x * SIZE, p.y * SIZE, 2.2, 0, Math.PI * 2)
    ctx.fill()
  }
  const ring = (hot: { point: Point }, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(hot.point.x * SIZE, hot.point.y * SIZE, r.radius * SIZE, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(hot.point.x * SIZE, hot.point.y * SIZE, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ring(r.attractor, INK.attractor)
  ring(r.void, INK.void)
}

async function reseed(): Promise<void> {
  busy.value = true
  try {
    const bytes = await getBytes(COUNT * 8 + 32)
    const { points } = await sampleField(bytes, COUNT, REGION)
    const r = attractors(points, REGION, { expectedNeighbours: 5 })
    result.value = r
    draw(points, r)
  } finally {
    busy.value = false
  }
}

onMounted(reseed)
</script>

<template>
  <div>
    <UCard>
      <div class="flex flex-wrap items-center gap-4">
        <UButton :loading="busy" icon="i-lucide-shuffle" @click="reseed">Reseed field</UButton>
        <div class="flex items-center gap-4 text-sm text-muted">
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full" :style="{ background: INK.attractor }" />
            attractor
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full" :style="{ background: INK.void }" />
            void
          </span>
        </div>
        <UBadge color="neutral" variant="subtle" class="ml-auto">
          {{ COUNT }} points · unit square
        </UBadge>
      </div>
    </UCard>

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <UCard>
        <canvas
          ref="canvasEl"
          :width="SIZE"
          :height="SIZE"
          class="w-full h-auto max-w-[600px] mx-auto block aspect-square rounded border border-default bg-black"
        />
      </UCard>

      <div class="grid sm:grid-cols-2 gap-4 content-start">
        <UCard v-for="s in stats" :key="s.k">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-xs text-muted uppercase tracking-wide">{{ s.k }}</span>
            <span class="font-mono text-lg">{{ s.v }}</span>
          </div>
          <p class="mt-1 text-xs text-muted">{{ s.note }}</p>
        </UCard>
      </div>
    </div>
  </div>
</template>
