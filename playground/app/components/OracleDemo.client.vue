<script setup lang="ts">
import type { HexagramCast, RuneCast, ShieldCast, SpreadCast } from '@mindpeeker/oracle'
import { castHexagram, castRunes, castShield, castSpread } from '@mindpeeker/oracle'
import { provider, stream } from '~/lib/entropy'

type Kind = 'iching' | 'tarot' | 'runes' | 'geomancy'

const active = ref<Kind>()
const pending = ref<Kind>()
const error = ref('')

// Casts are frozen result objects — shallowRef keeps their readonly types intact.
const hexagram = shallowRef<HexagramCast>()
const spread = shallowRef<SpreadCast>()
const runes = shallowRef<RuneCast>()
const shield = shallowRef<ShieldCast>()

async function run(kind: Kind, fn: () => Promise<void>): Promise<void> {
  pending.value = kind
  error.value = ''
  try {
    await fn()
    active.value = kind
  } catch (e) {
    active.value = undefined
    error.value = `cast failed: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    pending.value = undefined
  }
}

const iching = () =>
  run('iching', async () => {
    hexagram.value = await castHexagram(stream())
  })

const tarot = () =>
  run('tarot', async () => {
    spread.value = await castSpread(stream(), 'threeCard', { reversals: true })
  })

const futhark = () =>
  run('runes', async () => {
    runes.value = await castRunes(stream(), 3, { merkstave: true })
  })

const geomancy = () =>
  run('geomancy', async () => {
    shield.value = await castShield(stream())
  })

/** Top line first, the way a hexagram is read. */
const ichingLines = computed(() => (hexagram.value ? [...hexagram.value.lines].reverse() : []))

/** `label · bytes consumed · headline` for whichever system is on screen. */
const summary = computed(() => {
  const h = hexagram.value
  const s = spread.value
  const r = runes.value
  const g = shield.value
  switch (active.value) {
    case 'iching':
      return h
        ? {
            label: 'I-Ching',
            bytes: h.bytesConsumed,
            headline: `${h.primary.character}  #${h.primary.kingWen} · ${h.primary.name.en}`,
          }
        : undefined
    case 'tarot':
      return s ? { label: 'Tarot', bytes: s.bytesConsumed, headline: s.spread.name } : undefined
    case 'runes':
      return r
        ? {
            label: 'Elder Futhark',
            bytes: r.bytesConsumed,
            headline: r.runes.map((d) => d.rune.glyph).join('  '),
          }
        : undefined
    case 'geomancy':
      return g
        ? {
            label: 'Geomancy',
            bytes: g.bytesConsumed,
            headline: `Judge: ${g.judge.name} — ${g.judge.meaning}`,
          }
        : undefined
    default:
      return undefined
  }
})
</script>

<template>
  <div>
    <UCard>
      <div class="flex flex-wrap gap-2">
        <UButton :loading="pending === 'iching'" :disabled="!!pending" @click="iching">
          I-Ching
        </UButton>
        <UButton
          color="neutral"
          variant="subtle"
          :loading="pending === 'tarot'"
          :disabled="!!pending"
          @click="tarot"
        >
          Tarot (three-card)
        </UButton>
        <UButton
          color="neutral"
          variant="subtle"
          :loading="pending === 'runes'"
          :disabled="!!pending"
          @click="futhark"
        >
          Runes (three)
        </UButton>
        <UButton
          color="neutral"
          variant="subtle"
          :loading="pending === 'geomancy'"
          :disabled="!!pending"
          @click="geomancy"
        >
          Geomancy shield
        </UButton>
      </div>
      <p class="mt-3 text-xs text-muted">
        Pick a system to cast it from the selected entropy source ({{ provider.name }}).
      </p>
    </UCard>

    <UCard class="mt-4">
      <div class="min-h-56">
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <p v-else-if="!summary" class="text-sm text-muted">
          Nothing cast yet — every reading below is a pure function of the bytes it consumed.
        </p>

        <template v-else>
          <div class="font-mono text-xs uppercase tracking-wide text-muted">
            {{ summary.label }} · {{ summary.bytes }} byte(s) of entropy
          </div>
          <div class="mt-1 text-2xl font-semibold">{{ summary.headline }}</div>

          <div v-if="active === 'iching' && hexagram" class="mt-4">
            <div
              v-for="l in ichingLines"
              :key="l.position"
              class="font-mono text-xl tracking-[2px]"
              :class="l.changing ? 'text-primary' : ''"
            >
              {{ l.yang ? '▬▬▬▬▬▬▬' : '▬▬▬  ▬▬▬' }}{{ l.changing ? '  ✳' : '' }}
            </div>
            <p class="mt-3 text-sm text-muted">
              <template v-if="hexagram.relating">
                changing lines {{ hexagram.changing.join(', ') }} → relating #{{
                  hexagram.relating.kingWen
                }}
                {{ hexagram.relating.name.en }}
              </template>
              <template v-else>a stable hexagram — no changing lines</template>
            </p>
          </div>

          <div v-else-if="active === 'tarot' && spread" class="mt-4 grid gap-3 sm:grid-cols-3">
            <div
              v-for="d in spread.cards"
              :key="d.position.name"
              class="rounded-lg border border-default bg-elevated/40 p-3"
            >
              <div class="font-mono text-xs text-primary">{{ d.position.name }}</div>
              <h3 class="mt-1 font-semibold">{{ d.card.name }}</h3>
              <p class="mt-1 text-sm text-muted">
                {{ d.card.arcana }}{{ d.reversed ? ' · reversed' : '' }}
              </p>
            </div>
          </div>

          <div v-else-if="active === 'runes' && runes" class="mt-4 grid gap-3 sm:grid-cols-3">
            <div
              v-for="d in runes.runes"
              :key="d.rune.id"
              class="rounded-lg border border-default bg-elevated/40 p-3"
            >
              <div class="text-4xl leading-none">{{ d.rune.glyph }}</div>
              <h3 class="mt-2 font-semibold">
                {{ d.rune.name }}{{ d.merkstave ? ' (merkstave)' : '' }}
              </h3>
              <p class="mt-1 text-sm text-muted">{{ d.rune.aettName }}’s ætt</p>
            </div>
          </div>

          <div v-else-if="active === 'geomancy' && shield" class="mt-3">
            <p class="text-sm text-muted">
              Witnesses: {{ shield.witnesses[0].name }} (right), {{ shield.witnesses[1].name }}
              (left).
            </p>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div
                v-for="(f, i) in shield.mothers"
                :key="i"
                class="rounded-lg border border-default bg-elevated/40 p-3"
              >
                <div class="font-mono text-xs text-primary">Mother {{ i + 1 }}</div>
                <h3 class="mt-1 font-semibold">{{ f.name }}</h3>
                <p class="mt-1 text-sm text-muted">{{ f.meaning }}</p>
              </div>
            </div>
          </div>
        </template>
      </div>
    </UCard>
  </div>
</template>
