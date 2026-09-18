<script setup lang="ts">
/**
 * Several judges, one set of candidates: rank sums, the consensus order,
 * Kendall's W with the tie correction, and Friedman's χ².
 */
import type { ConsensusRank } from '@mindpeeker/judging'
import { consensusRank } from '@mindpeeker/judging'
import { drbgSource } from '~/lib/entropy'
import { fmtNum, fmtP } from '~/lib/format'
import { randomRankMatrix } from '~/lib/judging/draw'
import { currentSeedLabel } from '~/utils/sources'

const judges = ref(3)
const candidates = ref(4)
const rows = ref<number[][]>([
  [1, 2, 3, 4],
  [2, 1, 3, 4],
  [1, 3, 2, 4],
])
const task = useTask<number[][]>()

function identityRows(m: number, k: number): number[][] {
  return Array.from({ length: m }, () => Array.from({ length: k }, (_, i) => i + 1))
}

function resize(): void {
  const m = Math.max(2, Math.min(8, Math.trunc(Number(judges.value) || 2)))
  const k = Math.max(2, Math.min(8, Math.trunc(Number(candidates.value) || 2)))
  rows.value = identityRows(m, k)
}

watch([judges, candidates], resize)

function randomise(): void {
  void task
    .run(async (signal) => {
      const control = drbgSource(`${currentSeedLabel()} / judges`)
      const k = rows.value[0]?.length ?? 4
      const m = rows.value.length
      const matrix = await randomRankMatrix(Math.max(k, m), { signal, source: control })
      return matrix.slice(0, m).map((row) => row.slice(0, k))
    })
    .then((matrix) => {
      if (!matrix) return
      // a prefix of a permutation is not a ranking, so re-rank each row
      rows.value = matrix.map((row) => {
        const order = row.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
        const ranked = new Array<number>(row.length)
        order.forEach((entry, rank) => {
          ranked[entry.index] = rank + 1
        })
        return ranked
      })
    })
}

function agree(): void {
  const k = rows.value[0]?.length ?? 4
  rows.value = rows.value.map(() => Array.from({ length: k }, (_, i) => i + 1))
}

function tieAll(): void {
  const k = rows.value[0]?.length ?? 4
  const mid = (k + 1) / 2
  rows.value = rows.value.map(() => new Array<number>(k).fill(mid))
}

const rowSums = computed(() => rows.value.map((row) => row.reduce((sum, r) => sum + r, 0)))
const target = computed(() => {
  const k = rows.value[0]?.length ?? 0
  return (k * (k + 1)) / 2
})

const outcome = computed<{ result?: ConsensusRank; error?: unknown }>(() => {
  try {
    return { result: consensusRank(rows.value.map((row) => [...row])) }
  } catch (error) {
    return { error }
  }
})

const result = computed(() => outcome.value.result)

const chart = computed(() => {
  const r = result.value
  if (!r) return undefined
  return {
    categories: Array.from({ length: r.candidates }, (_, i) => `#${i + 1}`),
    values: Array.from(r.sums),
    expected: (r.judges * (r.candidates + 1)) / 2,
  }
})

const code = computed(() => {
  const r = result.value
  if (!r) return ''
  return `import { consensusRank } from '@mindpeeker/judging'

const r = consensusRank([
${rows.value.map((row) => `  [${row.join(', ')}],`).join('\n')}
])
r.sums          // [${Array.from(r.sums).join(', ')}]
r.consensus     // [${Array.from(r.consensus).join(', ')}]  (1 = best; ties get mid-ranks)
r.kendallW      // ${fmtNum(r.kendallW, { digits: 6 })}
r.friedmanChi2  // ${fmtNum(r.friedmanChi2, { digits: 6 })}   = m(k−1)W
r.friedmanP     // ${fmtP(r.friedmanP)}   large-sample χ²₍k−1₎`
})
</script>

<template>
  <DemoSection
    id="consensus"
    title="Several judges — consensus, concordance, Friedman"
    :api="['consensusRank']"
    description="Rank sums per candidate, their mid-ranks, Kendall's W with the tie correction (0 = no agreement, 1 = identical rankings) and Friedman's χ² = m(k−1)W. Rows may use half-integer mid-ranks for ties, and every row must sum to k(k+1)/2."
  >
    <template #controls>
      <UFormField label="Judges" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="judges" :min="2" :max="8" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Candidates" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="candidates" :min="2" :max="8" :step="1" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        label="Random rankings"
        busy-label="Drawing…"
        icon="i-lucide-shuffle"
        hint="independent judges with no agreement to find"
        @run="randomise"
        @cancel="task.cancel()"
      >
        <UButton variant="soft" color="neutral" @click="agree">All agree</UButton>
        <UButton variant="ghost" color="neutral" @click="tieAll">All tied</UButton>
      </RunControls>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" title="The draw failed" @dismiss="task.reset()" />

      <div class="overflow-x-auto">
        <table class="text-sm">
          <caption class="sr-only">Each judge's ranking of every candidate</caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-left py-1.5 pr-3 font-medium">Judge</th>
              <th
                v-for="(_, c) in rows[0] ?? []"
                :key="c"
                class="py-1.5 px-1 font-medium text-center"
              >
                #{{ c + 1 }}
              </th>
              <th class="py-1.5 pl-3 font-medium text-right">Σ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, j) in rows" :key="j" class="border-t border-default">
              <td class="py-1 pr-3 text-muted whitespace-nowrap">Judge {{ j + 1 }}</td>
              <td v-for="(_, c) in row" :key="c" class="py-1 px-1">
                <UInputNumber
                  v-model="rows[j][c]"
                  :min="1"
                  :max="row.length"
                  :step="0.5"
                  size="xs"
                  class="w-20"
                  :aria-label="`Judge ${j + 1}, rank given to candidate ${c + 1}`"
                />
              </td>
              <td
                class="py-1 pl-3 text-right font-mono tabular-nums"
                :class="rowSums[j] === target ? 'text-muted' : 'text-error'"
              >
                {{ fmtNum(rowSums[j], { digits: 1 }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-xs text-muted">
        Every row must sum to <span class="font-mono">k(k+1)/2 = {{ target }}</span>; a row that
        does not is rejected with <span class="font-mono">invalid_input</span> naming the row.
      </p>

      <ErrorAlert :err="outcome.error" title="The rankings were rejected" />

      <div v-if="result" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Judges × candidates" :value="`${result.judges} × ${result.candidates}`" />
        <StatTile
          label="Kendall's W"
          :value="result.kendallW"
          :digits="4"
          tone="primary"
          note="0 = no agreement, 1 = identical"
        />
        <StatTile label="Friedman χ²" :value="result.friedmanChi2" :digits="4" :note="`df ${result.candidates - 1}`" />
        <StatTile label="Consensus order" :value="Array.from(result.consensus).join(' · ')" :mono="true" note="1 = best" />
      </div>

      <div v-if="result" class="flex flex-wrap items-center gap-4">
        <PValue :p="result.friedmanP" kind="pointwise" label="Friedman p" />
        <span class="text-sm text-muted">
          large-sample χ² — with few judges or candidates a permutation test of the rankings is the
          honest version
        </span>
      </div>

      <BarChart
        v-if="chart"
        :categories="chart.categories"
        :values="chart.values"
        :expected="chart.expected"
        expected-label="chance rank sum"
        x-label="candidate"
        y-label="sum of ranks across judges"
        :height="220"
        :format="(v) => fmtNum(v, { digits: 1 })"
        aria-label="Rank sum per candidate across all judges, against the chance expectation"
      />

      <CodeSnippet :code="code" title="what this panel ran" />

      <HonestNote variant="caveat">
        Concordance is agreement, not accuracy: judges who share a bias agree perfectly. W says
        nothing about whether the consensus is right, and scoring the true target's
        <em>consensus</em> rank with <span class="font-mono">rankOrderStatistic</span> is only valid
        if the consensus rule was fixed before the judging — otherwise it is one more analysis among
        the ones you could have run.
      </HonestNote>
    </div>

    <template #footer>
      The default matrix (three judges, four candidates) gives W = 7/9 ≈ 0.7778 and χ² = 7.0 with
      three degrees of freedom. Press "All tied" to see W collapse to 0 — no ranking information,
      so no concordance to report.
    </template>
  </DemoSection>
</template>
