<script setup lang="ts">
/**
 * Section 6b — the GCP archive format: a synthetic basket-data CSV built to
 * the documented record types, parsed by the real parser, editable so the
 * strict checks can be seen failing.
 */
import { type BasketData, GCP_BASKET_FILTER, parseBasketCsv } from '@mindpeeker/psi'
import type { LineSeries } from '~/lib/chart'
import { fmtNum } from '~/lib/format'
import { bytesFor, type SimSource, simBytes, sumsFromBytes } from '~/lib/psi/synthetic'

const BITS = 200
const EGGS = [1, 28, 37, 1000, 1003]
const START = Math.floor(Date.UTC(2026, 8, 17, 12, 0, 0) / 1000)

const seconds = ref(30)
const align = ref<'none' | 'complete'>('none')
const useFilter = ref(true)
const simSource = ref<SimSource>('drbg')
const text = ref('')

const ALIGNS = [
  { label: "none — each egg keeps its own gaps", value: 'none' },
  { label: 'complete — only seconds where every egg reported', value: 'complete' },
]
const SIM_SOURCES: { label: string; value: SimSource }[] = [
  { label: 'seeded DRBG — reproducible', value: 'drbg' },
  { label: 'browser CSPRNG — fresh values', value: 'crypto' },
]

/** `yyyy-mm-dd hh:mm:ss` for a Unix second, UTC — the parser checks this. */
function civil(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

const genTask = useTask<string>()

function generate(): void {
  void genTask.run(async (signal) => {
    const rows = seconds.value
    const bytes = await simBytes(
      bytesFor(rows * EGGS.length, BITS),
      simSource.value,
      'psi basket file',
      signal,
    )
    const sums = sumsFromBytes(bytes, BITS)
    const end = START + rows - 1
    const lines = [
      '10,1,10,"Samples per record"',
      '10,2,10,"Seconds per record"',
      '10,3,6,"Records per packet"',
      `10,4,${BITS},"Trial size"`,
      `11,1,${EGGS.length},"Eggs reporting"`,
      `11,2,${START},"Start time",${civil(START)}`,
      `11,3,${end},"End time",${civil(end)}`,
      `11,4,${rows},"Seconds of data"`,
      `12,"gmtime","Date/Time",${EGGS.join(',')}`,
    ]
    for (let r = 0; r < rows; r++) {
      const values = EGGS.map((_, e) => {
        // Two voids (a missing sample is never 0) and one value the GCP filter excludes.
        if (r === 3 && e === 1) return ''
        if (r === 7 && e === 4) return ''
        if (r === 11 && e === 2) return '150'
        return String(sums[r * EGGS.length + e] ?? 100)
      })
      lines.push(`13,${START + r},${civil(START + r)},${values.join(',')}`)
    }
    const file = lines.join('\n')
    text.value = file
    return file
  })
}

onMounted(() => {
  if (!text.value) generate()
})

const parseTask = useTask<BasketData>()
const data = computed(() => parseTask.result.value)

function parse(): void {
  void parseTask.run(async () =>
    parseBasketCsv(text.value, {
      align: align.value,
      ...(useFilter.value ? {} : { filter: false as const }),
    }),
  )
}

watch(
  () => genTask.result.value,
  (file) => {
    if (file) parse()
  },
)

const chart = computed<{ series: LineSeries[] } | undefined>(() => {
  const d = data.value
  if (!d) return undefined
  return {
    series: d.series.map((s, i) => ({
      name: s.source,
      y: s.sums,
      x: Array.from(s.timestamps ?? [], (t) => (t - START * 1000) / 1000),
      color: i + 1,
    })),
  }
})

const snippet = computed(
  () => `import { analyzeEvent, parseBasketCsv } from '@mindpeeker/psi'

const response = await fetch(basketUrl)   // …/eggsummary/2015/basketdata-2015-01-01.csv.gz
const text = response.body
  .pipeThrough(new DecompressionStream('gzip'))
  .pipeThrough(new TextDecoderStream())

const day = await parseBasketCsv(text, { eggs: [${EGGS.slice(0, 3).join(', ')}], align: '${align.value}'${
    useFilter.value ? '' : ', filter: false'
  } })
console.log(day.protocol.trialSize, day.missing, day.filtered)
const event = analyzeEvent(day.series, { startMs, endMs }, { alignment: 'round' })`,
)
</script>

<template>
  <DemoSection
    id="record-basket"
    title="2 · GCP basket-data CSV"
    description="The Global Consciousness Project's daily archive files, read exactly as the project documents them: record types 10, 11, 12 and 13, a void field meaning a missing sample (never 0), and one row for every second."
    :api="['parseBasketCsv', 'GCP_BASKET_FILTER', 'BasketData', 'ParseBasketOptions']"
  >
    <template #controls>
      <UButton
        icon="i-lucide-refresh-cw"
        :loading="genTask.busy.value"
        color="neutral"
        variant="soft"
        @click="generate"
      >
        Regenerate the file
      </UButton>
      <UButton icon="i-lucide-file-search" :loading="parseTask.busy.value" @click="parse">
        Parse it
      </UButton>
      <UFormField label="Seconds of data">
        <UInputNumber v-model="seconds" :min="12" :max="300" :step="6" class="w-32" />
      </UFormField>
      <UFormField label="Alignment" class="min-w-64">
        <USelect v-model="align" :items="ALIGNS" class="w-full" />
      </UFormField>
      <UFormField label="Values" class="min-w-56">
        <USelect v-model="simSource" :items="SIM_SOURCES" class="w-full" />
      </UFormField>
      <USwitch
        v-model="useFilter"
        :label="`GCP filter ${GCP_BASKET_FILTER.min}–${GCP_BASKET_FILTER.max}`"
        description="the project's own exclusion for 200-bit files"
      />
    </template>

    <div class="flex flex-col gap-4">
      <UFormField
        label="basketdata CSV (editable — break a line and watch the parser name it)"
        help="one row per second, contiguous; civil times must match their Unix times"
      >
        <UTextarea v-model="text" :rows="8" class="w-full font-mono text-xs" spellcheck="false" />
      </UFormField>

      <ErrorAlert :err="genTask.error.value" @dismiss="genTask.reset()" />
      <ErrorAlert
        :err="parseTask.error.value"
        title="parseBasketCsv rejected this file"
        @dismiss="parseTask.reset()"
      />

      <div v-if="data" class="flex flex-col gap-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="protocol"
            :value="`${data.protocol.trialSize}-bit trials`"
            size="sm"
            :note="`${data.protocol.samplesPerRecord} samples/record · ${data.protocol.secondsPerRecord} s/record · ${data.protocol.recordsPerPacket} records/packet`"
          />
          <StatTile
            label="content"
            :value="`${data.seconds} s · ${data.eggsReporting} eggs`"
            size="sm"
            :note="`${new Date(data.startMs).toISOString().slice(0, 19).replace('T', ' ')} → ${new Date(data.endMs).toISOString().slice(0, 19).replace('T', ' ')} UTC`"
          />
          <StatTile
            label="missing samples"
            :value="data.missing.join(', ')"
            size="sm"
            mono
            note="per egg — a void field, never a zero"
          />
          <StatTile
            label="filtered values"
            :value="data.filtered.join(', ')"
            size="sm"
            mono
            :note="data.filter ? `outside ${data.filter.min}–${data.filter.max}` : 'no filter applied'"
          />
        </div>

        <div class="text-xs text-muted">
          Series: {{ data.series.map((s) => `${s.source} (${s.sums.length})`).join(' · ') }}
          <template v-if="align === 'complete'">
            — aligned to the seconds every egg reported, so the series are step-aligned for
            <code class="font-mono">analyzeEvent</code>.
          </template>
        </div>

        <LineChart
          v-if="chart"
          :series="chart.series"
          :hlines="[
            { value: 100, label: 'chance mean (k/2)', dashed: false },
            { value: GCP_BASKET_FILTER.min, label: `filter ${GCP_BASKET_FILTER.min}` },
            { value: GCP_BASKET_FILTER.max, label: `filter ${GCP_BASKET_FILTER.max}` },
          ]"
          x-label="second of the file"
          y-label="one-bits in the second's 200-bit trial"
          :height="240"
          :format="(v) => fmtNum(v, { digits: 0 })"
          aria-label="each egg's trial values across the file's seconds"
        />

        <CodeSnippet :code="snippet" title="reading a real archive day" />
      </div>
    </div>

    <HonestNote variant="caveat">
      The parser is strict on purpose: contiguous one-per-second rows, civil times that match their
      Unix times, one value per egg column, values in [0, trial size], and a row count equal to
      "seconds of data" — so a truncated download is an error rather than a quietly shorter day.
      The GCP's own exclusion of values outside 55–145 is applied to 200-bit files by default; it
      removes about 6.4σ outliers, and turning it off changes every statistic downstream.
    </HonestNote>

    <template #footer>
      This file is synthetic, generated in your browser from a local source. Real days live at
      global-mind.org as gzipped <code class="font-mono">eggsummary</code> files; the snippet above
      is the browser-native way to stream one.
    </template>
  </DemoSection>
</template>
