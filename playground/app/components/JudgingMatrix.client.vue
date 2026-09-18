<script setup lang="ts">
/**
 * The SRI "direct count of permutations": a blind judge scores every transcript
 * against every target, and the only randomness the test uses is which target
 * actually went with which transcript.
 */
import type { RankMatrixTest } from '@mindpeeker/judging'
import { rankMatrixPermutationTest } from '@mindpeeker/judging'
import { drbgSource } from '~/lib/entropy'
import { fmtNum, fmtP } from '~/lib/format'
import { randomRankMatrix } from '~/lib/judging/draw'
import { pairingSums } from '~/lib/judging/math'
import { FLAT_MATRIX, SRI_MATRIX } from '~/lib/judging/presets'
import { currentSeedLabel } from '~/utils/sources'

const size = ref(6)
const better = ref<'lower' | 'higher'>('lower')
const method = ref<'auto' | 'exact' | 'monte-carlo'>('auto')
const samples = ref(9999)
const seed = ref(0)
const matrix = ref<number[][]>(SRI_MATRIX.map((row) => [...row]))
const task = useTask<number[][]>()

const betterItems = [
  { label: 'lower is better — ranks, 1 = best (the SRI convention)', value: 'lower' },
  { label: 'higher is better — ratings', value: 'higher' },
]
const methodItems = [
  { label: 'auto — exact while it is feasible', value: 'auto' },
  { label: 'exact — count every k! pairing', value: 'exact' },
  { label: 'monte-carlo — sample pairings with a seeded PRNG', value: 'monte-carlo' },
]

function identity(k: number): number[][] {
  return Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (j === i ? 1 : 1 + ((j - i + k) % k))),
  )
}

function resize(k: number): void {
  const n = Math.max(3, Math.min(8, Math.trunc(Number(k) || 3)))
  if (matrix.value.length !== n) matrix.value = identity(n)
}

watch(size, resize)

function loadSri(): void {
  matrix.value = SRI_MATRIX.map((row) => [...row])
  better.value = 'lower'
  size.value = 6
}

function loadFlat(): void {
  matrix.value = FLAT_MATRIX.map((row) => [...row])
  better.value = 'lower'
  size.value = 4
}

function randomise(): void {
  void task
    .run(async (signal) => {
      const control = drbgSource(`${currentSeedLabel()} / judging matrix`)
      return await randomRankMatrix(matrix.value.length, { signal, source: control })
    })
    .then((rows) => {
      if (rows) matrix.value = rows
    })
}

const outcome = computed<{ result?: RankMatrixTest; error?: unknown }>(() => {
  try {
    return {
      result: rankMatrixPermutationTest(
        matrix.value.map((row) => [...row]),
        {
          better: better.value,
          method: method.value,
          samples: Math.max(1, Math.min(200_000, Math.trunc(Number(samples.value) || 1))),
          seed: Math.trunc(Number(seed.value) || 0),
        },
      ),
    }
  } catch (error) {
    return { error }
  }
})

const result = computed(() => outcome.value.result)

const factorial = computed(() => {
  let total = 1
  for (let i = 2; i <= matrix.value.length; i++) total *= i
  return total
})

/** The null drawn by enumerating the same k! pairings in the browser. */
const nullHistogram = computed(() => {
  const r = result.value
  if (!r || matrix.value.length > 8) return undefined
  const sums = pairingSums(matrix.value)
  const atLeastAsGood =
    better.value === 'lower'
      ? sums.reduce((count, sum) => count + (sum <= r.statistic + 1e-9 ? 1 : 0), 0)
      : sums.reduce((count, sum) => count + (sum >= r.statistic - 1e-9 ? 1 : 0), 0)
  return { sums, atLeastAsGood }
})

const code = computed(() => {
  const r = result.value
  if (!r) return ''
  return `import { rankMatrixPermutationTest } from '@mindpeeker/judging'

// m[i][j] = transcript i scored against target j; true pairs on the diagonal
const m = [
${matrix.value.map((row) => `  [${row.join(', ')}],`).join('\n')}
]

const r = rankMatrixPermutationTest(m, { better: '${r.better}'${r.method === 'monte-carlo' ? `, method: 'monte-carlo', samples: ${r.total}, seed: ${String(r.seed ?? 0)}` : ''} })
r.statistic   // ${fmtNum(r.statistic, { digits: 4 })}   sum over the true pairs
r.expected    // ${fmtNum(r.expected, { digits: 4 })}   mean over all pairings, Σmᵢⱼ/k
r.count       // ${r.count} of ${r.total} pairings at least as good
r.pValue      // ${fmtP(r.pValue)}${r.method === 'monte-carlo' ? '   = (1 + count)/(1 + samples)' : `   = ${r.count}/${r.total}`}`
})
</script>

<template>
  <DemoSection
    id="rank-matrix"
    title="Judging matrices — an exact count over all k! pairings"
    :api="['rankMatrixPermutationTest']"
    description="Entry m[i][j] scores transcript i against target j. The statistic is the sum over the true pairs; under the null every pairing of transcripts to targets is equally likely, so p is simply the fraction of pairings that score at least as well. No independence between the judge's rows is assumed, and no normal approximation is used."
  >
    <template #controls>
      <UFormField label="k — transcripts and targets" size="sm" class="w-full sm:w-44">
        <UInputNumber v-model="size" :min="3" :max="8" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Which scores are better" size="sm" class="w-full sm:w-80">
        <USelect v-model="better" :items="betterItems" class="w-full" />
      </UFormField>
      <UFormField label="Method" size="sm" class="w-full sm:w-72">
        <USelect v-model="method" :items="methodItems" class="w-full" />
      </UFormField>
      <template v-if="method === 'monte-carlo'">
        <UFormField label="Samples" size="sm" class="w-full sm:w-36">
          <UInputNumber v-model="samples" :min="1" :max="200000" :step="1000" class="w-full" />
        </UFormField>
        <UFormField label="Seed" size="sm" class="w-full sm:w-28">
          <UInputNumber v-model="seed" :min="0" :step="1" class="w-full" />
        </UFormField>
      </template>
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-grid-3x3" @click="loadSri">
          SRI-style 6 × 6 (p = 2/720)
        </UButton>
        <UButton size="xs" variant="soft" color="neutral" @click="loadFlat">
          Every transcript judged the same (4 × 4)
        </UButton>
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-lucide-shuffle"
          :loading="task.busy.value"
          @click="randomise"
        >
          Random blind judge
        </UButton>
      </div>

      <ErrorAlert :err="task.error.value" title="The draw failed" @dismiss="task.reset()" />

      <div class="overflow-x-auto">
        <table class="text-sm">
          <caption class="sr-only">
            Judging matrix: each row is a transcript, each column a target, the diagonal the true
            pairs
          </caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-left py-1.5 pr-3 font-medium">Transcript</th>
              <th v-for="(_, c) in matrix[0] ?? []" :key="c" class="py-1.5 px-1 font-medium text-center">
                T{{ c + 1 }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, r) in matrix" :key="r" class="border-t border-default">
              <td class="py-1 pr-3 text-muted whitespace-nowrap">R{{ r + 1 }}</td>
              <td v-for="(_, c) in row" :key="c" class="py-1 px-1" :class="r === c ? 'bg-primary/10' : ''">
                <UInputNumber
                  v-model="matrix[r][c]"
                  :min="0"
                  :step="1"
                  size="xs"
                  class="w-20"
                  :aria-label="`Transcript ${r + 1} scored against target ${c + 1}${r === c ? ' (the true pair)' : ''}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-xs text-muted">
        The highlighted diagonal is the true pairing. Any other pairing can be declared with the
        <span class="font-mono">targets</span> option — the test only needs to know which cell of
        each row was the real one.
      </p>

      <ErrorAlert :err="outcome.error" title="The matrix was rejected" />

      <div v-if="result" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Statistic — true pairs"
          :value="result.statistic"
          :digits="2"
          tone="primary"
          :note="`mean over all pairings ${fmtNum(result.expected, { digits: 3 })}`"
        />
        <StatTile
          label="Pairings at least as good"
          :value="`${result.count} of ${result.total}`"
          :note="result.method === 'exact' ? `all ${factorial.toLocaleString('en-US')} pairings counted` : 'sampled pairings'"
        />
        <StatTile label="Method" :value="result.method" :mono="false" :note="result.method === 'monte-carlo' ? `seed ${String(result.seed)}` : 'direct count'" />
        <StatTile
          label="p"
          :value="result.pValue"
          :digits="6"
          tone="info"
          :note="result.method === 'exact' ? 'count / k!' : '(1 + count)/(1 + samples)'"
        />
      </div>

      <div v-if="result" class="flex flex-wrap items-center gap-4">
        <PValue :p="result.pValue" :kind="result.method === 'exact' ? 'exact' : 'pointwise'" />
        <span class="text-sm text-muted">
          the smallest p this design can produce is
          <span class="font-mono">1/{{ factorial.toLocaleString('en-US') }} =
            {{ fmtNum(1 / factorial, { digits: 6 }) }}</span>
          — one trial of six transcripts cannot go below 0.00139 however perfect the judging is.
        </span>
      </div>

      <Histogram
        v-if="nullHistogram"
        :values="nullHistogram.sums"
        :bins="Math.min(40, Math.max(8, matrix.length * 5))"
        :markers="[{ value: result?.statistic ?? 0, label: 'true pairing', color: 'primary' }]"
        x-label="score of a pairing (sum over the paired cells)"
        y-label="pairings"
        :height="240"
        aria-label="Distribution of the pairing score over all k factorial pairings, with the true pairing marked"
      />

      <p v-if="nullHistogram && result" class="text-sm text-muted">
        The histogram enumerates the same {{ factorial.toLocaleString('en-US') }} pairings in your
        browser and finds
        <span class="font-mono text-highlighted">{{ nullHistogram.atLeastAsGood }}</span>
        at least as good as the true one; the package's own count is
        <span class="font-mono text-highlighted">{{ result.count }}</span>
        <UIcon
          v-if="nullHistogram.atLeastAsGood === result.count"
          name="i-lucide-check"
          class="size-3.5 text-success align-middle"
          aria-label="the two counts agree"
        />
        — two independent routes to the same integer. (Only the package's number is used for the
        p-value; for integer matrices it comes from a subset DP instead of enumeration.)
      </p>

      <CodeSnippet :code="code" title="what these controls ran" />

      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact">
          The permutation count is an exact fact about the matrix. For integer scores the package
          uses a DP over subsets of used targets, for real scores a pruned enumeration up to k = 10,
          and beyond that a seeded Monte Carlo whose add-one estimate (1+c)/(1+m) is itself a valid
          p-value. Switch the method above: the exact and sampled answers should agree to sampling
          error.
        </HonestNote>
        <HonestNote variant="caveat">
          What the test cannot see is where the matrix came from. Marks &amp; Kammann (1978) showed
          that unedited SRI transcripts carried cues — references to the previous day's site — that
          let a judge pair them without any anomalous information at all. The arithmetic was never
          the disputed part; the transcripts were.
        </HonestNote>
      </div>
    </div>

    <template #footer>
      SRI International's evaluation procedure, declassified as
      CIA-RDP96-00787R000100060001-6. The README's 6 × 6 example scores 8 against a mean of 21.33,
      with exactly 2 of 720 pairings at least as good.
    </template>
  </DemoSection>
</template>
