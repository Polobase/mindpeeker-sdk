<script setup lang="ts">
/**
 * The readout of a `scanTripolar` report: the PEAR high-minus-low statistic,
 * the yoked control contrast, and the catalog scored under each intention.
 */
import type { Intention } from '@mindpeeker/psi'
import type { TripolarScanReport } from '@mindpeeker/scan'
import { fmtBytes, fmtNum, fmtP } from '~/lib/format'
import { shortHash } from '~/lib/scan/stats'

const props = defineProps<{ report: TripolarScanReport; alpha: number }>()

const INTENTIONS: readonly Intention[] = ['high', 'low', 'baseline']
const LETTER: Record<Intention, string> = { high: 'H', low: 'L', baseline: 'B' }
const TONE: Record<Intention, string> = {
  high: 'text-success border-success/50 bg-success/10',
  low: 'text-error border-error/50 bg-error/10',
  baseline: 'text-muted border-default bg-elevated',
}

const analysis = computed(() => props.report.analysis)
const summaries = computed(() =>
  INTENTIONS.map((intention) => ({ intention, summary: analysis.value[intention] })).filter(
    (row) => row.summary !== undefined,
  ),
)
const zBars = computed(() => ({
  categories: summaries.value.map((r) => r.intention),
  values: summaries.value.map((r) => r.summary?.z ?? 0),
}))
const topPerIntention = computed(() =>
  INTENTIONS.map((intention) => ({
    intention,
    rows: (props.report.perIntention[intention] ?? []).slice(0, 5),
  })),
)
const multiplicity = computed(() => props.report.multiplicity)
</script>

<template>
  <DemoSection
    id="scan-tripolar-result"
    title="2 · Δz, the control arm, and the per-intention catalog"
    description="deltaZ is the PEAR primary statistic — standard normal under H0. The catalog scores below are three families of item tests, adjusted over all 3M of them at once."
    :api="['TripolarScanReport', 'analyzeTripolar', 'controlContrast', 'MultiplicitySummary']"
  >
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Δz (high − low)"
        :value="report.deltaZ"
        :digits="3"
        size="sm"
        :tone="Math.abs(report.deltaZ) > 2 ? 'warning' : 'success'"
        note="inside ±2 is what chance looks like"
      />
      <StatTile
        label="Δε per bit"
        :value="report.deltaEffect"
        :digits="6"
        size="sm"
        :note="`95% CI [${fmtNum(report.deltaCi95[0], { digits: 5 })}, ${fmtNum(report.deltaCi95[1], { digits: 5 })}]`"
      />
      <StatTile
        label="registration"
        :value="shortHash(report.registration, 12)"
        size="sm"
        tone="primary"
        note="the runs were checked against it"
      />
      <StatTile label="order" :value="report.order" size="sm" note="the plan's intention order" />
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <span class="text-muted">one-sided, in the pre-stated direction</span>
      <PValue :p="analysis.deltaP" kind="pointwise" label="Δp" />
      <span v-if="report.control" class="text-muted">control contrast</span>
      <PValue v-if="report.control" :p="report.control.contrast.pValue" kind="pointwise" label="p" />
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-1">
      <span class="text-xs uppercase tracking-wide text-muted me-1">collection order</span>
      <span
        v-for="(intention, i) in report.schedule"
        :key="i"
        class="inline-flex size-6 items-center justify-center rounded border font-mono text-[11px]"
        :class="TONE[intention]"
        :title="`run ${i}: ${intention}`"
      >{{ LETTER[intention] }}</span>
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <BarChart
        :categories="zBars.categories"
        :values="zBars.values"
        :expected="0"
        expected-label="chance (z = 0)"
        y-label="Stouffer z"
        :height="220"
        aria-label="Stouffer combined z per intention, against zero"
        :format="(v) => v.toFixed(3)"
      />
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-left py-1 pe-3 font-medium">intention</th>
              <th class="text-right py-1 px-3 font-medium">bits</th>
              <th class="text-right py-1 px-3 font-medium">z</th>
              <th class="text-right py-1 px-3 font-medium">ε per bit</th>
              <th class="text-right py-1 ps-3 font-medium">variance z</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in summaries" :key="row.intention" class="border-t border-default">
              <td class="py-1 pe-3">{{ row.intention }}</td>
              <td class="py-1 px-3 text-right font-mono tabular-nums">
                {{ fmtNum(row.summary?.bits, { digits: 0 }) }}
              </td>
              <td class="py-1 px-3 text-right font-mono tabular-nums">
                {{ fmtNum(row.summary?.z, { digits: 3 }) }}
              </td>
              <td class="py-1 px-3 text-right font-mono tabular-nums">
                {{ fmtNum(row.summary?.effectSize, { digits: 6 }) }}
              </td>
              <td class="py-1 ps-3 text-right font-mono tabular-nums">
                {{ fmtNum(row.summary?.variance.z, { digits: 2 }) }}
              </td>
            </tr>
          </tbody>
        </table>
        <p class="mt-1 text-xs text-muted">
          The variance column is PEAR's "bind": a surplus of trials sitting exactly at the
          theoretical mean, which a mean-shift test cannot see.
        </p>
      </div>
    </div>

    <div v-if="report.control" class="mt-4 rounded-md border border-default p-3">
      <h3 class="text-sm font-semibold text-highlighted">Yoked control arm</h3>
      <p class="text-xs text-muted mt-1">
        A seeded DRBG ran the same schedule. Under the joint null — neither source responds to
        intention — the two separations are independent and their contrast is standard normal.
      </p>
      <div class="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="control Δz" :value="report.control.analysis.deltaZ" :digits="3" size="sm" />
        <StatTile
          label="contrast z"
          :value="report.control.contrast.z"
          :digits="3"
          size="sm"
          :tone="Math.abs(report.control.contrast.z) > 2 ? 'warning' : 'success'"
          note="experimental minus control"
        />
        <StatTile
          label="Δε difference"
          :value="report.control.contrast.deltaEffectDifference"
          :digits="6"
          size="sm"
          :note="`95% CI [${fmtNum(report.control.contrast.ci95[0], { digits: 5 })}, ${fmtNum(report.control.contrast.ci95[1], { digits: 5 })}]`"
        />
        <StatTile
          label="control source"
          :value="report.control.source"
          size="sm"
          note="its name must differ from the experimental source"
        />
      </div>
    </div>

    <div class="mt-4">
      <h3 class="text-sm font-semibold text-highlighted">Catalog scored under each intention</h3>
      <p class="text-xs text-muted mt-1">
        Top five items by log Bayes factor. Multiplicity is adjusted over all
        {{ multiplicity.tests }} tests at once — three intentions × the catalog — not per intention.
      </p>
      <div class="mt-2 grid gap-3 lg:grid-cols-3">
        <div
          v-for="block in topPerIntention"
          :key="block.intention"
          class="rounded-md border border-default p-3"
        >
          <div class="flex items-center gap-2">
            <span
              class="inline-flex size-5 items-center justify-center rounded border font-mono text-[10px]"
              :class="TONE[block.intention]"
            >{{ LETTER[block.intention] }}</span>
            <span class="text-sm font-medium text-highlighted">{{ block.intention }}</span>
          </div>
          <table class="mt-2 w-full text-xs">
            <thead>
              <tr class="text-muted uppercase">
                <th class="text-left py-1 font-medium">item</th>
                <th class="text-right py-1 font-medium">k/N</th>
                <th class="text-right py-1 font-medium">p</th>
                <th class="text-right py-1 font-medium">Holm</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in block.rows" :key="row.id" class="border-t border-default">
                <td class="py-1 pe-2 truncate max-w-[9rem]">{{ row.name }}</td>
                <td class="py-1 text-right font-mono tabular-nums">
                  {{ row.deviation?.successes }}/{{ row.deviation?.rounds }}
                </td>
                <td
                  class="py-1 text-right font-mono tabular-nums"
                  :class="(row.deviation?.p ?? 1) <= alpha ? 'text-warning' : ''"
                >
                  {{ fmtP(row.deviation?.p) }}
                </td>
                <td class="py-1 text-right font-mono tabular-nums">{{ fmtP(row.deviation?.pHolm) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="tests (3M)"
        :value="multiplicity.tests"
        :digits="0"
        size="sm"
        :note="`α = ${multiplicity.alpha}`"
      />
      <StatTile
        label="expected hits (M·α)"
        :value="multiplicity.expectedFalsePositives"
        :digits="2"
        size="sm"
        tone="warning"
        :note="`observed ${multiplicity.nominalHits}`"
      />
      <StatTile
        label="Holm / BH rejections"
        :value="`${multiplicity.holmRejections} / ${multiplicity.bhRejections}`"
        size="sm"
        :tone="multiplicity.holmRejections > 0 ? 'warning' : 'success'"
      />
      <StatTile
        label="omnibus Σz²"
        :value="multiplicity.omnibus.statistic"
        :digits="1"
        size="sm"
        :note="`df ${multiplicity.omnibus.df} · p ${fmtP(multiplicity.omnibus.p)}`"
      />
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <UBadge color="neutral" variant="subtle" class="font-mono">
        protocol {{ fmtBytes(report.phaseAccounting.protocol.bytesConsumed) }}
      </UBadge>
      <UBadge color="neutral" variant="subtle" class="font-mono">
        scoring {{ fmtBytes(report.phaseAccounting.scoring.bytesConsumed) }}
      </UBadge>
      <AccountingBadge
        :bytes-consumed="report.accounting.bytesConsumed"
        :bits-used="report.accounting.bitsUsed"
        :source="report.source"
      />
    </div>

    <HonestNote variant="contested">
      A non-zero Δz is a fact about these bytes. It is not proof of a mechanism, and this package
      makes no such claim. If the control arm — which no one intended anything at — separates as
      much, the pipeline is the explanation. Read the contrast before the headline.
    </HonestNote>

    <template #footer>
      One stream served both phases in order, so <code class="font-mono">accounting</code> covers
      everything consumed and a replayable source never reuses phase-1 bytes.
    </template>
  </DemoSection>
</template>
