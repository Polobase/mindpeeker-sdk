<script setup lang="ts">
import { transferEntropy } from '@mindpeeker/flow'
import { localBytes } from '~/lib/entropy'

const N = 4000

const coupling = ref(70)
const busy = ref(false)
const te = ref<{ xy: number; yx: number }>()

const couplingP = computed(() => coupling.value / 100)
const net = computed(() => (te.value ? te.value.xy - te.value.yx : 0))
const teMax = computed(() => (te.value ? Math.max(te.value.xy, te.value.yx, 0.02) : 0.02))
const pct = (v: number) => `${Math.min(100, (v / teMax.value) * 100)}%`
const fmt = (v: number) => v.toFixed(4)

const bit = (buf: Uint8Array, i: number) => ((buf[i >> 3] as number) >> (7 - (i & 7))) & 1

async function run(): Promise<void> {
  busy.value = true
  try {
    const c = couplingP.value
    const xBytes = await localBytes(Math.ceil(N / 8))
    const freshBytes = await localBytes(Math.ceil(N / 8))
    // One byte per step decides whether Y copies X's last bit or takes a fresh one.
    const decBytes = await localBytes(N)

    const x = new Uint8Array(N)
    const y = new Uint8Array(N)
    for (let t = 0; t < N; t++) x[t] = bit(xBytes, t)
    y[0] = bit(freshBytes, 0)
    for (let t = 1; t < N; t++) {
      y[t] = (decBytes[t] as number) < c * 256 ? (x[t - 1] as number) : bit(freshBytes, t)
    }

    te.value = { xy: transferEntropy(x, y), yx: transferEntropy(y, x) }
  } finally {
    busy.value = false
  }
}

onMounted(run)
</script>

<template>
  <div>
    <UCard>
      <div class="flex flex-wrap gap-6 items-center">
        <div class="flex-1 min-w-60">
          <label class="text-xs text-muted uppercase tracking-wide">Coupling probability</label>
          <USlider v-model="coupling" :min="0" :max="100" class="mt-3" @change="run" />
        </div>
        <UBadge color="neutral" variant="subtle" class="font-mono">
          {{ couplingP.toFixed(2) }}
        </UBadge>
        <UButton :loading="busy" @click="run">Resample</UButton>
      </div>
    </UCard>

    <UCard class="mt-4">
      <h3 class="font-semibold">Transfer entropy over {{ N }} symbols</h3>

      <div v-if="te" class="mt-4">
        <div class="mb-4">
          <div class="flex justify-between text-sm">
            <span>TE(X → Y) — X drives Y</span>
            <span class="font-mono">{{ fmt(te.xy) }} bits</span>
          </div>
          <div class="mt-1.5 h-3.5 rounded-full bg-elevated overflow-hidden">
            <div class="h-full bg-primary" :style="{ width: pct(te.xy) }" />
          </div>
        </div>

        <div class="mb-4">
          <div class="flex justify-between text-sm">
            <span>TE(Y → X) — Y drives X</span>
            <span class="font-mono">{{ fmt(te.yx) }} bits</span>
          </div>
          <div class="mt-1.5 h-3.5 rounded-full bg-elevated overflow-hidden">
            <div class="h-full bg-info" :style="{ width: pct(te.yx) }" />
          </div>
        </div>

        <p class="text-xs text-muted">
          net flow X→Y = {{ fmt(net) }} bits. A random pair sits near zero both ways; coupling lifts
          X→Y. The asymmetry — not either value alone — is what recovers the driving direction.
        </p>
      </div>

      <p v-else class="mt-4 text-muted">Sampling…</p>
    </UCard>
  </div>
</template>
