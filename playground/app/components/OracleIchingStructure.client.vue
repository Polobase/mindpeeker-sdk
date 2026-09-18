<script setup lang="ts">
/**
 * I Ching — the structure helpers, which involve no entropy at all: pure
 * functions of the six line bits over the King Wen table.
 */
import type { Hexagram } from '@mindpeeker/oracle'
import {
  fuXiNumber,
  HEXAGRAMS,
  hexagramFromFuXi,
  inverseHexagram,
  LEGGE_NAMES,
  nuclearHexagram,
  oppositeHexagram,
  TRIGRAMS,
} from '@mindpeeker/oracle'
import { clampInt } from '~/lib/oracle/exact'

const kingWen = ref<number>(63)
/** A cleared number input must never index past the table. */
const index = computed(() => clampInt(kingWen.value, 1, 64, 1))
const current = computed<Hexagram>(() => HEXAGRAMS[index.value - 1] as Hexagram)

const fuXi = computed<number>({
  get: () => fuXiNumber(current.value),
  set: (n) => {
    if (!Number.isInteger(n) || n < 0 || n > 63) return
    kingWen.value = hexagramFromFuXi(n).kingWen
  },
})

const relatives = computed(() => {
  const h = current.value
  const nuclear = nuclearHexagram(h)
  return [
    { key: 'nuclear', title: 'Nuclear', note: 'lines 2–4 under 3–5', hexagram: nuclear },
    {
      key: 'nuclear2',
      title: 'Nuclear²',
      note: 'always #1, #2, #63 or #64',
      hexagram: nuclearHexagram(nuclear),
    },
    { key: 'inverse', title: 'Inverse', note: 'turned 180°', hexagram: inverseHexagram(h) },
    { key: 'opposite', title: 'Opposite', note: 'every line changed', hexagram: oppositeHexagram(h) },
  ]
})

/** The King Wen sequence pairs each odd hexagram with its inverse — or, for the
 *  four self-inverse pairs, with its complement. */
const pairing = computed(() => {
  const h = current.value
  const partner = h.kingWen % 2 === 1 ? h.kingWen + 1 : h.kingWen - 1
  if (partner < 1 || partner > 64) return undefined
  const inverse = inverseHexagram(h)
  const opposite = oppositeHexagram(h)
  const kind =
    inverse.kingWen === partner
      ? 'its inverse (turned 180°)'
      : opposite.kingWen === partner
        ? 'its complement — this pair is self-inverse'
        : 'neither its inverse nor its complement'
  return { partner, kind, hexagram: HEXAGRAMS[partner - 1] as Hexagram }
})

const trigrams = Object.values(TRIGRAMS)
const leggeCount = Object.keys(LEGGE_NAMES).length

const code = computed(
  () => `import { HEXAGRAMS, fuXiNumber, hexagramFromFuXi, nuclearHexagram } from '@mindpeeker/oracle'

const hexagram = HEXAGRAMS[${index.value - 1}]          // King Wen #${index.value}
fuXiNumber(hexagram)                    // ${fuXi.value} — line 1 most significant
hexagramFromFuXi(${fuXi.value}).kingWen${' '.repeat(Math.max(0, 5 - String(fuXi.value).length))}   // ${index.value} (round trip)
nuclearHexagram(hexagram).kingWen       // ${nuclearHexagram(current.value).kingWen}`,
)
</script>

<template>
  <DemoSection
    id="iching-structure"
    title="Hexagram structure"
    :api="['HEXAGRAMS', 'TRIGRAMS', 'fuXiNumber', 'hexagramFromFuXi', 'nuclearHexagram', 'inverseHexagram', 'oppositeHexagram', 'LEGGE_NAMES']"
    description="Pick any of the 64 figures and read its relatives. No entropy is involved here — these are pure functions of the line bits, verified over all 64 hexagrams in the package tests."
  >
    <template #controls>
      <UFormField label="King Wen number" size="sm" class="w-40">
        <UInputNumber v-model="kingWen" :min="1" :max="64" class="w-full" />
      </UFormField>
      <UFormField label="Fu Xi number" size="sm" class="w-40" help="binary 0–63">
        <UInputNumber v-model="fuXi" :min="0" :max="63" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
        <OracleHexagram :binary="current.binary" size="sm" />
        <div class="min-w-0">
          <h3 class="flex flex-wrap items-center gap-2 text-lg font-semibold text-highlighted">
            <span class="text-4xl leading-none text-primary" aria-hidden="true">
              {{ current.character }}
            </span>
            #{{ current.kingWen }} {{ current.name.en }}
          </h3>
          <p class="mt-1 text-sm text-muted">
            {{ current.name.zh }} · {{ current.name.pinyin }}
            <template v-if="current.name.legge"> · Legge: {{ current.name.legge }}</template>
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <UBadge color="neutral" variant="subtle" class="font-mono">
              binary {{ current.binary }}
            </UBadge>
            <UBadge color="neutral" variant="subtle" class="font-mono">Fu Xi {{ fuXi }}</UBadge>
            <UBadge color="neutral" variant="outline">
              upper {{ current.upper.character }} {{ current.upper.name }} ({{ current.upper.key }})
            </UBadge>
            <UBadge color="neutral" variant="outline">
              lower {{ current.lower.character }} {{ current.lower.name }} ({{ current.lower.key }})
            </UBadge>
          </div>
          <p v-if="pairing" class="mt-3 text-sm text-muted">
            King Wen pairs it with
            <span class="text-highlighted"
              >#{{ pairing.partner }} {{ pairing.hexagram.name.en }}</span
            >: {{ pairing.kind }}.
          </p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="row in relatives"
          :key="row.key"
          class="rounded-md border border-default bg-elevated/40 p-3"
        >
          <p class="text-[11px] uppercase tracking-wide text-muted">{{ row.title }}</p>
          <p class="text-[11px] text-dimmed">{{ row.note }}</p>
          <p class="mt-1 flex items-center gap-2">
            <span class="text-2xl leading-none" aria-hidden="true">{{ row.hexagram.character }}</span>
            <span class="text-sm font-medium text-highlighted">
              #{{ row.hexagram.kingWen }} {{ row.hexagram.name.en }}
            </span>
          </p>
        </div>
      </div>

      <div>
        <p class="text-xs uppercase tracking-wide text-muted">
          All 64 in King Wen order — pick one
        </p>
        <div class="mt-2 grid grid-cols-8 gap-1 sm:grid-cols-12">
          <button
            v-for="h in HEXAGRAMS"
            :key="h.kingWen"
            type="button"
            class="rounded border border-default px-1 py-1 text-xl leading-none transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
            :class="h.kingWen === index ? 'bg-primary/15 text-primary border-primary/50' : 'text-muted'"
            :title="`#${h.kingWen} ${h.name.en} (${h.name.pinyin})`"
            :aria-label="`Hexagram ${h.kingWen}, ${h.name.en}`"
            :aria-pressed="h.kingWen === index"
            @click="kingWen = h.kingWen"
          >
            {{ h.character }}
          </button>
        </div>
      </div>

      <div>
        <p class="text-xs uppercase tracking-wide text-muted">The eight trigrams</p>
        <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div
            v-for="t in trigrams"
            :key="t.key"
            class="flex items-center gap-2 rounded-md border border-default bg-elevated/30 px-2 py-1.5"
          >
            <span class="text-2xl leading-none" aria-hidden="true">{{ t.character }}</span>
            <span class="min-w-0">
              <span class="block truncate text-sm text-highlighted">{{ t.name }}</span>
              <span class="block font-mono text-[11px] text-dimmed">{{ t.key }} · {{ t.bits }}</span>
            </span>
          </div>
        </div>
      </div>

      <CodeSnippet :code="code" title="the helpers behind this panel" />
    </div>

    <template #footer>
      English titles follow Wilhelm–Baynes (1950); glyphs are the Unicode Yijing block.
      <code>name.legge</code> carries Legge's romanization for the {{ leggeCount }} titles verified
      against two copies of his translation — the rest are deliberately absent rather than guessed.
    </template>
  </DemoSection>
</template>
