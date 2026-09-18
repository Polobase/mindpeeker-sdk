<script setup lang="ts">
/**
 * Section 2 — Besag's L̂(r) − r against simulated CSR fields: the pointwise
 * band (one radius, fixed in advance) next to the two global tests that are
 * valid across all radii at once.
 */
import type { KCorrection, KDenominator } from '@mindpeeker/field'
import type { ChartBand, LineSeries } from '~/lib/chart'
import type { EnvelopeResult } from '~/lib/field/jobs'
import { useFieldLab } from '~/lib/field/lab'
import { DEFAULT_RADII, FINE_RADII, nullBytesNeeded } from '~/lib/field/types'
import { runFieldJob } from '~/lib/field/worker-client'
import { fmtBytes, fmtDuration, fmtNum } from '~/lib/format'

const { field, drawNullBytes } = useFieldLab()
const task = useTask<EnvelopeResult>()

const RUNS = [99, 199, 499, 999].map((r) => ({ label: `${r} runs`, value: r }))
const RADII = [
  { label: 'r = 2, 4, 6, 8, 10, 14 (the cookbook set)', value: 'default' as const },
  { label: 'r = 1 … 18, twelve radii', value: 'fine' as const },
]
const CORRECTIONS = [
  { label: "none — 0.1's ripleyL", value: 'none' as KCorrection },
  { label: 'border (reduced sample)', value: 'border' as KCorrection },
  { label: 'isotropic (Ripley 1977)', value: 'isotropic' as KCorrection },
  { label: 'translation (Ohser 1983)', value: 'translation' as KCorrection },
]
const DENOMINATORS = [
  { label: "A / n²  — 0.1's ripleyL", value: 'n2' as KDenominator },
  { label: "A / n(n−1)  — spatstat's Kest", value: 'n(n-1)' as KDenominator },
]

const ALPHAS = [0.05, 0.1, 0.2].map((a) => ({ label: `α = ${a.toFixed(2)}`, value: a }))

const runs = ref(99)
const radiiSet = ref<'default' | 'fine'>('default')
const correction = ref<KCorrection>('none')
const denominator = ref<KDenominator>('n2')
const alpha = ref(0.05)

const radii = computed(() => (radiiSet.value === 'fine' ? FINE_RADII : DEFAULT_RADII))
const bytes = computed(() => nullBytesNeeded(runs.value, field.value?.points.length ?? 0))

const stamp = computed(() => {
  const f = field.value
  if (!f) return ''
  return `${f.serial}:${radiiSet.value}:${correction.value}:${denominator.value}:${alpha.value}`
})
const measured = ref('')
const fresh = computed(() => task.result.value !== undefined && measured.value === stamp.value)
const env = computed(() => (fresh.value ? task.result.value : undefined))

const series = computed<LineSeries[]>(() => {
  const e = env.value
  if (!e) return []
  return [
    { name: 'observed L̂(r) − r', y: e.observed, x: e.radii, color: 1, width: 2.5 },
    { name: 'mean of the simulations', y: e.mean, x: e.radii, color: 'muted', dashed: true },
  ]
})

const bands = computed<ChartBand[]>(() => {
  const e = env.value
  if (!e) return []
  const out: ChartBand[] = [
    { lo: e.lo, hi: e.hi, x: e.radii, label: `pointwise min/max of ${e.runs} CSR fields`, color: 4 },
  ]
  if (e.globalLower && e.globalUpper) {
    out.push({
      lo: e.globalLower,
      hi: e.globalUpper,
      x: e.radii,
      label: `${Math.round((1 - e.alpha) * 100)} % global rank envelope`,
      color: 1,
    })
  }
  return out
})

const minPointwise = computed(() => {
  const e = env.value
  if (!e) return undefined
  let best = 1
  for (const p of e.pointwiseP) best = Math.min(best, p)
  return best
})

const crossings = computed(() => {
  const e = env.value
  if (!e) return 0
  let out = 0
  for (let i = 0; i < e.observed.length; i++) {
    const v = e.observed[i] as number
    if (v < (e.lo[i] as number) || v > (e.hi[i] as number)) out++
  }
  return out
})

async function run(): Promise<void> {
  const f = field.value
  if (!f) return
  const at = stamp.value
  await task.run(async (signal, setProgress) => {
    setProgress(null)
    const nulls = await drawNullBytes(runs.value, f.points.length, signal)
    const out = await runFieldJob(
      'envelope',
      {
        points: f.points,
        region: f.region,
        runs: runs.value,
        radii: [...radii.value],
        correction: correction.value,
        denominator: denominator.value,
        alpha: alpha.value,
        bytes: nulls.bytes,
      },
      signal,
    )
    measured.value = at
    return out
  })
}

const snippet = computed(
  () => `import { csrEnvelope } from '@mindpeeker/field'

const radii = [${radii.value.join(', ')}]   // registered BEFORE the field is drawn
const env = await csrEnvelope(points, reader, region, radii, {
  runs: ${runs.value},
  correction: '${correction.value}',
  denominator: '${denominator.value}',
  alpha: ${alpha.value},
})

env.pointwiseP            // per radius — valid only for a radius fixed in advance
env.global.p              // one p over all radii (extreme-rank envelope, ERL ties)
env.global.rank.pInterval // [p−, p+] when extreme ranks tie
env.global.mad.p          // maximum-absolute-deviation test`,
)
</script>

<template>
  <DemoSection
    id="envelope"
    title="2 · Envelopes — pointwise band vs global test"
    description="L̂(r) − r is ≈ 0 under CSR, positive where the field clusters. The band is the pointwise minimum and maximum of the simulated curves; reading it across radii is a multiple test, which is exactly what the two global p-values fix."
    :api="['csrEnvelope', 'CsrEnvelopeTest', 'RankEnvelopeTest', 'MadTest']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!field"
        :label="`Simulate ${runs} fields`"
        busy-label="Simulating…"
        icon="i-lucide-waves"
        :hint="`${fmtBytes(bytes)} of null-field bytes · ${radii.length} radii · Myllymäki et al. recommend ≥ 2499 runs for a stable global envelope at α = 0.05`"
        @run="run"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UFormField label="Simulated CSR fields" size="sm">
        <USelect v-model="runs" :items="RUNS" class="w-full" />
      </UFormField>
      <UFormField label="Radii (fixed in advance)" size="sm">
        <USelect v-model="radiiSet" :items="RADII" class="w-full" />
      </UFormField>
      <UFormField label="Edge correction" size="sm">
        <USelect v-model="correction" :items="CORRECTIONS" class="w-full" />
      </UFormField>
      <UFormField label="K normalisation" size="sm">
        <USelect v-model="denominator" :items="DENOMINATORS" class="w-full" />
      </UFormField>
      <UFormField label="Global envelope level α" size="sm" description="band only; the ERL p does not depend on it">
        <USelect v-model="alpha" :items="ALPHAS" class="w-full" />
      </UFormField>
    </div>

    <div v-if="env" class="mt-4 flex flex-col gap-4">
      <LineChart
        :series="series"
        :bands="bands"
        :hlines="[{ value: 0, label: 'CSR', color: 'axis' }]"
        x-label="radius r"
        y-label="L̂(r) − r"
        :height="300"
        aria-label="Centered L function of the observed field against the simulated envelope"
      />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Global rank test (ERL)" tone="primary" size="sm">
          <template #value><PValue :p="env.globalP" kind="family-wise" label="p" /></template>
          <template #note>
            one p over all {{ env.radii.length }} radii · extreme rank {{ env.globalRank }} ·
            interval [{{ fmtNum(env.globalInterval[0], { digits: 4 }) }},
            {{ fmtNum(env.globalInterval[1], { digits: 4 }) }}]
          </template>
        </StatTile>
        <StatTile label="MAD test" size="sm">
          <template #value><PValue :p="env.madP" kind="family-wise" label="p" /></template>
          <template #note>T₁ = max |c₁(r) − c̄(r)| = {{ fmtNum(env.madStatistic, { digits: 3 }) }}</template>
        </StatTile>
        <StatTile label="Smallest pointwise p" size="sm" tone="warning">
          <template #value><PValue :p="minPointwise" kind="pointwise" label="p" /></template>
          <template #note>only valid for a radius chosen before the draw</template>
        </StatTile>
        <StatTile
          label="Radii outside the band"
          :value="crossings"
          :digits="0"
          size="sm"
          :note="`of ${env.radii.length} · ≈ 14 % of CSR fields leave the band somewhere`"
        />
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="sr-only">Pointwise Monte-Carlo p per radius</caption>
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" class="py-1 pr-3 font-medium">radius r</th>
              <th scope="col" class="py-1 pr-3 font-medium">L̂(r) − r</th>
              <th scope="col" class="py-1 pr-3 font-medium">band lo … hi</th>
              <th scope="col" class="py-1 font-medium">pointwise p</th>
            </tr>
          </thead>
          <tbody class="font-mono tabular-nums">
            <tr v-for="(r, i) in env.radii" :key="i" class="border-t border-default">
              <td class="py-1 pr-3">{{ fmtNum(r, { digits: 1 }) }}</td>
              <td class="py-1 pr-3" :class="(env.observed[i] ?? 0) > 0 ? 'text-warning' : ''">
                {{ fmtNum(env.observed[i], { digits: 3 }) }}
              </td>
              <td class="py-1 pr-3 text-muted">
                {{ fmtNum(env.lo[i], { digits: 2 }) }} … {{ fmtNum(env.hi[i], { digits: 2 }) }}
              </td>
              <td class="py-1"><PValue :p="env.pointwiseP[i]" kind="pointwise" :show-kind="false" /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
        <AccountingBadge
          :bytes-consumed="env.accounting.bytesConsumed"
          :bits-used="env.accounting.bitsUsed"
          :source="`${env.runs} simulated fields · ${env.correction} / ${env.denominator}`"
        />
        <span>{{ fmtDuration(env.elapsedMs) }} in a Web Worker</span>
      </div>
    </div>

    <UAlert
      v-if="task.result.value && !fresh"
      color="neutral"
      variant="subtle"
      icon="i-lucide-refresh-cw"
      title="That envelope belongs to an earlier field or estimator"
      description="Radii, correction and normalisation are part of the registered test. Run it again for the field on the canvas."
      class="mt-4"
    />

    <HonestNote variant="caveat" title="A pointwise band is a test at one radius">
      Over 1000 CSR fields (n = 50, 39 runs, six radii) the observed curve left the band at a
      <strong>pre-chosen</strong> radius in 4.7 % of fields — but at <strong>some</strong> radius in
      14.2 %. The extreme-rank envelope rejected in 4.5 % and MAD in 3.1 %. Read the table as a
      description; report the global p.
    </HonestNote>

    <HonestNote variant="fixed-in-0.2" title="Replay protection">
      If a simulated field equals the observed one — the field came from the same recorded batch, or
      from a source whose <code class="font-mono">stream()</code> restarts — the test would have no
      power, so <code class="font-mono">csrEnvelope</code>,
      <code class="font-mono">fieldSignificance</code>, <code class="font-mono">kdeSignificance</code>
      and <code class="font-mono">scanStatistic</code> throw
      <code class="font-mono">FieldError('invalid_config')</code> instead of returning a p. This page
      always draws the null-field bytes separately from the field's own, so the guard stays quiet;
      an error alert here means it fired.
    </HonestNote>

    <CodeSnippet class="mt-4" :code="snippet" title="what this section ran" />

    <template #footer>
      0.1's <code class="font-mono">csrEnvelope(source, count, region, radii, runs)</code> is still
      accepted and still returns a band — it is deprecated because it has no observed curve, so it
      can compute no p and cannot detect a replayed field.
    </template>
  </DemoSection>
</template>
