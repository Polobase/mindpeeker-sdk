<script setup lang="ts">
/**
 * I Ching — one cast, three probability models, and the structural relatives of
 * the hexagram that came out.
 */
import type { CastMethod, Hexagram, HexagramCast } from '@mindpeeker/oracle'
import {
  castHexagram,
  fuXiNumber,
  inverseHexagram,
  LINE_WEIGHTS,
  nuclearHexagram,
  oppositeHexagram,
} from '@mindpeeker/oracle'
import { sourceSummary, withReader } from '~/lib/entropy'
import { autoRunAllowed } from '~/lib/oracle/sources'

const METHODS = [
  { value: 'coins', label: 'Three coins — 1/8, 3/8, 3/8, 1/8 (18 bits)' },
  { value: 'yarrow', label: 'Yarrow stalks — 1/16, 5/16, 7/16, 3/16 (24 bits)' },
  { value: 'singleLine', label: 'One moving line, Liber CCXVI — 1/384 (6 bits + uniformInt(6))' },
] as const

const method = ref<CastMethod>('coins')
const task = useTask<HexagramCast>()
const cast = computed(() => task.result.value)
const summary = sourceSummary()

function go(): void {
  void task.run((signal) =>
    withReader((reader) => castHexagram(reader, { method: method.value }), { signal }),
  )
}

/** Exact probability of this line sequence under the chosen model. */
const readingProbability = computed(() => {
  const result = cast.value
  if (!result) return undefined
  if (result.method === 'singleLine') return 1 / 384
  const weights = LINE_WEIGHTS[result.method]
  const total = weights.reduce((a, b) => a + b, 0)
  return result.lines.reduce((p, line) => p * ((weights[line.value - 6] as number) / total), 1)
})

const relatives = computed(() => {
  const primary = cast.value?.primary
  if (!primary) return []
  const rows: { key: string; title: string; note: string; hexagram: Hexagram }[] = [
    {
      key: 'nuclear',
      title: 'Nuclear',
      note: 'lines 2–4 under 3–5',
      hexagram: nuclearHexagram(primary),
    },
    {
      key: 'inverse',
      title: 'Inverse',
      note: 'turned 180°',
      hexagram: inverseHexagram(primary),
    },
    {
      key: 'opposite',
      title: 'Opposite',
      note: 'every line changed',
      hexagram: oppositeHexagram(primary),
    },
  ]
  return rows
})

const code = computed(
  () => `import { castHexagram, nuclearHexagram, fuXiNumber } from '@mindpeeker/oracle'

const cast = await castHexagram(source, { method: '${method.value}' })
cast.primary.kingWen      // King Wen number 1–64
cast.changing             // moving line positions
cast.relating?.name.en    // the hexagram the moving lines point to
fuXiNumber(cast.primary)  // binary value 0–63, line 1 most significant
nuclearHexagram(cast.primary).kingWen`,
)

onMounted(() => {
  if (autoRunAllowed()) go()
})
</script>

<template>
  <DemoSection
    id="iching-cast"
    title="Cast a hexagram"
    :api="['castHexagram', 'withReader', 'nuclearHexagram', 'inverseHexagram', 'oppositeHexagram', 'fuXiNumber']"
    description="Six lines drawn bottom to top. Both line-by-line methods give P(yang) = 1/2 exactly, so the primary hexagram is uniform over all 64 — but yarrow moves yang lines three times as often as yin lines (3/16 vs 1/16), which changes the relating hexagram."
  >
    <template #controls>
      <UFormField label="Method" size="sm" class="w-full sm:w-96">
        <USelect v-model="method" :items="METHODS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        label="Cast"
        busy-label="Casting…"
        icon="i-lucide-dices"
        :hint="`3 bytes from ${summary.providerName}`"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The cast failed" @dismiss="task.reset()" />

    <p v-if="!cast && !task.busy.value" class="text-sm text-muted">
      Nothing cast yet — press <strong>Cast</strong>. Every reading below is a pure function of the
      bytes it consumed.
    </p>

    <div v-else-if="cast" class="flex flex-col gap-4">
      <div class="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div class="flex flex-col gap-3">
          <OracleHexagram
            :binary="cast.primary.binary"
            :changing="cast.changing"
            :values="cast.lines.map((l) => l.value)"
            annotate
          />
          <p class="text-xs text-dimmed">bottom line drawn first</p>
        </div>

        <div class="min-w-0 flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-5xl leading-none text-primary" aria-hidden="true">
              {{ cast.primary.character }}
            </span>
            <div class="min-w-0">
              <h3 class="text-lg font-semibold text-highlighted">
                #{{ cast.primary.kingWen }} {{ cast.primary.name.en }}
              </h3>
              <p class="text-sm text-muted">
                {{ cast.primary.name.zh }} · {{ cast.primary.name.pinyin }}
                <template v-if="cast.primary.name.legge">
                  · Legge: {{ cast.primary.name.legge }}
                </template>
              </p>
            </div>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <UBadge color="neutral" variant="subtle" class="font-mono">
              Fu Xi {{ fuXiNumber(cast.primary) }}
            </UBadge>
            <UBadge color="neutral" variant="subtle" class="font-mono">
              binary {{ cast.primary.binary }}
            </UBadge>
            <UBadge color="neutral" variant="outline">
              upper {{ cast.primary.upper.character }} {{ cast.primary.upper.name }}
            </UBadge>
            <UBadge color="neutral" variant="outline">
              lower {{ cast.primary.lower.character }} {{ cast.primary.lower.name }}
            </UBadge>
          </div>

          <div v-if="cast.relating" class="rounded-md border border-default bg-elevated/40 p-3">
            <p class="text-xs uppercase tracking-wide text-muted">
              Moving line{{ cast.changing.length > 1 ? 's' : '' }}
              {{ cast.changing.join(', ') }} → relating hexagram
            </p>
            <p class="mt-1 flex items-center gap-2 text-sm">
              <span class="text-2xl leading-none text-primary" aria-hidden="true">
                {{ cast.relating.character }}
              </span>
              <span class="font-semibold text-highlighted">
                #{{ cast.relating.kingWen }} {{ cast.relating.name.en }}
              </span>
              <span class="text-muted">{{ cast.relating.name.pinyin }}</span>
            </p>
          </div>
          <p v-else class="text-sm text-muted">
            No line moved — a stable hexagram, so there is no relating hexagram.
          </p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <div
          v-for="row in relatives"
          :key="row.key"
          class="rounded-md border border-default bg-elevated/40 p-3"
        >
          <p class="text-[11px] uppercase tracking-wide text-muted">
            {{ row.title }} <span class="normal-case text-dimmed">· {{ row.note }}</span>
          </p>
          <p class="mt-1 flex items-center gap-2">
            <span class="text-2xl leading-none" aria-hidden="true">{{
              row.hexagram.character
            }}</span>
            <span class="text-sm font-medium text-highlighted">
              #{{ row.hexagram.kingWen }} {{ row.hexagram.name.en }}
            </span>
          </p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="P(this exact reading)"
          :value="readingProbability"
          :digits="6"
          tone="primary"
          note="exact rational number of the model"
        />
        <StatTile
          label="Bits used"
          :value="cast.bitsUsed"
          note="18 coins · 24 yarrow · 6 + a byte per rejection"
        />
        <StatTile label="Method" :value="cast.method" :mono="false" note="fixed before the cast" />
      </div>

      <AccountingBadge
        :bytes-consumed="cast.bytesConsumed"
        :bytes-fetched="cast.bytesFetched"
        :bits-used="cast.bitsUsed"
        :source="summary.providerName"
      />

      <CodeSnippet :code="code" title="what this button ran" />
    </div>

    <template #footer>
      The 1:3:3:1 and 4:20:28:12-of-64 counts are Hellmut Wilhelm (1957); Legge's Great Appendix I.9
      gives the 49-stalk procedure. The 16-token method, two coins thrown twice and four coins are
      probability-identical to <code>'yarrow'</code>. Meaning belongs to the tradition and the
      reader; the package asserts only the odds and the byte receipt.
    </template>
  </DemoSection>
</template>
