<script setup lang="ts">
import { evaluate, pietrzakProve, pietrzakVerify } from '@mindpeeker/vdf'
import { getBytes } from '~/lib/entropy'

const tItems = [
  { label: 'T = 2¹⁶ (65,536)', value: String(2 ** 16) },
  { label: 'T = 2¹⁸ (262,144)', value: String(2 ** 18) },
  { label: 'T = 2²⁰ (1,048,576)', value: String(2 ** 20) },
]

const tChoice = ref(String(2 ** 18))
const running = ref(false)
const phase = ref('idle')
const progress = ref(0)
const message = ref<string>()

interface RunResult {
  evalMs: number
  proveMs: number
  verifyMs: number
  rounds: number
  ok: boolean
  y: string
}
const result = ref<RunResult>()

const fmt = (n: number, digits: number) => n.toFixed(digits)
const pct = computed(() => `${Math.round(progress.value * 100)}%`)

async function run(): Promise<void> {
  const T = Number(tChoice.value)
  running.value = true
  message.value = undefined
  result.value = undefined
  progress.value = 0
  phase.value = 'evaluating'
  try {
    const input = await getBytes(32)

    const tEval = performance.now()
    const { y } = await evaluate(input, T, {
      onProgress: (done, total) => {
        progress.value = done / total
      },
    })
    const evalMs = performance.now() - tEval

    // The squaring chain yields to the macrotask queue, so the bar repaints
    // before proving takes the thread back.
    phase.value = 'proving'
    progress.value = 1
    await nextTick()

    const tProve = performance.now()
    const proof = await pietrzakProve(input, T, y)
    const proveMs = performance.now() - tProve

    phase.value = 'verifying'
    const tVerify = performance.now()
    const ok = await pietrzakVerify(input, T, y, proof)
    const verifyMs = performance.now() - tVerify

    result.value = {
      evalMs,
      proveMs,
      verifyMs,
      rounds: proof.mus.length,
      ok,
      y: y.toString(16),
    }
    phase.value = ok ? 'verified ✓' : 'verification FAILED ✗'
  } catch (error) {
    phase.value = 'error'
    message.value = error instanceof Error ? error.message : String(error)
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div>
    <UCard>
      <div class="flex flex-wrap gap-4 items-end">
        <div>
          <label class="text-xs text-muted uppercase tracking-wide">Sequential squarings</label>
          <USelect v-model="tChoice" :items="tItems" :disabled="running" class="w-56 mt-1" />
        </div>
        <UButton :loading="running" @click="run">Run the delay</UButton>
        <UBadge :color="result && !result.ok ? 'error' : 'neutral'" variant="subtle">
          {{ phase }}
        </UBadge>
      </div>

      <div class="mt-4 h-3 rounded-full bg-elevated overflow-hidden">
        <div class="h-full bg-primary transition-[width] duration-100" :style="{ width: pct }" />
      </div>

      <p v-if="message" class="mt-3 text-sm text-error">{{ message }}</p>
    </UCard>

    <template v-if="result">
      <div class="grid sm:grid-cols-3 gap-4 mt-4">
        <UCard>
          <div class="text-xs text-muted uppercase tracking-wide">evaluate</div>
          <div class="mt-1 font-mono text-3xl">{{ fmt(result.evalMs, 0) }} ms</div>
        </UCard>
        <UCard>
          <div class="text-xs text-muted uppercase tracking-wide">prove</div>
          <div class="mt-1 font-mono text-3xl">{{ fmt(result.proveMs, 0) }} ms</div>
        </UCard>
        <UCard>
          <div class="text-xs text-muted uppercase tracking-wide">verify</div>
          <div class="mt-1 font-mono text-3xl">{{ fmt(result.verifyMs, 1) }} ms</div>
        </UCard>
      </div>

      <UCard class="mt-4">
        <p class="text-sm">
          {{ result.rounds }} halving rounds · output y =
          <span class="font-mono">{{ result.y.slice(0, 32) }}…</span> (mod RSA-2048)
        </p>
        <p class="text-xs text-muted mt-1">
          verification was
          {{ fmt(result.evalMs / Math.max(result.verifyMs, 0.01), 0) }}× faster than the delay —
          proof time ≪ evaluation time is the whole idea.
        </p>
      </UCard>
    </template>
  </div>
</template>
