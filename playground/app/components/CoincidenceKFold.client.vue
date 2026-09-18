<script setup lang="ts">
/**
 * k-fold matches: the chance that some category receives at least k of n draws.
 *
 * Both exact engines (the conditional-binomial DP and Levin's truncated-Poisson
 * representation) are synchronous and can cost seconds, so every exact call on
 * this tab runs in `app/workers/coincidence-exact.worker.ts`.
 */
import { KWAY_WORK_LIMIT } from '@mindpeeker/coincidence'
import { type InvertResult, kWayInvert, kWayPoint, type PointResult } from '~/lib/coincidence/exact-client'
import { CATEGORY_PRESETS, categoryPreset } from '~/lib/coincidence/presets'
import { fmtNum } from '~/lib/format'

const c = ref(365)
const n = ref(88)
const k = ref(3)
const target = ref(50)
const presetId = ref('days')

const presetItems = computed(() => [
  ...CATEGORY_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
  { label: 'Custom — type a number of categories', value: 'custom' },
])

watch(presetId, (id) => {
  const preset = categoryPreset(id)
  if (preset) c.value = preset.c
})
watch(c, (value) => {
  if (categoryPreset(presetId.value)?.c !== value) presetId.value = 'custom'
})

const safeC = computed(() => Math.max(1, Math.trunc(Number(c.value) || 1)))
const safeN = computed(() => Math.max(0, Math.trunc(Number(n.value) || 0)))
const safeK = computed(() => Math.max(1, Math.trunc(Number(k.value) || 1)))
const p = computed(() => Math.min(0.999, Math.max(0.001, (Number(target.value) || 50) / 100)))

const pointTask = useTask<PointResult>()
const invertTask = useTask<InvertResult>()

const point = computed(() => pointTask.result.value)
const invert = computed(() => invertTask.result.value)

function compute(): void {
  const args = { c: safeC.value, n: safeN.value, k: safeK.value, p: p.value }
  void pointTask.run(async (signal, setProgress) => {
    setProgress(null)
    return await kWayPoint(args.n, args.c, args.k, { signal })
  })
  void invertTask.run(async (signal, setProgress) => {
    setProgress(null)
    return await kWayInvert(args.p, args.c, args.k, { signal })
  })
}

function cancel(): void {
  pointTask.cancel()
  invertTask.cancel()
}

function resetAll(): void {
  pointTask.reset()
  invertTask.reset()
}

function loadDayOfMonth(): void {
  presetId.value = 'custom'
  c.value = 30
  k.value = 3
  n.value = 18
  target.value = 50
  compute()
}

function loadTriple(): void {
  presetId.value = 'days'
  c.value = 365
  k.value = 3
  n.value = 88
  target.value = 50
  compute()
}

onMounted(compute)

const busy = computed(() => pointTask.busy.value || invertTask.busy.value)

const code = computed(
  () => `import {
  kWayProbabilities, kWayMatchApprox,
  peopleForKWayMatch, peopleForKWayMatchApprox,
} from '@mindpeeker/coincidence'

kWayProbabilities(${safeN.value}, ${safeC.value}, ${safeK.value})
// { match: ${point.value ? fmtNum(point.value.match, { digits: 8 }) : '…'}, noMatch: ${point.value ? fmtNum(point.value.noMatch, { digits: 8 }) : '…'}, method: '${point.value?.method ?? '…'}' }

kWayMatchApprox(${safeN.value}, ${safeC.value}, ${safeK.value})          // ${point.value?.approx === null || point.value?.approx === undefined ? '…' : fmtNum(point.value.approx, { digits: 8 })}
peopleForKWayMatch(${fmtNum(p.value, { digits: 2 })}, ${safeC.value}, ${safeK.value})       // ${invert.value?.n ?? '…'}
peopleForKWayMatchApprox(${fmtNum(p.value, { digits: 2 })}, ${safeC.value}, ${safeK.value}) // ${invert.value?.approxN === null || invert.value?.approxN === undefined ? '…' : fmtNum(invert.value.approxN, { digits: 4 })}`,
)
</script>

<template>
  <DemoSection
    id="kfold"
    title="k-fold matches — three people sharing a birthday"
    :api="['kWayProbabilities', 'kWayMatch', 'kWayNoMatch', 'kWayMatchApprox', 'peopleForKWayMatch', 'peopleForKWayMatchApprox']"
    description="P(some category receives at least k of n draws). k = 2 is the birthday problem; k = 3 needs 88 people, not 23·something. Two exact algorithms are picked by cost, and `method` always says which ran."
  >
    <template #controls>
      <UFormField label="Categories" size="sm" class="w-full sm:w-72">
        <USelect v-model="presetId" :items="presetItems" class="w-full" />
      </UFormField>
      <UFormField label="c — categories" size="sm" class="w-full sm:w-40">
        <UInputNumber v-model="c" :min="1" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="n — draws" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="n" :min="0" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="k — fold size" size="sm" class="w-full sm:w-28">
        <UInputNumber v-model="k" :min="1" :max="40" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Target p (%)" size="sm" class="w-full sm:w-32">
        <UInputNumber v-model="target" :min="1" :max="99" :step="5" class="w-full" />
      </UFormField>
      <RunControls
        :busy="busy"
        label="Compute exactly"
        busy-label="Running the engine…"
        icon="i-lucide-sigma"
        hint="in a Web Worker"
        @run="compute"
        @cancel="cancel"
      >
        <UButton size="sm" variant="soft" color="neutral" @click="loadTriple">
          88 people, a triple birthday
        </UButton>
        <UButton size="sm" variant="soft" color="neutral" @click="loadDayOfMonth">
          D–M day-of-month example
        </UButton>
      </RunControls>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert
        :err="pointTask.error.value ?? invertTask.error.value"
        title="The k-fold engine refused"
        @dismiss="resetAll"
      />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="P(some category gets ≥ k)"
          :value="point?.match ?? null"
          :digits="6"
          tone="primary"
          :note="`${safeN} draws, ${fmtNum(safeC, { digits: 0 })} categories, k = ${safeK}`"
        />
        <StatTile label="P(no category gets k)" :value="point?.noMatch ?? null" :digits="6" note="the exact complement" />
        <StatTile
          label="Diaconis–Mosteller approximation"
          :value="point?.approx ?? null"
          :digits="6"
          tone="info"
          note="kWayMatchApprox — c × Poisson tail, their eq. 7.5"
        />
        <StatTile
          label="Exact − approximation"
          :value="point && point.approx !== null ? point.match - point.approx : null"
          :digits="6"
          note="how much the closed form is off by here"
        />
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <div class="text-[11px] uppercase tracking-wide text-muted">
            Draws for P(k-fold match) ≥ {{ fmtNum(p, { digits: 2 }) }}
          </div>
          <p class="mt-1 text-sm">
            <span class="font-mono text-xl text-highlighted">{{ invert?.n ?? '—' }}</span>
            exact, reached at P =
            <span class="font-mono">{{ invert ? fmtNum(invert.match, { digits: 6 }) : '—' }}</span>.
            The root of D–M eq. 7.5 is
            <span class="font-mono">{{
              invert?.approxN === null || invert?.approxN === undefined ? '—' : fmtNum(invert.approxN, { digits: 3 })
            }}</span>.
          </p>
        </div>
        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <div class="text-[11px] uppercase tracking-wide text-muted">Which engine ran</div>
          <p class="mt-1 text-sm">
            <UBadge color="neutral" variant="subtle" class="font-mono">{{ point?.method ?? '—' }}</UBadge>
            <span v-if="point?.method === 'dp'" class="ml-2 text-muted">
              conditional-binomial dynamic programme — both tails at full relative precision, cost
              ≈ categories × n × k.
            </span>
            <span v-else-if="point?.method === 'levin'" class="ml-2 text-muted">
              Levin's (1981) truncated-Poisson representation by repeated squaring — cost ≈ n²·log₂c,
              so c = 10⁶ is reachable.
            </span>
            <span v-if="point" class="ml-2 text-dimmed">({{ fmtNum(point.ms, { digits: 0 }) }} ms)</span>
          </p>
        </div>
      </div>

      <CodeSnippet :code="code" title="what this section ran" />

      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact">
          Both engines are exact up to floating-point rounding, and `method` is part of the result
          so nothing is silently approximated. Diaconis &amp; Mosteller's day-of-month example
          (c = 30, k = 3, p = ½) is the pinned check: their eq. 7.5 gives 17.96 and the exact answer
          is 18.
        </HonestNote>
        <HonestNote variant="caveat" title="Where `levin` loses digits">
          Levin's representation accumulates rounding with the number of categories: `noMatch` has
          relative error about c·10⁻¹⁶ (≈ 1.2·10⁻¹⁰ at c = 10⁶), and `match = 1 − noMatch` carries
          it as <em>absolute</em> error — so a very small `match` from the `levin` path has few
          significant digits. The `dp` path does not have this problem. Beyond
          {{ fmtNum(KWAY_WORK_LIMIT, { digits: 0 }) }} units of work neither runs and the SDK throws
          `too_large` instead of guessing.
        </HonestNote>
      </div>
    </div>

    <template #footer>
      Diaconis &amp; Mosteller (1989), Problem 3 and eq. 7.5; B. Levin,
      <em>A Representation for Multinomial Cumulative Distribution Functions</em>, Annals of
      Statistics 9 (1981).
    </template>
  </DemoSection>
</template>
