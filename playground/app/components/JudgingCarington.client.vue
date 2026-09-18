<script setup lang="ts">
/**
 * Carington's diagonal analysis: an originals × occasions table of hits, with
 * the expectation on each displacement diagonal taken from the row and column
 * totals. The diagonals are neither independent nor few, so the largest z needs
 * a multiplicity correction that was registered in advance.
 */
import type { DiagonalScore } from '@mindpeeker/judging'
import { deflatedCriticalValue, displacementMatrix } from '@mindpeeker/judging'
import { fmtNum } from '~/lib/format'

const DEFAULT_TABLE = [
  [3, 1, 0, 1],
  [0, 2, 1, 0],
  [1, 0, 4, 1],
  [0, 1, 1, 2],
]

const table = ref<number[][]>(DEFAULT_TABLE.map((row) => [...row]))
const size = ref(4)

function resize(k: number): void {
  const n = Math.max(2, Math.min(6, Math.trunc(Number(k) || 4)))
  if (table.value.length === n) return
  table.value = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => (r === c ? 3 : r === c - 1 ? 1 : 0)),
  )
}
watch(size, resize)

function reset(): void {
  table.value = DEFAULT_TABLE.map((row) => [...row])
  size.value = 4
}

const outcome = computed<{ diagonals?: readonly DiagonalScore[]; error?: unknown }>(() => {
  try {
    return { diagonals: displacementMatrix(table.value.map((row) => [...row])) }
  } catch (error) {
    return { error }
  }
})

const diagonals = computed(() => outcome.value.diagonals)

const chart = computed(() => {
  const rows = diagonals.value
  if (!rows) return undefined
  const scored = rows.filter((row) => row.z !== null)
  return {
    categories: scored.map((row) => (row.offset > 0 ? `+${row.offset}` : String(row.offset))),
    values: scored.map((row) => row.z as number),
  }
})

/** The bar the *largest* of these diagonals has to clear, if you are reading the largest. */
const bar = computed(() => {
  const rows = diagonals.value
  if (!rows) return undefined
  const looks = rows.filter((row) => row.z !== null).length
  return { looks, ...deflatedCriticalValue(looks) }
})

const maxZ = computed(() => {
  const rows = diagonals.value
  if (!rows) return undefined
  let best: DiagonalScore | undefined
  for (const row of rows) {
    if (row.z === null) continue
    if (!best || (best.z as number) < row.z) best = row
  }
  return best
})

const code = computed(
  () => `import { displacementMatrix } from '@mindpeeker/judging'

const hits = [
${table.value.map((row) => `  [${row.join(', ')}],`).join('\n')}
]

displacementMatrix(hits)
// [${(diagonals.value ?? [])
    .map((d) => `{ offset: ${d.offset}, observed: ${d.observed}, expected: ${fmtNum(d.expected, { digits: 3 })}, z: ${d.z === null ? 'null' : fmtNum(d.z, { digits: 3 })} }`)
    .join(',\n//  ')}]`,
)
</script>

<template>
  <DemoSection
    id="carington"
    title="Carington's diagonals"
    :api="['displacementMatrix', 'deflatedCriticalValue']"
    description="Rows are originals (the drawings, in Carington's case), columns the occasions on which responses were made. Hits on the diagonal d = c − o would be displacement in time. The expectation on each diagonal is Σ R_o C_c / T — what the marginals alone predict."
  >
    <template #controls>
      <UFormField label="Table size" size="sm" class="w-full sm:w-36">
        <UInputNumber v-model="size" :min="2" :max="6" :step="1" class="w-full" />
      </UFormField>
      <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-rotate-ccw" @click="reset">
        Reset the example
      </UButton>
    </template>

    <div class="flex flex-col gap-4">
      <div class="overflow-x-auto">
        <table class="text-sm">
          <caption class="sr-only">Hits of each original on each occasion</caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-left py-1.5 pr-3 font-medium">Original</th>
              <th v-for="(_, c) in table[0] ?? []" :key="c" class="py-1.5 px-1 font-medium text-center">
                Occasion {{ c + 1 }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, r) in table" :key="r" class="border-t border-default">
              <td class="py-1 pr-3 text-muted whitespace-nowrap">#{{ r + 1 }}</td>
              <td v-for="(_, c) in row" :key="c" class="py-1 px-1" :class="r === c ? 'bg-primary/10' : ''">
                <UInputNumber
                  v-model="table[r][c]"
                  :min="0"
                  :step="1"
                  size="xs"
                  class="w-20"
                  :aria-label="`Hits of original ${r + 1} on occasion ${c + 1}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ErrorAlert :err="outcome.error" title="The table was rejected" />

      <div v-if="diagonals" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-left py-1.5 pr-3 font-medium">Diagonal d = c − o</th>
              <th class="text-right py-1.5 px-3 font-medium">Observed</th>
              <th class="text-right py-1.5 px-3 font-medium">Expected</th>
              <th class="text-right py-1.5 pl-3 font-medium">(O − E)/√E</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in diagonals"
              :key="row.offset"
              class="border-t border-default"
              :class="row.offset === 0 ? 'bg-elevated/50' : ''"
            >
              <td class="py-1 pr-3 font-mono tabular-nums">
                {{ row.offset > 0 ? `+${row.offset}` : row.offset }}
                <span v-if="row.offset === 0" class="text-xs text-muted ml-1">(the true pairing)</span>
              </td>
              <td class="py-1 px-3 text-right font-mono tabular-nums">{{ row.observed }}</td>
              <td class="py-1 px-3 text-right font-mono tabular-nums text-muted">{{ fmtNum(row.expected, { digits: 3 }) }}</td>
              <td class="py-1 pl-3 text-right font-mono tabular-nums">
                {{ row.z === null ? '—' : fmtNum(row.z, { digits: 3 }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <BarChart
        v-if="chart"
        :categories="chart.categories"
        :values="chart.values"
        :expected="0"
        expected-label="chance"
        x-label="displacement diagonal"
        y-label="(O − E)/√E"
        :height="220"
        :format="(v) => fmtNum(v, { digits: 3 })"
        aria-label="Standardised deviation on each displacement diagonal"
      />

      <div v-if="bar && maxZ" class="rounded-md border border-default bg-elevated/40 p-3 text-sm flex flex-col gap-1">
        <p>
          <span class="text-muted">Largest diagonal:</span>
          <span class="font-mono text-highlighted ml-1">
            d = {{ maxZ.offset > 0 ? `+${maxZ.offset}` : maxZ.offset }}, z =
            {{ fmtNum(maxZ.z ?? 0, { digits: 3 }) }}
          </span>
        </p>
        <p>
          <span class="text-muted">
            If you are going to report the largest of these {{ bar.looks }} diagonals, the bar at
            α = 0.05 is Šidák's</span>
          <span class="font-mono text-highlighted ml-1">z = {{ fmtNum(bar.z, { digits: 3 }) }}</span>
          <span class="text-muted">
            (Bonferroni {{ fmtNum(bar.bonferroniZ, { digits: 3 }) }}), not 1.645 —
            {{ (maxZ.z ?? 0) > bar.z ? 'this one clears it' : 'this one does not clear it' }}.</span>
        </p>
        <p class="text-xs text-muted">
          Šidák assumes independent looks. Adjacent diagonals share rows and columns, so they are
          positively dependent and the correction is conservative here — the honest version is a
          permutation test that shuffles occasions within the table.
        </p>
      </div>

      <CodeSnippet :code="code" title="what this table ran" />

      <HonestNote variant="caveat">
        The diagonal expectations are exact arithmetic on the marginals, and nothing more. They do
        not test whether a response "belongs" to a drawing, they do not correct for the judge's
        habits, and the p-value of the biggest diagonal is not the p-value of any one diagonal.
        Carington's own conclusion rested on exactly this kind of reading.
      </HonestNote>
    </div>

    <template #footer>
      Carington (1940), <em>Proc. SPR</em> 46. The diagonal expectations always sum to the grand
      total — a useful check on any table you type in.
    </template>
  </DemoSection>
</template>
