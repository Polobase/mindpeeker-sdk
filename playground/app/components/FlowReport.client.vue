<script setup lang="ts">
/** `transferEntropyReport` — every field, with the configuration it echoes. */
import type { TransferEntropyReport } from '@mindpeeker/flow'
import { fmtDuration, fmtNum, fmtP } from '~/lib/format'

const props = defineProps<{ report: TransferEntropyReport; elapsed?: number }>()

interface Row {
  key: string
  value: string
  note: string
}

const rows = computed<Row[]>(() => {
  const r = props.report
  const num = (value: number, digits = 5) => fmtNum(value, { digits })
  return [
    { key: 'te', value: num(r.te), note: 'plug-in transfer entropy, bits' },
    { key: 'ete', value: num(r.ete), note: 'te − mean TE of shuffled sources (Marschinski–Kantz)' },
    { key: 'nte', value: num(r.nte), note: 'ete / H(Yₜ₊₁ | Yₜᵏ) — the fraction of the remaining uncertainty (Gourévitch–Eggermont)' },
    { key: 'destEntropyRate', value: num(r.destEntropyRate), note: "the destination's own conditional entropy, bits" },
    { key: 'z', value: num(r.z, 2), note: 'descriptive; the surrogate null is not normal' },
    { key: 'p', value: fmtP(r.p), note: 'surrogate p, add-one corrected' },
    { key: 'surrogateMean', value: num(r.surrogateMean), note: 'the bias floor under this null' },
    { key: 'surrogateSd', value: num(r.surrogateSd), note: 'spread of the ensemble' },
    { key: 'distinct', value: fmtNum(r.distinct, { digits: 0 }), note: "distinct surrogate values — the null's real resolution" },
    { key: 'pChiSquare', value: fmtP(r.pChiSquare), note: `asymptotic χ² p — ${r.adequate ? 'adequately sampled' : 'NOT adequately sampled, ignore it'}` },
    { key: 'statistic', value: num(r.statistic, 2), note: 'G = 2N ln2 · te' },
    { key: 'df', value: fmtNum(r.df, { digits: 0 }), note: '(A_Y − 1) · A_Yᵏ · (A_Xˡ − 1)' },
    { key: 'count', value: fmtNum(r.count, { digits: 0 }), note: 'embedded tuples' },
    { key: 'cells', value: fmtNum(r.cells, { digits: 0 }), note: 'A_Y^(k+1) · A_Xˡ joint-table cells' },
    { key: 'occupiedCells', value: fmtNum(r.occupiedCells, { digits: 0 }), note: 'cells that actually saw data' },
    { key: 'adequate', value: String(r.adequate), note: 'N ≥ 10 · cells' },
    { key: 'embedding', value: `k ${r.embedding.k} · l ${r.embedding.l} · lag ${r.embedding.lag}`, note: 'the embedding every number above used' },
    { key: 'millerMadow', value: String(r.millerMadow), note: '(K−1)/(2N ln2) correction per entropy term' },
    {
      key: 'surrogate',
      value: `${r.surrogate.method} · n ${r.surrogate.n} · seed ${r.surrogate.seed}${r.surrogate.exact ? ' · exact' : ''}`,
      note: 'record this with the result — the null is part of the claim',
    },
  ]
})
</script>

<template>
  <div>
    <h3 class="text-sm font-medium text-highlighted">
      transferEntropyReport — everything at once, with the configuration echoed
    </h3>
    <p class="mt-1 text-xs text-muted">
      One call returns the estimate, both significance tests and the exact configuration that
      produced them{{ elapsed ? `, here in ${fmtDuration(elapsed)}` : '' }}.
    </p>
    <dl class="mt-2 divide-y divide-default rounded-md border border-default overflow-hidden">
      <div
        v-for="row in rows"
        :key="row.key"
        class="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3 odd:bg-elevated/30"
      >
        <dt class="font-mono text-xs text-primary sm:w-40 shrink-0">{{ row.key }}</dt>
        <dd class="font-mono text-sm tabular-nums text-highlighted sm:w-32 shrink-0">
          {{ row.value }}
        </dd>
        <dd class="text-xs text-muted min-w-0">{{ row.note }}</dd>
      </div>
    </dl>
  </div>
</template>
