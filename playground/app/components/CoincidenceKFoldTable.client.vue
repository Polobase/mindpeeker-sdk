<script setup lang="ts">
/**
 * Levin's Table 3, reproduced in the browser: for c = 365 days, the least n
 * with P(some day holds ≥ k birthdays) > ½, for k = 2 … 13.
 *
 * The whole table costs well over a second of exact arithmetic, so it streams
 * one row at a time out of the worker: progress advances per row, Cancel stops
 * between rows, and the published values sit in the table from the first paint.
 */
import { kWayTable, type TableRow } from '~/lib/coincidence/exact-client'
import { fmtNum } from '~/lib/format'

/** Diaconis & Mosteller (1989), Table 3 — the numbers this button must match. */
const PUBLISHED: Readonly<Record<number, number>> = {
  2: 23,
  3: 88,
  4: 187,
  5: 313,
  6: 460,
  7: 623,
  8: 798,
  9: 985,
  10: 1181,
  11: 1385,
  12: 1596,
  13: 1813,
}

const RANGE_ITEMS = [
  { label: 'k = 2 … 6 — about half a second', value: 6 },
  { label: 'k = 2 … 9 — about a second', value: 9 },
  { label: 'k = 2 … 13 — the whole table, a few seconds', value: 13 },
]

const kMax = ref(6)
const rows = ref<TableRow[]>([])
const task = useTask<null>()

const ks = computed(() => Array.from({ length: kMax.value - 1 }, (_, i) => i + 2))

function run(): void {
  rows.value = []
  const wanted = ks.value
  void task.run(async (signal, setProgress) => {
    setProgress(0)
    return await kWayTable(wanted, 365, 0.5, {
      signal,
      onRow: (row, done, total) => {
        rows.value = [...rows.value, row]
        setProgress(done / total)
      },
    })
  })
}

const decorated = computed(() =>
  rows.value.map((row) => {
    const published = PUBLISHED[row.k]
    return {
      ...row,
      published,
      agrees: published !== undefined && published === row.n,
      fitError: row.n > 0 ? (row.fitN - row.n) / row.n : 0,
    }
  }),
)

const allAgree = computed(
  () => decorated.value.length > 0 && decorated.value.every((row) => row.agrees),
)

const series = computed(() => {
  if (!rows.value.length) return []
  const x = rows.value.map((row) => row.k)
  return [
    { name: 'exact least n (Levin)', y: rows.value.map((row) => row.n), x },
    {
      name: 'D–M eq. 7.5 root',
      y: rows.value.map((row) => row.approxN),
      x,
      color: 2 as const,
      dashed: true,
    },
    {
      name: 'their curve fit 47(k − 1.5)^{3/2}',
      y: rows.value.map((row) => row.fitN),
      x,
      color: 4 as const,
      dashed: true,
    },
  ]
})

const totalMs = computed(() => rows.value.reduce((sum, row) => sum + row.ms, 0))

const code = `import { peopleForKWayMatch, kWayMatch } from '@mindpeeker/coincidence'

for (const k of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
  const n = peopleForKWayMatch(0.5, 365, k)
  console.log(k, n, kWayMatch(n, 365, k))
}
// 2 23 0.5072972343239852
// 3 88 0.5110651106247305
// 4 187 0.5026853731889763
// …  13 1813 0.5011042246352152`
</script>

<template>
  <DemoSection
    id="levin-table"
    title="Reproducing Levin's table"
    :level="3"
    :api="['peopleForKWayMatch', 'kWayProbabilities', 'peopleForKWayMatchApprox']"
    description="For 365 equally likely days, the least number of people giving better-than-even odds of some day holding k of them. The published column is Diaconis & Mosteller's Table 3; the computed column is this SDK, run now."
  >
    <template #controls>
      <UFormField label="How far to go" size="sm" class="w-full sm:w-80">
        <USelect v-model="kMax" :items="RANGE_ITEMS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Reproduce ${ks.length} rows`"
        busy-label="Inverting the exact engine…"
        icon="i-lucide-table-2"
        hint="streams one row at a time from the worker"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" title="A row could not be computed" @dismiss="task.reset()" />

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="sr-only">
            Least number of people for a k-fold birthday match at probability one half, exact and
            approximate, against the published values
          </caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th scope="col" class="text-left py-1.5 pr-3 font-medium">k</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Computed n</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Published n</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">P(match) at that n</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">eq. 7.5 root</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">47(k−1.5)^1.5</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">fit error</th>
              <th scope="col" class="text-left py-1.5 pl-3 font-medium">engine</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in decorated" :key="row.k" class="border-t border-default">
              <th scope="row" class="py-1.5 pr-3 text-left font-mono font-normal">{{ row.k }}</th>
              <td class="py-1.5 px-3 text-right font-mono tabular-nums text-highlighted">{{ row.n }}</td>
              <td class="py-1.5 px-3 text-right font-mono tabular-nums text-muted">
                {{ row.published ?? '—' }}
                <UIcon v-if="row.agrees" name="i-lucide-check" class="size-3.5 text-success align-middle" />
              </td>
              <td class="py-1.5 px-3 text-right font-mono tabular-nums">{{ fmtNum(row.match, { digits: 6 }) }}</td>
              <td class="py-1.5 px-3 text-right font-mono tabular-nums text-muted">
                {{ fmtNum(row.approxN, { digits: 2 }) }}
              </td>
              <td class="py-1.5 px-3 text-right font-mono tabular-nums text-muted">
                {{ fmtNum(row.fitN, { digits: 1 }) }}
              </td>
              <td
                class="py-1.5 px-3 text-right font-mono tabular-nums"
                :class="Math.abs(row.fitError) <= 0.03 ? 'text-muted' : 'text-warning'"
              >
                {{ fmtNum(row.fitError * 100, { digits: 1 }) }} %
              </td>
              <td class="py-1.5 pl-3 text-muted text-xs font-mono">
                {{ row.method }} · {{ fmtNum(row.ms, { digits: 0 }) }} ms
              </td>
            </tr>
            <tr v-if="!decorated.length">
              <td colspan="8" class="py-3 text-sm text-muted">
                Nothing computed yet — press <strong>Reproduce</strong>. The first row should be
                k = 2, n = 23, P = 0.507297: the classic birthday problem is the k = 2 case of this
                table.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="decorated.length" class="flex flex-wrap items-center gap-3">
        <UBadge :color="allAgree ? 'success' : 'warning'" variant="subtle">
          {{ allAgree ? 'every computed n matches the published table' : 'a row disagrees — report it' }}
        </UBadge>
        <span class="text-sm text-muted">
          {{ decorated.length }} rows in {{ fmtNum(totalMs, { digits: 0 }) }} ms of worker time.
        </span>
      </div>

      <LineChart
        v-if="series.length > 0 && rows.length > 2"
        :series="series"
        x-label="fold size k"
        y-label="people needed for even odds"
        :height="260"
        :format="(v) => fmtNum(v, { digits: 1 })"
        aria-label="People needed for a k-fold birthday match against the fold size, exact and two approximations"
      />

      <CodeSnippet :code="code" title="the loop this button runs" />

      <HonestNote variant="caveat" title="A curve fit is not a formula">
        <span class="font-mono">47(k − 1.5)^{3/2}</span> is Diaconis &amp; Mosteller's fit to these
        very numbers, within about 3 % for 3 ≤ k ≤ 13 and badly wrong outside that range (it gives
        16.6 for k = 2, where the answer is 23). It is a mnemonic, not a derivation. The
        <em>exact</em> column is what the SDK computes; the other two columns are shown so the size
        of each approximation's error is visible rather than assumed.
      </HonestNote>
    </div>

    <template #footer>
      B. Levin (1981) for the representation; Diaconis &amp; Mosteller (1989), Table 3 for the
      published values and eq. 7.5 for the approximation.
    </template>
  </DemoSection>
</template>
