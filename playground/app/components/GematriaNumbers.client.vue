<script setup lang="ts">
/**
 * `numberProperties(n)` — the exact arithmetic portrait of a value: digit sum,
 * digital root, primality, factorization, triangular / square / perfect flags.
 *
 * Small numbers are portrayed live; anything above a million goes to a Web
 * Worker, because the factorization is a √n trial-division sweep (a 15-digit
 * prime costs ~750 ms — a keystroke must not pay that).
 */
import type { NumberProperties } from '@mindpeeker/gematria'
import { MAX_NUMBER, numberProperties, toHebrewNumeral, value } from '@mindpeeker/gematria'
import type { NumbersResponse } from '~/workers/gematria-numbers.worker'
import { famousNumbers } from '~/lib/gematria/lexicon'
import { calc, numberState } from '~/lib/gematria/state'
import { fmtNum } from '~/lib/format'

/** Above this the sweep is long enough to need the worker. */
const LIVE_LIMIT = 1_000_000

const FAMOUS = famousNumbers()

const worker = shallowRef<Worker>()
const workerResult = shallowRef<NumberProperties>()
const workerMs = ref(0)
const task = useTask<NumberProperties>()
let nextId = 1
const pending = new Map<number, { resolve: (p: NumberProperties) => void; reject: (e: unknown) => void }>()

onMounted(() => {
  const instance = new Worker(new URL('../workers/gematria-numbers.worker.ts', import.meta.url), {
    type: 'module',
  })
  instance.onmessage = (event: MessageEvent<NumbersResponse>) => {
    const entry = pending.get(event.data.id)
    if (!entry) return
    pending.delete(event.data.id)
    workerMs.value = event.data.ms
    if (event.data.error) entry.reject(event.data.error)
    else entry.resolve(event.data.result as NumberProperties)
  }
  worker.value = instance
})

onUnmounted(() => {
  worker.value?.terminate()
  pending.clear()
})

const n = computed(() => Math.trunc(numberState.n || 0))
const live = computed(() => n.value >= 0 && n.value <= LIVE_LIMIT)

/** The instant path: exact and sub-millisecond for anything under a million. */
const liveOutcome = computed<{ result?: NumberProperties; error?: unknown }>(() => {
  if (!live.value) return {}
  try {
    return { result: numberProperties(n.value) }
  } catch (error) {
    return { error }
  }
})

const result = computed(() => (live.value ? liveOutcome.value.result : workerResult.value))
const error = computed(() => (live.value ? liveOutcome.value.error : task.error.value))

function portrait(): void {
  const target = n.value
  const instance = worker.value
  if (!instance) return
  void task.run(async (signal) => {
    const id = nextId++
    const promise = new Promise<NumberProperties>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      signal.addEventListener(
        'abort',
        () => {
          pending.delete(id)
          reject(signal.reason)
        },
        { once: true },
      )
    })
    instance.postMessage({ id, n: target })
    const portraitResult = await promise
    workerResult.value = portraitResult
    return portraitResult
  })
}

// A number typed into the worker range invalidates the previous portrait, so a
// stale factorization can never sit under a new number.
watch(n, () => {
  if (!live.value && workerResult.value?.value !== n.value) workerResult.value = undefined
})

const factorization = computed(() =>
  (result.value?.factorization ?? [])
    .map((f) => (f.exponent === 1 ? `${f.prime}` : `${f.prime}^${f.exponent}`))
    .join(' · '),
)

const numeral = computed(() => {
  const target = n.value
  if (target < 1 || target > 999_999) return undefined
  try {
    return toHebrewNumeral(target)
  } catch {
    return undefined
  }
})

const famousNote = computed(() => FAMOUS.find((f) => f.value === n.value)?.note)

const calcValue = computed(() => {
  try {
    return value(calc.text, calc.cipher, calc.reverse)
  } catch {
    return undefined
  }
})

const code = computed(
  () => `import { numberProperties, MAX_NUMBER } from '@mindpeeker/gematria'

numberProperties(${n.value})
// {
//   digitSum: ${result.value?.digitSum ?? '…'}, digitalRoot: ${result.value?.digitalRoot ?? '…'},
//   isPrime: ${result.value?.isPrime ?? '…'}, factorization: [${(result.value?.factorization ?? [])
    .map((f) => `{ prime: ${f.prime}, exponent: ${f.exponent} }`)
    .join(', ')}],
//   isTriangular: ${result.value?.isTriangular ?? '…'}${
    result.value?.isTriangular ? `, triangularIndex: ${result.value.triangularIndex}` : ''
  }, isSquare: ${result.value?.isSquare ?? '…'}, isPerfect: ${result.value?.isPerfect ?? '…'}
// }
MAX_NUMBER // ${MAX_NUMBER} = 2^48 — the domain bound, checked before any work`,
)
</script>

<template>
  <DemoSection
    id="numbers"
    title="Number lore"
    :api="['numberProperties', 'MAX_NUMBER', 'toHebrewNumeral', 'value']"
    description="What a total is as an integer, independent of any word: its digit sum and digital root, whether it is prime, its factorization, and whether it is triangular, square or perfect. Every field is exact arithmetic on [0, 2⁴⁸]."
  >
    <template #controls>
      <UFormField label="Number" size="sm" class="w-full sm:w-64">
        <UInputNumber v-model="numberState.n" :min="0" :max="MAX_NUMBER" :step="1" class="w-full" />
      </UFormField>
      <RunControls
        v-if="!live"
        :busy="task.busy.value"
        label="Portrait it"
        busy-label="Factoring…"
        icon="i-lucide-sigma"
        hint="a √n sweep in a Web Worker"
        @run="portrait"
        @cancel="task.cancel()"
      />
      <UButton
        v-if="calcValue !== undefined && calcValue !== n"
        size="sm"
        variant="soft"
        color="neutral"
        icon="i-lucide-import"
        @click="numberState.n = calcValue"
      >
        Use the calculator's {{ fmtNum(calcValue, { digits: 0 }) }}
      </UButton>
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs uppercase tracking-wide text-muted mr-1">Famous</span>
        <UButton
          v-for="row in FAMOUS"
          :key="row.value"
          size="xs"
          variant="soft"
          color="neutral"
          :title="row.note"
          @click="numberState.n = row.value"
        >
          {{ row.value }}
        </UButton>
        <UButton size="xs" variant="soft" color="neutral" title="the fourth perfect number" @click="numberState.n = 8128">
          8128
        </UButton>
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          title="a 15-digit prime — this one needs the worker"
          @click="numberState.n = 281474976710597"
        >
          281 474 976 710 597
        </UButton>
      </div>

      <ErrorAlert :err="error" title="numberProperties rejected that number" @dismiss="task.reset()" />

      <p v-if="!live && !result && !task.busy.value" class="text-sm text-muted">
        {{ fmtNum(n, { digits: 0 }) }} is above the million-line, so the factorization sweep runs in
        a Web Worker — press <strong>Portrait it</strong>. Nothing on this page blocks the main
        thread for more than a frame.
      </p>

      <template v-if="result">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Value" :value="result.value" :digits="0" tone="primary" :note="numeral ? `Hebrew numeral ${numeral}` : 'above 999 999 — no numeral'" />
          <StatTile label="Digit sum" :value="result.digitSum" :digits="0" note="a single pass, not reduced" />
          <StatTile label="Digital root" :value="result.digitalRoot" :digits="0" note="repeated digit sum" />
          <StatTile
            label="Prime?"
            :value="result.isPrime ? 'prime' : 'composite'"
            :mono="false"
            :tone="result.isPrime ? 'success' : 'neutral'"
            :note="result.value < 2 ? 'neither prime nor composite' : 'by full factorization'"
          />
        </div>

        <div class="rounded-md border border-default bg-elevated/40 p-3 flex flex-col gap-2">
          <p class="text-xs uppercase tracking-wide text-muted">Factorization</p>
          <p class="font-mono text-base text-highlighted">
            {{ factorization || (result.value < 2 ? 'none — 0 and 1 have no prime factors' : '—') }}
          </p>
          <div class="flex flex-wrap gap-1.5">
            <UBadge v-if="result.isTriangular" color="info" variant="subtle">
              triangular — T({{ result.triangularIndex }}) = 1 + 2 + … + {{ result.triangularIndex }}
            </UBadge>
            <UBadge v-if="result.isSquare" color="info" variant="subtle">
              perfect square — {{ Math.round(Math.sqrt(result.value)) }}²
            </UBadge>
            <UBadge v-if="result.isPerfect" color="warning" variant="subtle">
              perfect number — equal to the sum of its proper divisors
            </UBadge>
            <UBadge v-if="!result.isTriangular && !result.isSquare && !result.isPerfect" color="neutral" variant="subtle">
              no figurate property
            </UBadge>
          </div>
          <p v-if="!live" class="text-xs text-dimmed">
            The sweep took {{ fmtNum(workerMs, { digits: 0 }) }} ms in the worker.
          </p>
        </div>

        <p v-if="famousNote" class="text-sm text-muted">
          <UIcon name="i-lucide-bookmark" class="size-4 align-middle text-primary" />
          {{ famousNote }}
        </p>
      </template>

      <CodeSnippet :code="code" title="what this section ran" />

      <HonestNote variant="caveat" title="Arithmetic facts, not meanings">
        That 666 is the 36th triangular number and factors as 2 · 3² · 37 is exact and
        uncontested. That any of this is <em>about</em> anything is tradition. The package attaches
        the portrait to a value because the arithmetic is cheap and checkable — not because a
        figurate property is evidence of a reading.
      </HonestNote>
    </div>

    <template #footer>
      Domain: integers in [0, 2⁴⁸] (<code class="font-mono">MAX_NUMBER</code>), the largest range
      <code class="font-mono">@mindpeeker/oracle</code> draws uniformly. Below 2⁵³ every intermediate
      — digit sums, 1 + 8n, σ(n) &lt; 7n — is an exact float64 integer, so no result here is
      rounded. 0.2.0 added that bound: above 2⁵³ the old code returned wrong digit sums and could
      sweep for minutes.
    </template>
  </DemoSection>
</template>
