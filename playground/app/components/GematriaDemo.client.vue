<script setup lang="ts">
import { analyze, atbash, CIPHERS, lookup, profile, reduce, value } from '@mindpeeker/gematria'
import { defaultLexicon } from '@mindpeeker/gematria/lexicon'
import { drawWord } from '@mindpeeker/gematria/oracle'
import { getBytes } from '~/lib/entropy'
import { loadWordLibrary } from '~/lib/words'

const LEXICON = defaultLexicon()
const fmt = (n: number) => n.toLocaleString('en-US')

const text = ref('wisdom')
const focus = ref('en-ordinal')
const reverse = ref(false)

const prof = computed(() => profile(text.value, { includeExtended: true }))
const applicable = computed(() => CIPHERS.filter((c) => c.script === prof.value.script))
watchEffect(() => {
  if (!applicable.value.some((c) => c.id === focus.value)) {
    focus.value = applicable.value[0]?.id ?? 'en-ordinal'
  }
})
const cipherItems = computed(() => applicable.value.map((c) => ({ label: c.label, value: c.id })))

const rows = computed(() =>
  prof.value.values.map((v) => ({
    label: v.label,
    value: v.value,
    reversed: value(text.value, v.cipher, true),
    reduced: v.reduced,
  })),
)

const breakdown = computed(() => analyze(text.value, focus.value, { reverse: reverse.value }))
const peers = computed(() =>
  LEXICON.filter((w) => value(w, focus.value, reverse.value) === breakdown.value.value),
)

const lookupN = ref(93)
const lookupResult = computed(() => lookup(Math.max(0, Math.trunc(lookupN.value || 0)), focus.value))

const drawing = ref(false)
const draw = ref<{ word: string; total: number; reduced: number; bytes: number; peers: string[] }>()
async function drawFromEntropy() {
  drawing.value = true
  try {
    const lib = await loadWordLibrary()
    const bytes = await getBytes(64)
    const { word, bytesConsumed } = await drawWord(lib, bytes)
    const total = value(word, focus.value)
    draw.value = {
      word,
      total,
      reduced: reduce(total),
      bytes: bytesConsumed,
      peers: lib.filter((w) => w !== word && value(w, focus.value) === total).slice(0, 8),
    }
  } finally {
    drawing.value = false
  }
}
</script>

<template>
  <div>
    <UCard>
      <div class="flex flex-wrap gap-4 items-end">
        <div class="flex-1 min-w-60">
          <label class="text-xs text-muted uppercase tracking-wide">Word or phrase</label>
          <UInput v-model="text" placeholder="try אהבה, θελημα, or wisdom" size="lg" class="w-full mt-1" />
        </div>
        <div>
          <label class="text-xs text-muted uppercase tracking-wide">Focus cipher</label>
          <USelect v-model="focus" :items="cipherItems" class="w-56 mt-1" />
        </div>
        <UCheckbox v-model="reverse" label="reverse" />
        <UBadge color="neutral" variant="subtle">{{ prof.script }} · {{ prof.values.length }} ciphers</UBadge>
      </div>
    </UCard>

    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <UCard>
        <h3 class="font-semibold mb-2">Every cipher</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Cipher</th>
                <th class="text-right py-1.5 px-3 font-medium">Value</th>
                <th class="text-right py-1.5 px-3 font-medium">Reversed</th>
                <th class="text-right py-1.5 pl-3 font-medium">Reduced</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="i" class="border-t border-default">
                <td class="py-1.5 pr-3">{{ r.label }}</td>
                <td class="py-1.5 px-3 text-right font-mono">{{ fmt(r.value) }}</td>
                <td class="py-1.5 px-3 text-right font-mono text-muted">{{ fmt(r.reversed) }}</td>
                <td class="py-1.5 pl-3 text-right font-mono">{{ r.reduced }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <div class="grid gap-4 content-start">
        <UCard>
          <h3 class="font-semibold">Focus cipher</h3>
          <div class="mt-2 font-mono text-3xl">{{ fmt(breakdown.value) }}</div>
          <div class="text-xs text-muted">
            {{ focus }}{{ reverse ? ' · reverse' : '' }} · reduced {{ breakdown.reduced }}
          </div>
          <p class="mt-2 font-mono text-sm">
            {{ breakdown.byLetter.length ? breakdown.byLetter.map((b) => `${b.char}=${b.value}`).join('  +  ') : '(no letters of this script)' }}
          </p>
          <p class="text-xs text-muted mt-1">atbash: {{ atbash(text) || '—' }}</p>
        </UCard>

        <UCard>
          <h3 class="font-semibold">Equal-value words</h3>
          <p class="mt-1 text-sm">
            <template v-if="peers.length">{{ breakdown.value }} also = {{ peers.slice(0, 14).join(', ') }}</template>
            <template v-else>no lexicon word equals {{ breakdown.value }} under {{ focus }}{{ reverse ? ' (reverse)' : '' }}</template>
          </p>
          <p class="text-xs text-muted mt-1">
            commonness {{ ((peers.length / LEXICON.length) * 100).toFixed(1) }}% of the
            {{ LEXICON.length }}-word Sepher Sephiroth.
          </p>
        </UCard>

        <UCard>
          <h3 class="font-semibold">Reverse lookup (number → words)</h3>
          <div class="flex gap-2 mt-2 items-center">
            <UInput v-model.number="lookupN" type="number" :min="0" class="w-32" />
            <span class="text-sm text-muted">→ under {{ focus }}</span>
          </div>
          <p class="text-sm mt-2">
            <template v-if="lookupResult.matches.length">
              {{ lookupResult.matches.slice(0, 12).join('  ·  ') }} — commonness
              {{ (lookupResult.commonness * 100).toFixed(1) }}%
            </template>
            <template v-else>no lexicon word has {{ focus }} value {{ lookupN }}</template>
          </p>
        </UCard>

        <UCard>
          <h3 class="font-semibold">Entropy oracle (English + German)</h3>
          <UButton class="mt-2" :loading="drawing" @click="drawFromEntropy">
            Draw a word from entropy
          </UButton>
          <div v-if="draw" class="mt-3">
            <div class="font-mono text-2xl">{{ draw.word }} = {{ fmt(draw.total) }}</div>
            <p class="text-xs text-muted mt-1">
              {{ focus }} · reduced {{ draw.reduced }} · {{ draw.bytes }} byte(s){{ draw.peers.length ? ` · also = ${draw.peers.join(', ')}` : '' }}
            </p>
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>
