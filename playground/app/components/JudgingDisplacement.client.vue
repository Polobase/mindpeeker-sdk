<script setup lang="ts">
/**
 * Displacement: scoring each call against the targets a place or two before or
 * after its own. Two things go wrong at once — the pooled variance is not
 * binomial, and choosing the offsets afterwards is a multiplicity error.
 *
 * Targets and calls are both drawn under the null (independent sources), so
 * anything this panel shows is what chance produces.
 */
import type { DisplacementScore } from '@mindpeeker/judging'
import { displacementScore } from '@mindpeeker/judging'
import { drbgSource, sourceSummary } from '~/lib/entropy'
import { fmtNum, fmtP } from '~/lib/format'
import { stickyCalls, uniformSymbols } from '~/lib/judging/draw'
import { SOAL_TABLE_I } from '~/lib/judging/presets'
import { currentSeedLabel } from '~/utils/sources'

const OFFSETS = [-2, -1, 0, 1, 2]

const runs = ref(20)
const runLength = ref(25)
const choices = ref(5)
const style = ref<'independent' | 'sticky'>('independent')
const selected = ref<number[]>([-1, 0, 1])
const data = shallowRef<{ targets: number[]; calls: number[] } | undefined>()
const task = useTask<{ targets: number[]; calls: number[] }>()
const summary = sourceSummary()

const styleItems = [
  { label: 'independent — a fresh uniform call every time', value: 'independent' },
  { label: 'sticky — repeats the previous call half the time', value: 'sticky' },
]

const trials = computed(
  () =>
    Math.max(1, Math.min(30, Math.trunc(Number(runs.value) || 1))) *
    Math.max(2, Math.min(50, Math.trunc(Number(runLength.value) || 25))),
)

function toggleOffset(offset: number): void {
  selected.value = selected.value.includes(offset)
    ? selected.value.filter((d) => d !== offset)
    : [...selected.value, offset].sort((a, b) => a - b)
}

function generate(): void {
  void task
    .run(async (signal) => {
      const k = Math.max(2, Math.min(9, Math.trunc(Number(choices.value) || 5)))
      const n = trials.value
      const caller = drbgSource(`${currentSeedLabel()} / displacement caller`)
      const targets = await uniformSymbols(n, k, { signal })
      const calls =
        style.value === 'sticky'
          ? await stickyCalls(n, k, { signal, source: caller })
          : await uniformSymbols(n, k, { signal, source: caller })
      return { targets, calls }
    })
    .then((result) => {
      if (result) data.value = result
    })
}

const outcome = computed<{ score?: DisplacementScore; error?: unknown }>(() => {
  const current = data.value
  if (!current) return {}
  try {
    return {
      score: displacementScore(current.targets, current.calls, {
        choices: Math.max(2, Math.min(9, Math.trunc(Number(choices.value) || 5))),
        offsets: selected.value.length ? [...selected.value] : [0],
        runLength: Math.max(2, Math.min(50, Math.trunc(Number(runLength.value) || 25))),
      }),
    }
  } catch (error) {
    return { error }
  }
})

const score = computed(() => outcome.value.score)

const offsetChart = computed(() => {
  const s = score.value
  if (!s) return undefined
  return {
    categories: s.perOffset.map((entry) => (entry.offset > 0 ? `+${entry.offset}` : String(entry.offset))),
    values: s.perOffset.map((entry) => entry.criticalRatio),
  }
})

const soalTotal = computed(() =>
  SOAL_TABLE_I.reduce((sum, row) => sum + row.count * row.variance, 0),
)
const soalComparisons = computed(() => SOAL_TABLE_I.reduce((sum, row) => sum + row.count, 0))

const code = computed(() => {
  const s = score.value
  if (!s) return ''
  return `import { displacementScore } from '@mindpeeker/judging'

const r = displacementScore(targets, calls, {
  choices: ${s.choices},
  offsets: [${s.offsets.join(', ')}],
  runLength: ${runLength.value},
})
r.comparisons            // ${s.comparisons}
r.hits                   // ${s.hits}   expected ${fmtNum(s.expected, { digits: 2 })}
r.variance               // ${fmtNum(s.variance, { digits: 4 })}   pattern-exact, given the calls made
r.binomialVariance       // ${fmtNum(s.binomialVariance, { digits: 4 })}   the naive one
r.criticalRatio          // ${fmtNum(s.criticalRatio, { digits: 4 })}
r.binomialCriticalRatio  // ${fmtNum(s.binomialCriticalRatio, { digits: 4 })}
r.pOneSided              // ${fmtP(s.pOneSided)}   (${s.pMethod})
r.patterns               // ${s.patterns.map((p) => `${p.signature}×${p.count}`).join(', ')}`
})
</script>

<template>
  <DemoSection
    id="displacement"
    title="Displacement — scoring the neighbours too"
    :api="['displacementScore']"
    description="Call i is compared with target i + d. Each offset on its own is an exact binomial; pooling them reuses every target, so the variance depends on the pattern of the calls — the substance of Bartlett's objection to Soal."
  >
    <template #controls>
      <UFormField label="Runs" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="runs" :min="1" :max="30" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Calls per run" size="sm" class="w-full sm:w-36">
        <UInputNumber v-model="runLength" :min="2" :max="50" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Symbols" size="sm" class="w-full sm:w-28">
        <UInputNumber v-model="choices" :min="2" :max="9" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Calling style" size="sm" class="w-full sm:w-80">
        <USelect v-model="style" :items="styleItems" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :label="data ? 'Draw again' : 'Draw targets and calls'"
        busy-label="Drawing…"
        icon="i-lucide-dices"
        :hint="`${trials} targets from ${summary.label}, ${trials} calls from an independent seeded arm`"
        @run="generate"
        @cancel="task.cancel()"
      />
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="task.error.value" title="The draw failed" @dismiss="task.reset()" />
      <ErrorAlert :err="outcome.error" title="The sequences were rejected" />

      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs uppercase tracking-wide text-muted">Offsets scored and pooled</span>
        <UButton
          v-for="offset in OFFSETS"
          :key="offset"
          size="xs"
          :variant="selected.includes(offset) ? 'solid' : 'outline'"
          :color="selected.includes(offset) ? 'primary' : 'neutral'"
          :aria-pressed="selected.includes(offset)"
          @click="toggleOffset(offset)"
        >
          {{ offset > 0 ? `+${offset}` : offset }}
        </UButton>
        <span class="text-xs text-muted">
          d = 0 is the target itself; d = +1 scores a call against the <em>next</em> target
          (precognitive displacement in Soal's terms).
        </span>
      </div>

      <p v-if="!data" class="text-sm text-muted">
        Nothing has been drawn yet. Both sequences come from sources that cannot see each other, so
        every displacement score below is a sample of the null — press the button a few times and
        watch the "best" offset move around.
      </p>

      <template v-if="score">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="sr-only">Score at each offset</caption>
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Offset</th>
                <th class="text-right py-1.5 px-3 font-medium">Comparisons</th>
                <th class="text-right py-1.5 px-3 font-medium">Hits</th>
                <th class="text-right py-1.5 px-3 font-medium">Expected</th>
                <th class="text-right py-1.5 px-3 font-medium">CR</th>
                <th class="text-right py-1.5 pl-3 font-medium">Exact P(X ≥ hits)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in score.perOffset" :key="entry.offset" class="border-t border-default">
                <td class="py-1 pr-3 font-mono tabular-nums">{{ entry.offset > 0 ? `+${entry.offset}` : entry.offset }}</td>
                <td class="py-1 px-3 text-right font-mono tabular-nums text-muted">{{ entry.comparisons }}</td>
                <td class="py-1 px-3 text-right font-mono tabular-nums">{{ entry.hits }}</td>
                <td class="py-1 px-3 text-right font-mono tabular-nums text-muted">{{ fmtNum(entry.expected, { digits: 1 }) }}</td>
                <td class="py-1 px-3 text-right font-mono tabular-nums">{{ fmtNum(entry.criticalRatio, { digits: 3 }) }}</td>
                <td class="py-1 pl-3 text-right font-mono tabular-nums">{{ fmtP(entry.pOneSided) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <BarChart
          v-if="offsetChart"
          :categories="offsetChart.categories"
          :values="offsetChart.values"
          :expected="0"
          expected-label="chance"
          x-label="offset d"
          y-label="critical ratio"
          :height="220"
          :format="(v) => fmtNum(v, { digits: 3 })"
          aria-label="Critical ratio at each displacement offset"
        />

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Pooled comparisons" :value="score.comparisons" :digits="0" />
          <StatTile label="Pooled hits" :value="score.hits" :digits="0" :note="`expected ${fmtNum(score.expected, { digits: 2 })}`" />
          <StatTile
            label="Pattern-exact variance"
            :value="score.variance"
            :digits="4"
            tone="primary"
            note="given the calls actually made"
          />
          <StatTile
            label="Naive binomial variance"
            :value="score.binomialVariance"
            :digits="4"
            tone="warning"
            note="valid only for random-pattern calling"
          />
        </div>

        <div class="flex flex-wrap items-center gap-4">
          <span class="text-sm">
            <span class="text-muted">CR with the exact variance</span>
            <span class="font-mono text-highlighted ml-1">{{ fmtNum(score.criticalRatio, { digits: 4 }) }}</span>
          </span>
          <span class="text-sm">
            <span class="text-muted">CR with the binomial variance</span>
            <span class="font-mono text-warning ml-1">{{ fmtNum(score.binomialCriticalRatio, { digits: 4 }) }}</span>
          </span>
          <PValue :p="score.pOneSided" :kind="score.pMethod === 'exact' ? 'exact' : 'pointwise'" label="pooled P(X ≥ hits)" />
          <UBadge size="sm" color="neutral" variant="subtle">{{ score.pMethod }} tail</UBadge>
        </div>

        <div>
          <h3 class="text-sm font-semibold text-highlighted">Call patterns, and what each is worth</h3>
          <p class="mt-1 text-sm text-muted">
            For every target, the calls compared with it form a pattern: three equal calls (AAA),
            two equal and one other (AAB), three different (ABC). The null variance of the hits on
            that target is Σμₛ²/m − (Σμₛ/m)², which is 36/25, 16/25 and 6/25 for m = 5.
          </p>
          <div class="mt-2 overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-muted text-xs uppercase">
                  <th class="text-left py-1.5 pr-3 font-medium">Pattern</th>
                  <th class="text-right py-1.5 px-3 font-medium">Targets</th>
                  <th class="text-right py-1.5 px-3 font-medium">Variance each</th>
                  <th class="text-right py-1.5 pl-3 font-medium">Contribution</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="pattern in score.patterns" :key="pattern.signature" class="border-t border-default">
                  <td class="py-1 pr-3 font-mono">{{ pattern.signature }}</td>
                  <td class="py-1 px-3 text-right font-mono tabular-nums">{{ pattern.count }}</td>
                  <td class="py-1 px-3 text-right font-mono tabular-nums text-muted">{{ fmtNum(pattern.variance, { digits: 4 }) }}</td>
                  <td class="py-1 pl-3 text-right font-mono tabular-nums">{{ fmtNum(pattern.count * pattern.variance, { digits: 3 }) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mt-2 text-sm text-muted">
            Switch the calling style to "sticky" and draw again: the same number of comparisons, the
            same expectation, but more AAA patterns — and the exact variance moves away from the
            binomial one. Nothing about the caller's <em>accuracy</em> changed.
          </p>
        </div>
      </template>

      <div class="rounded-md border border-default bg-elevated/30 p-3">
        <h3 class="text-sm font-semibold text-highlighted">Soal's Table I, recomputed</h3>
        <p class="mt-1 text-sm text-muted">
          Soal's pattern counts for offsets −1/0/+1 over
          {{ soalComparisons.toLocaleString('en-US') }} targets, with the same per-pattern variances
          the package reports above.
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Pattern</th>
                <th class="text-right py-1.5 px-3 font-medium">Count</th>
                <th class="text-right py-1.5 px-3 font-medium">Variance</th>
                <th class="text-right py-1.5 pl-3 font-medium">Contribution</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in SOAL_TABLE_I" :key="row.pattern" class="border-t border-default">
                <td class="py-1 pr-3">{{ row.pattern }}</td>
                <td class="py-1 px-3 text-right font-mono tabular-nums">{{ row.count }}</td>
                <td class="py-1 px-3 text-right font-mono tabular-nums text-muted">{{ fmtNum(row.variance, { digits: 4 }) }}</td>
                <td class="py-1 pl-3 text-right font-mono tabular-nums">{{ fmtNum(row.count * row.variance, { digits: 2 }) }}</td>
              </tr>
              <tr class="border-t-2 border-default font-semibold">
                <td class="py-1 pr-3">Total variance</td>
                <td class="py-1 px-3 text-right font-mono tabular-nums">{{ soalComparisons }}</td>
                <td class="py-1 px-3" />
                <td class="py-1 pl-3 text-right font-mono tabular-nums text-highlighted">{{ fmtNum(soalTotal, { digits: 2 }) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-sm text-muted">
          <span class="font-mono text-highlighted">{{ fmtNum(soalTotal, { digits: 2 }) }}</span>
          against the binomial formula 73·4N/25 =
          <span class="font-mono text-warning">934.4</span>: the naive variance is 7 % too large
          here, so in this direction it makes the critical ratio too <em>small</em>. Which way the
          error points depends on the call patterns — that is precisely why it has to be computed.
        </p>
      </div>

      <CodeSnippet v-if="score" :code="code" title="what these controls ran" />

      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact">
          Each offset alone is an exact binomial, because every comparison there uses a different
          target. The pooled tail is the exact convolution of the per-target distributions while the
          work stays inside the package's limit, and it says so
          (<span class="font-mono">pMethod</span>).
        </HonestNote>
        <HonestNote variant="caveat">
          Soal &amp; Goldney's own results were later shown to have been manipulated (Markwick
          1978). The package encodes the design and its null, not his data. And the offsets must be
          fixed before the data are seen: the best of −1/0/+1 has an expectation of 6.74 hits per
          Zener run, not 5 — see the next tab.
        </HonestNote>
      </div>
    </div>

    <template #footer>
      Soal &amp; Goldney (1943) and Soal's reply to Bartlett, <em>Proc. SPR</em> 48; Carington
      (1940) for the diagonal version below.
    </template>
  </DemoSection>
</template>
