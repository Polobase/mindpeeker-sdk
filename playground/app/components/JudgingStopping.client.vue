<script setup lang="ts">
/**
 * Optional stopping: the exact probability that a fixed-level binomial test
 * rejects a true null at *some* look, when the same trials keep accumulating.
 *
 * The growth curve recomputes the exact risk for prefixes of the schedule, so
 * it is chunked with a yielder and a Cancel button.
 */
import type { OptionalStoppingRisk } from '@mindpeeker/judging'
import { optionalStoppingRisk } from '@mindpeeker/judging'
import { createYielder } from '~/lib/async'
import type { RefLine } from '~/lib/chart'
import { fmtNum, fmtP } from '~/lib/format'
import { CHOICE_PRESETS } from '~/lib/judging/presets'

const choices = ref(4)
const alpha = ref(0.05)
const first = ref(10)
const last = ref(200)
const step = ref(1)

const choiceItems = CHOICE_PRESETS.map((preset) => ({ label: preset.label, value: preset.choices }))
const alphaItems = [
  { label: 'α = 0.10', value: 0.1 },
  { label: 'α = 0.05 (default)', value: 0.05 },
  { label: 'α = 0.01', value: 0.01 },
]

const p0 = computed(() => 1 / Math.max(2, Math.trunc(Number(choices.value) || 2)))
const schedule = computed(() => {
  const from = Math.max(1, Math.trunc(Number(first.value) || 1))
  const to = Math.max(from, Math.min(2000, Math.trunc(Number(last.value) || from)))
  const by = Math.max(1, Math.trunc(Number(step.value) || 1))
  const out: number[] = []
  for (let n = from; n <= to; n += by) out.push(n)
  if (!out.length) out.push(from)
  return out
})

const outcome = computed<{ risk?: OptionalStoppingRisk; error?: unknown }>(() => {
  try {
    return {
      risk: optionalStoppingRisk(schedule.value, { p0: p0.value, alpha: Number(alpha.value) }),
    }
  } catch (error) {
    return { error }
  }
})

const risk = computed(() => outcome.value.risk)

/** One look only, at the last n — the level the test claims. */
const singleLook = computed(() => {
  const looks = schedule.value
  const lastLook = looks[looks.length - 1]
  if (lastLook === undefined) return undefined
  try {
    return optionalStoppingRisk([lastLook], { p0: p0.value, alpha: Number(alpha.value) })
  } catch {
    return undefined
  }
})

const growth = useTask<{ x: number[]; y: number[] }>()

function runGrowth(): void {
  void growth.run(async (signal, setProgress) => {
    const looks = schedule.value
    const tick = createYielder(8, signal)
    const points = Math.min(40, looks.length)
    const x: number[] = []
    const y: number[] = []
    for (let i = 0; i < points; i++) {
      const upto = Math.max(1, Math.round(((i + 1) * looks.length) / points))
      const prefix = looks.slice(0, upto)
      const value = optionalStoppingRisk(prefix, { p0: p0.value, alpha: Number(alpha.value) })
      x.push(prefix[prefix.length - 1] as number)
      y.push(value.risk)
      setProgress((i + 1) / points)
      await tick()
    }
    return { x, y }
  })
}

const growthLines = computed<RefLine[]>(() => [
  { value: Number(alpha.value), label: `nominal α = ${alpha.value}`, dashed: false },
])

/** A readable sample of the schedule, whatever its length. */
const tableRows = computed(() => {
  const r = risk.value
  if (!r) return []
  const total = r.looks.length
  const wanted = Math.min(12, total)
  const rows: { n: number; critical: number | null; size: number }[] = []
  for (let i = 0; i < wanted; i++) {
    const index = Math.round((i * (total - 1)) / Math.max(1, wanted - 1))
    rows.push({
      n: r.looks[index] as number,
      critical: r.criticalHits[index] ?? null,
      size: r.lookSizes[index] ?? 0,
    })
  }
  return rows
})

const code = computed(() => {
  const r = risk.value
  if (!r) return ''
  const looks = schedule.value
  return `import { optionalStoppingRisk } from '@mindpeeker/judging'

// checking after every ${step.value === 1 ? 'session' : `${step.value} sessions`} from ${looks[0]} to ${looks[looks.length - 1]}
const looks = [${looks.slice(0, 3).join(', ')}, …, ${looks[looks.length - 1]}]   // ${looks.length} looks
const r = optionalStoppingRisk(looks, { p0: ${fmtNum(r.p0, { digits: 4 })}, alpha: ${r.alpha} })

r.risk            // ${fmtNum(r.risk, { digits: 6 })}   P(some look rejects) under H₀
r.criticalHits[0] // ${String(r.criticalHits[0])}   smallest hit count that rejects at n = ${looks[0]}
r.lookSizes[0]    // ${fmtNum(r.lookSizes[0] ?? 0, { digits: 6 })}   exact size of that single look`
})
</script>

<template>
  <DemoSection
    id="optional-stopping"
    title="Optional stopping — the price of looking"
    :api="['optionalStoppingRisk', 'forcedChoiceBayesFactor']"
    description="A fixed-level exact binomial test applied after every session, with the trials accumulating. A dynamic program carries the probability of paths that have not yet rejected and removes the mass above each look's critical count, so the reported risk is exact to about 1e-14."
  >
    <template #controls>
      <UFormField label="Design" size="sm" class="w-full sm:w-80">
        <USelect v-model="choices" :items="choiceItems" class="w-full" />
      </UFormField>
      <UFormField label="Nominal level at every look" size="sm" class="w-full sm:w-44">
        <USelect v-model="alpha" :items="alphaItems" class="w-full" />
      </UFormField>
      <UFormField label="First look" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="first" :min="1" :max="2000" :step="5" class="w-full" />
      </UFormField>
      <UFormField label="Last look" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="last" :min="1" :max="2000" :step="50" class="w-full" />
      </UFormField>
      <UFormField label="Every" size="sm" class="w-full sm:w-28">
        <UInputNumber v-model="step" :min="1" :max="100" :step="1" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="The schedule was rejected" />

      <div v-if="risk" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Looks" :value="risk.looks.length" :digits="0" :note="`n from ${risk.looks[0]} to ${risk.looks[risk.looks.length - 1]}`" />
        <StatTile label="Chance rate p₀" :value="risk.p0" :digits="4" note="the design's own null" />
        <StatTile
          label="Actual false-positive rate"
          :value="risk.risk"
          :digits="5"
          tone="error"
          :note="`nominal α = ${risk.alpha}`"
        />
        <StatTile
          label="Inflation"
          :value="risk.risk / risk.alpha"
          :digits="2"
          tone="warning"
          note="× the level the test claims"
        />
      </div>

      <p v-if="risk && singleLook" class="text-sm text-muted">
        A single pre-registered look at n =
        <span class="font-mono">{{ risk.looks[risk.looks.length - 1] }}</span> has an exact size of
        <span class="font-mono text-highlighted">{{ fmtNum(singleLook.risk, { digits: 5 }) }}</span>
        — below α, because the binomial is discrete. Checking the same series after every session
        instead pushes the true rate to
        <span class="font-mono text-error">{{ fmtNum(risk.risk, { digits: 5 }) }}</span>. Nothing
        about the data changed; only when you looked.
      </p>

      <div class="flex flex-wrap items-end gap-3">
        <RunControls
          :busy="growth.busy.value"
          :progress="growth.progress.value"
          label="Plot the risk as the looks accumulate"
          busy-label="Recomputing the exact risk…"
          icon="i-lucide-trending-up"
          hint="the exact risk is recomputed for prefixes of your schedule, in chunks"
          @run="runGrowth"
          @cancel="growth.cancel()"
        />
      </div>

      <ErrorAlert :err="growth.error.value" title="The growth curve failed" @dismiss="growth.reset()" />

      <LineChart
        v-if="growth.result.value"
        :series="[{ name: 'P(rejected by this point) under H₀', y: growth.result.value.y, x: growth.result.value.x }]"
        :hlines="growthLines"
        x-label="last look included (trials)"
        y-label="false-positive probability"
        :height="260"
        :format="(v) => fmtNum(v, { digits: 5 })"
        aria-label="Exact false-positive probability against how far the looking has gone, with the nominal level marked"
      />

      <p v-if="growth.result.value" class="text-sm text-muted">
        The curve never comes down. By the law of the iterated logarithm it has no upper bound short
        of 1: keep adding trials and check after each, and a true null is rejected eventually with
        probability one (Robbins 1952). The only question is how long you are willing to look.
      </p>

      <div v-if="risk" class="overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="sr-only">Critical hit count and exact size at a sample of the looks</caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-left py-1.5 pr-3 font-medium">Trials n</th>
              <th class="text-right py-1.5 px-3 font-medium">Rejects at ≥</th>
              <th class="text-right py-1.5 px-3 font-medium">Hits expected</th>
              <th class="text-right py-1.5 pl-3 font-medium">Exact size of that look</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in tableRows" :key="row.n" class="border-t border-default">
              <td class="py-1 pr-3 font-mono tabular-nums">{{ row.n }}</td>
              <td class="py-1 px-3 text-right font-mono tabular-nums">{{ row.critical ?? 'cannot reject' }}</td>
              <td class="py-1 px-3 text-right font-mono tabular-nums text-muted">{{ fmtNum(row.n * p0, { digits: 1 }) }}</td>
              <td class="py-1 pl-3 text-right font-mono tabular-nums">{{ fmtP(row.size) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <CodeSnippet :code="code" title="what these controls ran" />

      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact">
          The default schedule — a ganzfeld series at p₀ = ¼ checked after every session from 10 to
          200 — has an exact false-positive probability of 0.215 at a nominal 0.05. That is the
          package's headline number, and it is a fact about the stopping rule, not about anyone's
          honesty: the same rule applied to a series that stops early "because it is clearly
          working" is worse still.
        </HonestNote>
        <HonestNote variant="caveat" title="What keeps its level under monitoring">
          A Bayes factor with a prior fixed in advance is a test martingale, so stopping when
          BF₁₀ ≥ 1/α keeps the false-alarm rate below α (Shafer et al. 2011) —
          <span class="font-mono">forcedChoiceBayesFactor</span> in the first tab. So do psi's
          e-processes and negentropy's anytime-valid bounds. A repeated p-value is the one thing
          that does not.
        </HonestNote>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton to="/psi?tab=bayes" size="xs" variant="soft" color="neutral" icon="i-lucide-activity">
          Anytime-valid monitoring — psi
        </UButton>
        <UButton to="/negentropy" size="xs" variant="soft" color="neutral" icon="i-lucide-gauge">
          Anytime-valid bounds — negentropy
        </UButton>
      </div>
    </div>

    <template #footer>
      Robbins (1952); Epstein (2009) on "optional stopping"; Shafer, Shen, Vereshchagin &amp; Vovk
      (2011) on test martingales. Raise "Last look" to 500 and press the button again: the risk
      keeps climbing.
    </template>
  </DemoSection>
</template>
