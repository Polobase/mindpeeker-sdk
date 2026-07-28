<script setup lang="ts">
import { shannonEntropy } from '@mindpeeker/negentropy'
import { getBytes } from '~/lib/entropy'

const W = 256
const H = 200
const ROW_BYTES = W / 8
// Shannon over a rolling window rather than a single 32-byte row: a row can
// hold at most log2(32) = 5 bits/byte, which reads as broken next to an ideal
// of 8. 4 KB is enough for the estimate to sit just under 8 for a healthy source.
const WINDOW = 4096

const ON = '#47e0c8'
const OFF = '#0b1119'

const PROVIDERS: readonly (readonly [string, string])[] = [
  ['crypto', 'browser CSPRNG — live here'],
  ['jitter', 'CPU timing jitter — live here'],
  ['camera', 'webcam sensor noise'],
  ['drand', 'League of Entropy beacon'],
  ['curby', 'CU Boulder beacon'],
  ['nistBeacon', 'NIST randomness beacon'],
  ['anu', 'ANU quantum vacuum'],
  ['bitcoin', 'Bitcoin block hashes'],
  ['esp32', 'ESP32 TRNG over serial'],
  ['hwRng', 'Linux /dev/hwrng'],
]

const canvasEl = ref<HTMLCanvasElement>()
const throughput = ref('—')
const shannon = ref('—')
const source = ref('—')

let raf = 0
let alive = true

onMounted(() => {
  source.value = sourceLabel(currentSourceId())

  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.fillStyle = OFF
  ctx.fillRect(0, 0, W, H)

  const win = new Uint8Array(WINDOW)
  let winPos = 0
  let winFill = 0
  let bytesSeen = 0
  let lastMark = 0
  let lastBytes = 0

  async function tick(now: number): Promise<void> {
    // Paced by the source: a beacon round takes seconds, the CSPRNG is instant.
    let chunk: Uint8Array
    try {
      chunk = await getBytes(ROW_BYTES)
    } catch {
      // Every provider is wrapped in a CSPRNG fallback, so this only fires if
      // the fallback itself is gone — stop rather than spin on a dead source.
      throughput.value = 'source unavailable'
      return
    }
    if (!alive) return

    // Scroll the whole image up one pixel, then paint the new chunk's bits
    // along the freed bottom row.
    ctx.drawImage(canvas, 0, -1)
    for (let x = 0; x < W; x++) {
      const bit = ((chunk[x >> 3] as number) >> (7 - (x & 7))) & 1
      ctx.fillStyle = bit ? ON : OFF
      ctx.fillRect(x, H - 1, 1, 1)
    }

    bytesSeen += ROW_BYTES
    win.set(chunk, winPos)
    winPos = (winPos + ROW_BYTES) % WINDOW
    winFill = Math.min(WINDOW, winFill + ROW_BYTES)

    if (lastMark === 0) {
      lastMark = now
      lastBytes = bytesSeen
    } else if (now - lastMark > 500) {
      const bps = ((bytesSeen - lastBytes) * 1000) / (now - lastMark)
      throughput.value = `${(bps / 1024).toFixed(1)} KB/s`
      shannon.value = shannonEntropy(win.subarray(0, winFill)).toFixed(2)
      lastMark = now
      lastBytes = bytesSeen
    }

    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)
})

onUnmounted(() => {
  alive = false
  cancelAnimationFrame(raf)
})
</script>

<template>
  <div>
    <UCard>
      <div class="grid sm:grid-cols-3 gap-4">
        <div>
          <div class="text-xs text-muted uppercase tracking-wide">Throughput</div>
          <div class="mt-1 font-mono text-2xl">{{ throughput }}</div>
        </div>
        <div>
          <div class="text-xs text-muted uppercase tracking-wide">Shannon (bits/byte)</div>
          <div class="mt-1 font-mono text-2xl">{{ shannon }}</div>
        </div>
        <div>
          <div class="text-xs text-muted uppercase tracking-wide">Source</div>
          <div class="mt-1 font-mono text-2xl truncate">{{ source }}</div>
        </div>
      </div>
    </UCard>

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <UCard>
        <canvas
          ref="canvasEl"
          :width="W"
          :height="H"
          class="w-full h-60 rounded border border-default bg-black [image-rendering:pixelated]"
        />
        <p class="text-xs text-muted mt-2">
          One row of {{ W }} bits per frame, newest at the bottom — {{ ROW_BYTES }} bytes pulled
          from the selected provider each tick, so a slow network source visibly slows the rain.
        </p>
      </UCard>

      <UCard>
        <h3 class="font-semibold">Providers (one interface, many backends)</h3>
        <div class="grid gap-2 mt-3">
          <div
            v-for="[name, note] in PROVIDERS"
            :key="name"
            class="flex items-baseline justify-between gap-3"
          >
            <span class="font-mono text-sm text-primary">{{ name }}</span>
            <span class="text-xs text-muted text-right">{{ note }}</span>
          </div>
        </div>
        <p class="text-xs text-muted mt-3">
          Only the browser-native providers run without a server; the rest are reachable from Node
          or behind a proxy. Pick one in the header — network sources fall back to the local CSPRNG
          if they are blocked or time out.
        </p>
      </UCard>
    </div>
  </div>
</template>
