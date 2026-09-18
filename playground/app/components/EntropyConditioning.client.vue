<script setup lang="ts">
/** Section 4c — the conditioning credit: how many raw bytes back one 32-byte
 * block, and what 0.2.0 now refuses at construction. */
import {
  bytesPerBlock,
  CREDIT_PRESETS,
  CREDIT_SNIPPET,
  EMPTY_SHA256,
  PROVIDER_CREDITS,
  probeCredit,
  sha256OfEmpty,
} from '~/lib/entropy/credits'
import { fmtBytes, fmtNum } from '~/lib/format'

const H_VALUES = [0, 0.01, 0.0625, 0.25, 1, 2, 4, 7, 8, 9]
const hItems = H_VALUES.map((value) => ({
  label:
    value === 0
      ? '0 — rejected (H must be > 0)'
      : value === 9
        ? '9 — rejected (a byte holds 8 bits)'
        : `${value} bits per raw byte`,
  value,
}))

const h = ref(7)
const quarters = ref(8) // safetyFactor × 4
const safetyFactor = computed(() => quarters.value / 4)

const plan = computed(() => probeCredit(h.value, safetyFactor.value))

const emptyDigest = ref('')
const digestMatches = computed(() => emptyDigest.value === EMPTY_SHA256)

onMounted(async () => {
  try {
    emptyDigest.value = await sha256OfEmpty()
  } catch {
    emptyDigest.value = ''
  }
})

function applyPreset(preset: (typeof CREDIT_PRESETS)[number]): void {
  h.value = preset.h
  quarters.value = Math.round(preset.safetyFactor * 4)
}

const activePreset = computed(() =>
  CREDIT_PRESETS.find((p) => p.h === h.value && p.safetyFactor === safetyFactor.value),
)

const credits = PROVIDER_CREDITS.map((row) => ({
  ...row,
  bytesPerBlock: bytesPerBlock(row.h, row.safetyFactor),
}))
</script>

<template>
  <DemoSection
    title="Conditioning credit: raw bytes in, 32 bytes out"
    :api="['minEntropyPerSample', 'safetyFactor', 'ConditioningOptions']"
    description="A conditioned block is only emitted once safetyFactor × 256 credited bits of raw material have been pooled: ⌈safetyFactor · 256 / H⌉ raw bytes per 32-byte block. The pair is validated by the provider factory itself — this panel asks the SDK rather than repeating the rule."
  >
    <template #controls>
      <UFormField label="Credited H (minEntropyPerSample)" size="sm">
        <USelect v-model="h" :items="hItems" size="sm" class="w-64" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-2">
      <label for="safety-slider" class="text-sm text-muted">
        safetyFactor — <span class="font-mono text-highlighted">{{ safetyFactor }}</span>
        (≥ 1.25 carries the SP 800-90C full-entropy margin; ≥ 1 is the hard minimum)
      </label>
      <USlider
        id="safety-slider"
        v-model="quarters"
        :min="0"
        :max="32"
        :step="1"
        aria-label="safetyFactor in quarter steps"
      />
      <div class="flex flex-wrap gap-1.5">
        <UButton
          v-for="preset in CREDIT_PRESETS"
          :key="preset.label"
          size="xs"
          color="neutral"
          :variant="activePreset?.label === preset.label ? 'solid' : 'subtle'"
          @click="applyPreset(preset)"
        >
          {{ preset.label }}
        </UButton>
      </div>
      <p v-if="activePreset" class="text-xs text-muted">{{ activePreset.why }}</p>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-4">
      <StatTile
        label="Raw bytes per block"
        :value="plan.ok ? plan.bytesPerBlock : '—'"
        :digits="0"
        :tone="plan.ok ? 'primary' : 'error'"
        note="⌈safetyFactor · 256 / H⌉, pooled before each 32-byte output"
      />
      <StatTile
        label="Credited bits per block"
        :value="plan.creditedBits"
        :digits="0"
        note="must be ≥ 256 for a full-entropy 32-byte block"
      />
      <StatTile
        label="Expansion"
        :value="plan.ok ? `${fmtNum(plan.expansion, { digits: 1 })}×` : '—'"
        note="raw bytes read per output byte"
      />
      <StatTile
        label="Raw per KiB of output"
        :value="plan.ok ? fmtBytes(plan.bytesPerBlock * 32) : '—'"
        note="1 KiB out = 32 blocks"
      />
    </div>

    <UAlert
      v-if="!plan.ok && plan.error"
      class="mt-4"
      color="error"
      variant="subtle"
      icon="i-lucide-shield-alert"
      :title="`${plan.error.name} (${plan.error.code}) — refused at construction`"
      :description="plan.error.message"
    />
    <UAlert
      v-else
      class="mt-4"
      color="success"
      variant="subtle"
      icon="i-lucide-shield-check"
      title="Accepted by the provider factory"
      :description="`serialEntropy({ source, minEntropyPerSample: ${h}, safetyFactor: ${safetyFactor} }) constructs, pooling ${plan.bytesPerBlock} raw bytes per block.`"
    />

    <HonestNote variant="fixed-in-0.2" class="mt-4">
      In 0.1 a <code class="font-mono">safetyFactor ≤ 0</code> (or an infinite H) made the pool
      require zero raw bytes, so the conditioner hashed an <em>empty</em> block and every 32-byte
      output was the same constant: SHA-256("") =
      <code class="font-mono break-all">{{ EMPTY_SHA256 }}</code>. Recomputed in your browser just
      now:
      <code class="font-mono break-all">{{ emptyDigest || '…' }}</code>
      <span v-if="emptyDigest" :class="digestMatches ? 'text-success' : 'text-error'">
        — {{ digestMatches ? 'identical' : 'MISMATCH' }}</span>. NaN pooled forever and H > 8
      over-credited. 0.2.0 validates the pair at construction with
      <code class="font-mono">EntropyError('invalid_request')</code>: pick “safetyFactor 0” above to
      watch the factory refuse.
    </HonestNote>

    <div class="mt-5 overflow-x-auto rounded-md border border-default">
      <table class="w-full text-sm border-collapse">
        <caption class="sr-only">Per-provider credit defaults and the resulting pooling cost</caption>
        <thead class="bg-elevated/60 text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" class="text-left font-medium px-3 py-2">Provider default</th>
            <th scope="col" class="text-right font-medium px-3 py-2">H (b/B)</th>
            <th scope="col" class="text-right font-medium px-3 py-2">safetyFactor</th>
            <th scope="col" class="text-right font-medium px-3 py-2">Health-test H</th>
            <th scope="col" class="text-right font-medium px-3 py-2">Raw B per block</th>
            <th scope="col" class="text-left font-medium px-3 py-2">Why</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in credits" :key="row.provider" class="border-t border-default">
            <td class="px-3 py-2 font-mono text-xs">{{ row.provider }}</td>
            <td class="px-3 py-2 text-right font-mono text-xs">{{ row.h }}</td>
            <td class="px-3 py-2 text-right font-mono text-xs">{{ row.safetyFactor }}</td>
            <td class="px-3 py-2 text-right font-mono text-xs">{{ row.healthH ?? row.h }}</td>
            <td class="px-3 py-2 text-right font-mono text-xs text-highlighted">
              {{ row.bytesPerBlock.toLocaleString('en-US') }}
            </td>
            <td class="px-3 py-2 text-xs text-muted">{{ row.note }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <CodeSnippet class="mt-4" :code="CREDIT_SNIPPET" title="the options this panel validates" />

    <template #footer>
      Health tests always run at max(credited H, the provider's stricter health H), so raising
      <code class="font-mono">minEntropyPerSample</code> tightens the tests with it — you cannot
      claim more entropy and be tested less. SP 800-90C (final since 2025-09-25) counts a vetted
      conditioner's output as full entropy when its input carries the output length plus 64 bits
      from <em>validated</em> sources; these sources carry no NIST validation, so the package makes
      no formal full-entropy claim.
    </template>
  </DemoSection>
</template>
