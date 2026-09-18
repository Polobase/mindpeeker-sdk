<script setup lang="ts">
/**
 * Tarot — a uniform deal without replacement from the 78-card RWS deck, with
 * Waite's own Celtic Cross order, an optional withdrawn Significator, and
 * dyadic or rejection-sampled reversal weights.
 */
import type { SpreadCast, SpreadName } from '@mindpeeker/oracle'
import { castSpread, expectedBytes, SPREADS, TAROT_DECK } from '@mindpeeker/oracle'
import { fmtNum } from '~/lib/format'
import { sourceSummary, withReader } from '~/lib/entropy'
import { clampInt, fmtBig, orderedDeals } from '~/lib/oracle/exact'
import { autoRunAllowed } from '~/lib/oracle/sources'

const SPREAD_ITEMS = (Object.keys(SPREADS) as SpreadName[]).map((name) => ({
  value: name,
  label: `${SPREADS[name].name} — ${SPREADS[name].positions.length} card${SPREADS[name].positions.length > 1 ? 's' : ''}`,
}))

const REVERSAL_ITEMS = [
  { value: 'off', label: 'Upright only (no orientation bit)' },
  { value: 'even', label: 'Reversed with probability 1/2 — one bit per card' },
  { value: 'weights', label: 'Dyadic weights — r / (r + u) exactly' },
] as const

const CARD_ITEMS = [
  { value: '', label: '— none (deal from all 78) —' },
  ...TAROT_DECK.map((card) => ({ value: card.id, label: `${card.id} · ${card.name}` })),
]

/**
 * Grid placement per Celtic Cross variant (wide screens only — below `lg` the
 * cards simply flow in deal order). Column 2 carries crowns/beneath, column 3
 * the card laid across the first, column 5 the staff read bottom → top.
 */
const CROSS_CELLS: Record<string, readonly string[]> = {
  // celticCross: present, challenge, foundation (below), recent past (left),
  // crown (above), near future (right), then the staff.
  celticCross: [
    'lg:col-start-2 lg:row-start-2',
    'lg:col-start-3 lg:row-start-2',
    'lg:col-start-2 lg:row-start-3',
    'lg:col-start-1 lg:row-start-2',
    'lg:col-start-2 lg:row-start-1',
    'lg:col-start-4 lg:row-start-2',
    'lg:col-start-5 lg:row-start-4',
    'lg:col-start-5 lg:row-start-3',
    'lg:col-start-5 lg:row-start-2',
    'lg:col-start-5 lg:row-start-1',
  ],
  // celticCrossWaite: covers, crosses, crowns (above), beneath, behind (left), before (right).
  celticCrossWaite: [
    'lg:col-start-2 lg:row-start-2',
    'lg:col-start-3 lg:row-start-2',
    'lg:col-start-2 lg:row-start-1',
    'lg:col-start-2 lg:row-start-3',
    'lg:col-start-1 lg:row-start-2',
    'lg:col-start-4 lg:row-start-2',
    'lg:col-start-5 lg:row-start-4',
    'lg:col-start-5 lg:row-start-3',
    'lg:col-start-5 lg:row-start-2',
    'lg:col-start-5 lg:row-start-1',
  ],
}

const spreadName = ref<SpreadName>('celticCrossWaite')
const significator = ref('')
const reversalMode = ref<'off' | 'even' | 'weights'>('even')
const reversed = ref<number>(1)
const upright = ref<number>(3)
/** Cleared number inputs must never reach the cast. */
const safeReversed = computed(() => clampInt(reversed.value, 0, 64, 1))
const safeUpright = computed(() => clampInt(upright.value, 0, 64, 3))

const task = useTask<SpreadCast>()
const cast = computed(() => task.result.value)
const summary = sourceSummary()

const reversals = computed(() => {
  if (reversalMode.value === 'off') return false
  if (reversalMode.value === 'even') return true
  return { reversed: safeReversed.value, upright: safeUpright.value }
})

const options = computed(() => ({
  reversals: reversals.value,
  ...(significator.value ? { significator: significator.value } : {}),
}))

/** Exact expectation — `expectedBytes` takes the very same option bag. */
const budget = computed(() => {
  try {
    return expectedBytes(spreadName.value, options.value)
  } catch {
    return undefined
  }
})

const deckSize = computed(() => (significator.value ? 77 : 78))
const positions = computed(() => SPREADS[spreadName.value].positions.length)
const readings = computed(() => {
  const deals = orderedDeals(deckSize.value, positions.value)
  if (reversalMode.value === 'off') return fmtBig(deals)
  if (reversalMode.value === 'even') return fmtBig(deals * 2n ** BigInt(positions.value))
  return `${fmtBig(deals)} deals × orientations`
})

function go(): void {
  void task.run((signal) =>
    withReader((reader) => castSpread(reader, spreadName.value, options.value), { signal }),
  )
}

const isCross = computed(() => spreadName.value in CROSS_CELLS)
const cells = computed(() => CROSS_CELLS[spreadName.value] ?? [])

const code = computed(() => {
  const parts: string[] = []
  if (reversalMode.value === 'even') parts.push('reversals: true')
  if (reversalMode.value === 'weights') {
    parts.push(`reversals: { reversed: ${safeReversed.value}, upright: ${safeUpright.value} }`)
  }
  if (significator.value) parts.push(`significator: '${significator.value}'`)
  return `import { castSpread, expectedBytes } from '@mindpeeker/oracle'

const opts = { ${parts.join(', ')} }
const spread = await castSpread(source, '${spreadName.value}', opts)
for (const { position, card, reversed } of spread.cards)
  console.log(position.name, card.name, reversed ? '(reversed)' : '')

expectedBytes('${spreadName.value}', opts)  // ${budget.value ? fmtNum(budget.value, { digits: 2 }) : '—'} bytes on average`
})

onMounted(() => {
  if (autoRunAllowed()) go()
})
</script>

<template>
  <DemoSection
    id="tarot-deal"
    title="Deal a spread"
    :api="['castSpread', 'SPREADS', 'TAROT_DECK', 'expectedBytes', 'drawWithoutReplacement']"
    description="A Fisher–Yates permutation prefix over the canonical deck order, every one of the N!/(N−m)! ordered deals exactly equiprobable — then one orientation draw per card, in deal order. Text cards only; no imagery ships with the package."
  >
    <template #controls>
      <UFormField label="Spread" size="sm" class="w-full sm:w-72">
        <USelect v-model="spreadName" :items="SPREAD_ITEMS" class="w-full" />
      </UFormField>
      <UFormField
        label="Significator"
        size="sm"
        class="w-full sm:w-64"
        help="withdrawn first; the rest is shuffled"
      >
        <USelect v-model="significator" :items="CARD_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Reversals" size="sm" class="w-full sm:w-80">
        <USelect v-model="reversalMode" :items="REVERSAL_ITEMS" class="w-full" />
      </UFormField>
      <template v-if="reversalMode === 'weights'">
        <UFormField label="reversed" size="sm" class="w-28">
          <UInputNumber v-model="reversed" :min="0" :max="64" class="w-full" />
        </UFormField>
        <UFormField label="upright" size="sm" class="w-28">
          <UInputNumber v-model="upright" :min="0" :max="64" class="w-full" />
        </UFormField>
      </template>
      <RunControls
        :busy="task.busy.value"
        label="Deal"
        busy-label="Dealing…"
        icon="i-lucide-layers"
        :hint="budget ? `≈ ${fmtNum(budget, { digits: 2 })} bytes expected` : 'invalid options'"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The deal failed" @dismiss="task.reset()" />

    <div v-if="cast" class="flex flex-col gap-4">
      <div v-if="cast.significator" class="rounded-md border border-primary/40 bg-primary/5 p-3">
        <p class="text-[11px] uppercase tracking-wide text-primary">
          Significator — withdrawn before the shuffle
        </p>
        <p class="mt-0.5 text-sm text-highlighted">
          {{ cast.significator.name }}
          <span class="font-mono text-xs text-muted">({{ cast.significator.id }})</span>
          — the ten were dealt from the remaining 77.
        </p>
      </div>

      <div
        class="grid gap-2"
        :class="
          isCross
            ? 'sm:grid-cols-2 lg:grid-cols-5 lg:grid-rows-4'
            : cast.cards.length > 1
              ? 'sm:grid-cols-3'
              : 'sm:max-w-sm'
        "
      >
        <div
          v-for="(drawn, i) in cast.cards"
          :key="drawn.position.name"
          class="rounded-lg border border-default bg-elevated/40 p-3"
          :class="[isCross ? cells[i] : '', drawn.reversed ? 'border-warning/50' : '']"
        >
          <p class="font-mono text-[11px] text-primary">{{ i + 1 }}. {{ drawn.position.name }}</p>
          <h3 class="mt-1 text-sm font-semibold leading-tight text-highlighted">
            {{ drawn.card.name }}
          </h3>
          <p class="mt-1 text-[11px] text-muted">
            {{ drawn.card.arcana === 'major' ? `Major ${drawn.card.number}` : drawn.card.suit }}
            <span class="font-mono">· {{ drawn.card.id }}</span>
          </p>
          <UBadge v-if="drawn.reversed" color="warning" variant="subtle" size="sm" class="mt-1.5">
            reversed
          </UBadge>
          <p class="mt-1.5 text-[11px] leading-snug text-dimmed">{{ drawn.position.meaning }}</p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Cards dealt" :value="cast.cards.length" :note="`from ${deckSize} cards`" />
        <StatTile
          label="Bytes consumed"
          :value="cast.bytesConsumed"
          :note="`expected ≈ ${budget ? fmtNum(budget, { digits: 2 }) : '—'}`"
        />
        <StatTile
          label="Reversed"
          :value="cast.cards.filter((c) => c.reversed).length"
          :note="reversalMode === 'off' ? 'orientation not drawn' : 'of this deal'"
        />
        <StatTile
          label="Equiprobable readings"
          :value="readings"
          :mono="true"
          note="every one exactly as likely"
          size="sm"
        />
      </div>

      <AccountingBadge
        :bytes-consumed="cast.bytesConsumed"
        :bytes-fetched="cast.bytesFetched"
        :bits-used="cast.bitsUsed"
        :source="summary.providerName"
      />

      <HonestNote variant="caveat" title="There is no canonical reversal rate">
        Waite prints reversed meanings; the Golden Dawn's Book T holds that a card "has the same
        meaning and forces, whether right or inverted". Whatever rate you pick is your
        pre-registered model, not a fact about tarot — the package only guarantees it is realized
        exactly: 1/2 from one bit, r/(r+u) from k bits when r + u = 2^k, and one rejection-sampled
        <code>weightedIndexRational</code> per card otherwise.
      </HonestNote>

      <CodeSnippet :code="code" title="what this button ran" />
    </div>

    <p v-else-if="!task.busy.value" class="text-sm text-muted">
      Press <strong>Deal</strong>. A Celtic Cross with reversals expects ≈ 13.63 bytes — the exact
      expectation <code>expectedBytes</code> returns.
    </p>

    <template #footer>
      <code>celticCrossWaite</code> deals in Waite's own order (<em>Pictorial Key</em>, 1911, Part
      III §7): covers, crosses, crowns, beneath, behind, before, himself, his house, hopes or fears,
      what will come. The modern <code>celticCross</code> permutes positions 3–5. Card ids match the
      mindpeeker frontend's <code>tarot.json</code>.
    </template>
  </DemoSection>
</template>
