<script setup lang="ts">
import { mountDashboard } from '@viz/client/mount'
import { PROTOCOL_VERSION } from '@viz/src/protocol'
import type { DirectoryMessage } from '@viz/src/types'
import {
  chiSquareBytes,
  cumulativeDeviation,
  monobit,
  shannonEntropy,
  significanceEnvelope,
} from '@mindpeeker/negentropy'
import { localBytes } from '~/lib/entropy'

const fmt = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—')
const grid = ref<HTMLElement>()
const running = ref(true)
const shannon = ref('—')
const chiP = ref('—')
const monoZ = ref('—')

let handle: ReturnType<typeof mountDashboard> | undefined
let timer: ReturnType<typeof setInterval> | undefined
let step = 0
let run: number[] = []
const hist = new Float32Array(256)

function bytesToBits(bytes: Uint8Array): Uint8Array {
  const bits = new Uint8Array(bytes.length * 8)
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number
    for (let k = 0; k < 8; k++) bits[i * 8 + k] = (b >> (7 - k)) & 1
  }
  return bits
}

async function tick() {
  if (!running.value || !handle) return
  const chunk = await localBytes(256)
  handle.pushFrame({ kind: 'bytes', channelId: 0, bytes: chunk })

  const h = shannonEntropy(chunk)
  handle.pushFrame({ kind: 'series', channelId: 1, points: [{ t: step, value: h }] })

  const mb = monobit(bytesToBits(chunk))
  run.push(mb.z)
  if (run.length > 512) run = [mb.z]
  const cd = cumulativeDeviation(run)
  const env = significanceEnvelope(run.length)
  const i = run.length - 1
  const bound = env[i] as number
  handle.pushFrame({
    kind: 'series',
    channelId: 2,
    points: [{ t: step, value: cd[i] as number, band: [-bound, bound] }],
  })

  for (const b of chunk) hist[b] = (hist[b] as number) + 1
  let max = 1
  for (const v of hist) if (v > max) max = v
  const data = new Float32Array(256)
  for (let j = 0; j < 256; j++) data[j] = (hist[j] as number) / max
  handle.pushFrame({ kind: 'matrix', channelId: 3, rows: 16, cols: 16, data })

  const cs = chiSquareBytes(chunk)
  shannon.value = fmt(h, 3)
  chiP.value = fmt(cs.pValue, 3)
  monoZ.value = fmt(mb.z, 2)
  step++
}

onMounted(() => {
  if (!grid.value) return
  handle = mountDashboard(grid.value)
  const directory: DirectoryMessage = {
    type: 'directory',
    version: PROTOCOL_VERSION,
    channels: [
      { id: 0, name: 'CSPRNG bytes', kind: 'bytes', status: 'live' },
      { id: 1, name: 'Shannon entropy (bits/byte)', kind: 'series', status: 'live' },
      { id: 2, name: 'Cumulative deviation vs χ² envelope', kind: 'series', status: 'live' },
      { id: 3, name: 'Byte-value density (16×16)', kind: 'matrix', status: 'live' },
    ],
  }
  handle.applyDirectory(directory)
  timer = setInterval(tick, 90)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  handle?.destroy()
})
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-4">
      <UButton color="primary" @click="running = !running">{{ running ? 'Pause' : 'Resume' }}</UButton>
      <span class="text-sm text-muted">streaming crypto.getRandomValues → panels</span>
    </div>
    <div class="grid sm:grid-cols-3 gap-3 mb-4">
      <UCard><div class="text-xs text-muted uppercase">Shannon (bits/byte)</div><div class="font-mono text-2xl">{{ shannon }}</div></UCard>
      <UCard><div class="text-xs text-muted uppercase">χ² p-value</div><div class="font-mono text-2xl">{{ chiP }}</div></UCard>
      <UCard><div class="text-xs text-muted uppercase">monobit z</div><div class="font-mono text-2xl">{{ monoZ }}</div></UCard>
    </div>
    <div ref="grid" class="viz-dash" />
  </div>
</template>

<style>
.viz-dash {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}
.viz-dash .panel {
  background: #0e141d;
  border: 1px solid #1e2733;
  border-radius: 8px;
  overflow: hidden;
}
.viz-dash .panel header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 12px;
  border-bottom: 1px solid #1e2733;
}
.viz-dash .panel h2 {
  font-size: 12px;
  font-weight: 600;
  color: #d7dde5;
  margin: 0;
}
.viz-dash .status {
  font-size: 11px;
  color: #8b97a7;
  font-family: ui-monospace, monospace;
}
.viz-dash .status.live { color: #6bd968; }
.viz-dash .status.ended { color: #ffb454; }
.viz-dash .status.error { color: #ff6b6b; }
.viz-dash .canvas-wrap { position: relative; height: 240px; }
.viz-dash .canvas-wrap.failed {
  display: grid;
  place-items: center;
  color: #ff6b6b;
  padding: 12px;
  text-align: center;
}
.viz-dash .canvas-wrap canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.viz-dash .canvas-wrap .overlay { pointer-events: none; }
</style>
