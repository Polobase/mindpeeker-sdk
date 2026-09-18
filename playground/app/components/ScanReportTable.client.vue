<script setup lang="ts">
/**
 * The ranked scan result: a sortable table of every scored item, the report's
 * multiplicity bookkeeping, and the entropy receipt.
 */
import type { TableColumn } from '@nuxt/ui'
import type { ScanReport } from '@mindpeeker/scan'
import type { Column } from '@tanstack/vue-table'
import { fmtNum, fmtP } from '~/lib/format'

const props = defineProps<{
  report: ScanReport
  alpha: number
  medianBf?: number
}>()

interface Row {
  rank: number
  id: string
  name: string
  energy: number | null
  trials: number | null
  vitality: number | null
  vitalityP: number | null
  successes: number | null
  rounds: number | null
  z: number | null
  p: number | null
  lnBayesFactor: number | null
  pHolm: number | null
  qBH: number | null
}

const rows = computed<Row[]>(() =>
  props.report.results.map((r) => ({
    rank: r.rank,
    id: r.id,
    name: r.name,
    energy: r.energy ?? null,
    trials: r.trials ?? null,
    vitality: r.vitality ?? null,
    vitalityP: r.vitalityP ?? null,
    successes: r.deviation?.successes ?? null,
    rounds: r.deviation?.rounds ?? null,
    z: r.deviation?.z ?? null,
    p: r.deviation?.p ?? null,
    lnBayesFactor: r.deviation?.lnBayesFactor ?? null,
    pHolm: r.deviation?.pHolm ?? null,
    qBH: r.deviation?.qBH ?? null,
  })),
)

const hasRace = computed(() => props.report.mode !== 'deviation')
const hasDeviation = computed(() => props.report.mode !== 'race')
const hasVitality = computed(() => props.report.results.some((r) => r.vitality !== undefined))

const UButton = resolveComponent('UButton')
const numeric = { class: { th: 'text-right', td: 'text-right font-mono tabular-nums' } }

function sortHeader(label: string, align: 'left' | 'right' = 'right') {
  return ({ column }: { column: Column<Row, unknown> }) => {
    const sorted = column.getIsSorted()
    return h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      size: 'xs',
      label,
      trailingIcon: sorted
        ? sorted === 'asc'
          ? 'i-lucide-arrow-up-narrow-wide'
          : 'i-lucide-arrow-down-wide-narrow'
        : 'i-lucide-arrow-up-down',
      class: align === 'right' ? '-me-2.5 font-medium' : '-ms-2.5 font-medium',
      onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
    })
  }
}

const columns = computed<TableColumn<Row>[]>(() => {
  const cols: TableColumn<Row>[] = [
    { accessorKey: 'rank', header: sortHeader('#'), meta: numeric },
    { accessorKey: 'name', header: sortHeader('Item', 'left') },
  ]
  if (hasRace.value) {
    cols.push({ accessorKey: 'energy', header: sortHeader('Energy'), meta: numeric })
  }
  if (hasVitality.value) {
    cols.push({ accessorKey: 'vitality', header: sortHeader('Vitality'), meta: numeric })
    cols.push({ accessorKey: 'vitalityP', header: sortHeader('P(GV ≥ v)'), meta: numeric })
  }
  if (hasDeviation.value) {
    cols.push({ accessorKey: 'successes', header: sortHeader('k / N'), meta: numeric })
    cols.push({ accessorKey: 'z', header: sortHeader('z'), meta: numeric })
    cols.push({ accessorKey: 'p', header: sortHeader('exact p'), meta: numeric })
    cols.push({ accessorKey: 'lnBayesFactor', header: sortHeader('ln BF₁₀'), meta: numeric })
    cols.push({ accessorKey: 'pHolm', header: sortHeader('p Holm'), meta: numeric })
    cols.push({ accessorKey: 'qBH', header: sortHeader('q BH'), meta: numeric })
  }
  return cols
})

const sorting = ref([{ id: 'rank', desc: false }])

const multiplicity = computed(() => props.report.multiplicity)
const zValues = computed(() =>
  props.report.results.map((r) => r.deviation?.z).filter((z): z is number => z !== undefined),
)
const zCategories = computed(() =>
  props.report.results.map((r) => (r.name.length > 10 ? `${r.name.slice(0, 9)}…` : r.name)),
)
const belowAlpha = computed(() =>
  props.report.results.flatMap((r, i) => (r.deviation && r.deviation.p <= props.alpha ? [i] : [])),
)
</script>

<template>
  <DemoSection
    id="scan-results"
    title="2 · The ranked report"
    description="Race modes rank by energy (equal energies keep the uniformly random draw order); deviation-only ranks by the log Bayes factor with ties broken on a hash of the item id — never on catalog position. Every column header sorts."
    :api="[
      'ScanResult',
      'AdjustedDeviationResult',
      'MultiplicitySummary',
      'binomialTwoSidedP',
      'byBayesFactor',
    ]"
  >
    <div class="flex flex-wrap items-center gap-2">
      <UBadge color="neutral" variant="subtle" class="font-mono">mode: {{ report.mode }}</UBadge>
      <UBadge v-if="hasRace" color="neutral" variant="subtle" class="font-mono">
        {{ report.numberOfTrials }} race passes
      </UBadge>
      <AccountingBadge
        :bytes-consumed="report.accounting.bytesConsumed"
        :bits-used="report.accounting.bitsUsed"
        :source="report.source"
      />
    </div>

    <div class="mt-3 overflow-x-auto">
      <UTable
        v-model:sorting="sorting"
        :data="rows"
        :columns="columns"
        sticky
        class="max-h-[28rem] text-sm"
      >
        <template #name-cell="{ row }">
          <span class="font-medium text-highlighted">{{ row.original.name }}</span>
          <span v-if="row.original.id !== row.original.name" class="ms-1 text-xs text-dimmed font-mono">
            {{ row.original.id }}
          </span>
        </template>
        <template #energy-cell="{ row }">
          <div v-if="row.original.energy !== null" class="flex items-center justify-end gap-2">
            <span>{{ fmtNum(row.original.energy, { digits: 3 }) }}</span>
            <span class="h-2 w-16 rounded-full bg-elevated overflow-hidden shrink-0">
              <span
                class="block h-full bg-primary"
                :style="{ width: `${Math.round((row.original.energy ?? 0) * 100)}%` }"
              />
            </span>
          </div>
          <span v-else class="text-dimmed">—</span>
        </template>
        <template #vitality-cell="{ row }">
          {{ row.original.vitality === null ? '—' : Math.round(row.original.vitality) }}
        </template>
        <template #vitalityP-cell="{ row }">
          <span :class="(row.original.vitalityP ?? 1) < 0.01 ? 'text-warning' : ''">
            {{ fmtP(row.original.vitalityP ?? undefined) }}
          </span>
        </template>
        <template #successes-cell="{ row }">
          {{ row.original.successes === null ? '—' : `${row.original.successes}/${row.original.rounds}` }}
        </template>
        <template #z-cell="{ row }">{{ fmtNum(row.original.z, { digits: 2 }) }}</template>
        <template #p-cell="{ row }">
          <span :class="(row.original.p ?? 1) <= alpha ? 'text-warning' : ''">
            {{ fmtP(row.original.p ?? undefined) }}
          </span>
        </template>
        <template #lnBayesFactor-cell="{ row }">
          {{ fmtNum(row.original.lnBayesFactor, { digits: 2 }) }}
        </template>
        <template #pHolm-cell="{ row }">{{ fmtP(row.original.pHolm ?? undefined) }}</template>
        <template #qBH-cell="{ row }">{{ fmtP(row.original.qBH ?? undefined) }}</template>
      </UTable>
    </div>

    <div v-if="multiplicity" class="mt-4 flex flex-col gap-3">
      <h3 class="text-sm font-medium text-highlighted">Multiplicity — what luck alone produces</h3>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="tests (M)" :value="multiplicity.tests" :digits="0" size="sm" :note="`α = ${multiplicity.alpha}`" />
        <StatTile
          label="expected hits (M·α)"
          :value="multiplicity.expectedFalsePositives"
          :digits="2"
          size="sm"
          tone="warning"
          note="unadjusted p ≤ α from a perfect coin"
        />
        <StatTile
          label="observed nominal hits"
          :value="multiplicity.nominalHits"
          :digits="0"
          size="sm"
          :tone="multiplicity.nominalHits > 2 * multiplicity.expectedFalsePositives ? 'warning' : 'neutral'"
          note="p ≤ α before adjustment"
        />
        <StatTile
          label="Holm / BH rejections"
          :value="`${multiplicity.holmRejections} / ${multiplicity.bhRejections}`"
          size="sm"
          :tone="multiplicity.holmRejections > 0 ? 'warning' : 'success'"
          note="family-wise / false-discovery"
        />
        <StatTile
          label="Bonferroni level"
          :value="multiplicity.bonferroniAlpha"
          :digits="5"
          size="sm"
          note="α / M, the per-test level"
        />
        <StatTile
          label="omnibus Σz²"
          :value="multiplicity.omnibus.statistic"
          :digits="1"
          size="sm"
          :note="`df ${multiplicity.omnibus.df} — expected ≈ ${multiplicity.omnibus.df}`"
        />
        <StatTile label="median BF₁₀" :value="medianBf ?? null" :digits="3" size="sm" note="below 1 favours chance" />
        <StatTile label="p₀" value="0.5" size="sm" note="exact, not estimated" />
      </div>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="text-muted">Is the source off at all?</span>
        <PValue :p="multiplicity.omnibus.p" kind="exact" label="omnibus p" />
      </div>
    </div>

    <div v-if="zValues.length > 1" class="mt-4">
      <BarChart
        :categories="zCategories"
        :values="zValues"
        :expected="0"
        expected-label="chance (z = 0)"
        :highlight="belowAlpha"
        y-label="z"
        :height="220"
        aria-label="Per-item deviation z score, with items below the nominal alpha highlighted"
        :format="(v) => v.toFixed(2)"
      />
      <p class="mt-1 text-xs text-muted">
        z is descriptive only — the p-values above come from the exact binomial tail, not from this
        normal score. Highlighted bars are items with unadjusted p ≤ {{ alpha }}; with
        {{ multiplicity?.tests ?? 0 }} items, {{ fmtNum(multiplicity?.expectedFalsePositives ?? 0, { digits: 1 }) }}
        of them are expected from a perfect coin.
      </p>
    </div>

    <HonestNote variant="exact">
      Each item is one fair coin per round, so p₀ = ½ exactly and <code class="font-mono">p</code> is
      the exact two-sided binomial tail P(|K − N/2| ≥ |k − N/2|) — equal to scipy's
      <code class="font-mono">binomtest</code>. The normal tail it replaced in 0.1 rejected a fair
      coin 7.7% of the time at nominal 5% for N = 16. Under a fair source BF₁₀ is usually
      <em>below</em> 1 (median ≈ 0.095 at N = 256): chance wins on the record.
    </HonestNote>

    <template #footer>
      A high deviation score is a chance-deviation flag, not evidence of mind–matter interaction: RF
      pickup, a warm oscillator, a biased ADC or a bug all produce "significant" deviations. Read
      <code class="font-mono">pHolm</code> and <code class="font-mono">qBH</code>, not
      <code class="font-mono">p</code>, and register the hypothesis before looking.
    </template>
  </DemoSection>
</template>
