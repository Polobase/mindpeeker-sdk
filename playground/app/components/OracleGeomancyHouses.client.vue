<script setup lang="ts">
/**
 * Geomancy — the twelve houses under both documented placements, and the
 * public-domain worked chart of *Liber XCVI* as an end-to-end test vector.
 */
import type { ShieldCast } from '@mindpeeker/oracle'
import { castShield, HOUSE_SYSTEMS, houses, partOfFortune, reconciler } from '@mindpeeker/oracle'
import { toHex } from '~/lib/format'
import { sourceSummary, withReader } from '~/lib/entropy'

/** Crowley's own worked example (Liber XCVI, 1909, ch. II) is these two bytes. */
const LIBER_BYTES = new Uint8Array([0xca, 0x34])

const EXPECTED = {
  mothers: ['Fortuna Minor', 'Amissio', 'Fortuna Major', 'Rubeus'],
  nephews: ['Conjunctio', 'Caput Draconis', 'Acquisitio', 'Rubeus'],
  witnesses: ['Tristitia', 'Tristitia'],
  judge: 'Populus',
  total: 74,
  fortune: 'Amissio',
  fortuneIndex: 2,
  reconciler: 'Fortuna Minor',
  ascendant: 'Amissio',
} as const

const HOUSE_NOTES: readonly string[] = [
  'Ascendant — the querent',
  'Money and movables',
  'Siblings, short journeys',
  'Home, the father, endings',
  'Pleasure, children',
  'Illness, servants',
  'Marriage, the other party',
  'Death, inheritance',
  'Long journeys, religion',
  'Midheaven — career, the mother',
  'Friends, hopes',
  'Enemies, confinement',
]

const source = ref<'cast' | 'liber'>('liber')
const task = useTask<ShieldCast>()
const chart = computed(() => task.result.value)
const summary = sourceSummary()

function go(): void {
  void task.run((signal) =>
    source.value === 'liber'
      ? castShield(LIBER_BYTES)
      : withReader((reader) => castShield(reader), { signal }),
  )
}

const sequential = computed(() => (chart.value ? houses(chart.value, { system: 'sequential' }) : []))
const goldenDawn = computed(() => (chart.value ? houses(chart.value, { system: 'goldenDawn' }) : []))
const fortune = computed(() => (chart.value ? partOfFortune(chart.value) : undefined))

/** Which shield figure (I–XII) sits in each house, for the readout. */
const placement = computed(() => ({
  sequential: HOUSE_SYSTEMS.sequential,
  goldenDawn: HOUSE_SYSTEMS.goldenDawn,
}))
const figureOfHouse = (system: 'sequential' | 'goldenDawn', house: number): number =>
  placement.value[system].indexOf(house) + 1

const checks = computed(() => {
  const shield = chart.value
  if (!shield || source.value !== 'liber') return []
  const fortunePart = partOfFortune(shield)
  const gd = houses(shield, { system: 'goldenDawn' })
  const rows: { label: string; got: string; want: string }[] = [
    {
      label: 'Mothers I–IV',
      got: shield.mothers.map((f) => f.name).join(', '),
      want: EXPECTED.mothers.join(', '),
    },
    {
      label: 'Nephews IX–XII',
      got: shield.nephews.map((f) => f.name).join(', '),
      want: EXPECTED.nephews.join(', '),
    },
    {
      label: 'Witnesses XIII, XIV',
      got: shield.witnesses.map((f) => f.name).join(', '),
      want: EXPECTED.witnesses.join(', '),
    },
    { label: 'Judge XV', got: shield.judge.name, want: EXPECTED.judge },
    {
      label: 'Points of I–XII',
      got: String(fortunePart.total),
      want: String(EXPECTED.total),
    },
    {
      label: 'Part of Fortune',
      got: `figure ${fortunePart.index} ${fortunePart.figure.name}`,
      want: `figure ${EXPECTED.fortuneIndex} ${EXPECTED.fortune}`,
    },
    { label: 'Reconciler XVI', got: reconciler(shield).name, want: EXPECTED.reconciler },
    {
      label: 'Ascendant (Golden Dawn)',
      got: gd[0]?.name ?? '—',
      want: EXPECTED.ascendant,
    },
  ]
  return rows.map((row) => ({ ...row, ok: row.got === row.want }))
})

const allPass = computed(() => checks.value.length > 0 && checks.value.every((c) => c.ok))

const code = computed(
  () => `import { castShield, houses, partOfFortune, reconciler } from '@mindpeeker/oracle'

${
  source.value === 'liber'
    ? `const chart = await castShield(new Uint8Array([0xca, 0x34]))  // Liber XCVI's worked example`
    : `const chart = await castShield(source)`
}
houses(chart)[0]?.name                            // sequential: figure I in house 1
houses(chart, { system: 'goldenDawn' })[0]?.name  // Golden Dawn: figure II in house 1
partOfFortune(chart)                              // { total, index, figure }
reconciler(chart).name`,
)

onMounted(() => go())
</script>

<template>
  <DemoSection
    id="geomancy-houses"
    title="Twelve houses, two placements"
    :api="['houses', 'HOUSE_SYSTEMS', 'partOfFortune', 'reconciler', 'castShield']"
    description="houses(shield, { system }) returns the figure in house h at index h − 1. Sequential (Greer 2009) places Mothers 1–4, Daughters 5–8, Nephews 9–12; the Golden Dawn placement (Liber XCVI ch. III; Skinner, Appendix III) puts the Mothers on the angles, Daughters succedent, Nephews cadent."
  >
    <template #controls>
      <UFormField label="Chart" size="sm" class="w-full sm:w-80">
        <USelect
          v-model="source"
          :items="[
            { value: 'liber', label: 'Liber XCVI test vector — bytes CA 34' },
            { value: 'cast', label: `Fresh cast from ${summary.label}` },
          ]"
          class="w-full"
        />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :label="source === 'liber' ? 'Load the test vector' : 'Cast a chart'"
        icon="i-lucide-table"
        :hint="source === 'liber' ? 'deterministic: the same two bytes, always' : '2 bytes'"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The chart failed" @dismiss="task.reset()" />

    <div v-if="chart" class="flex flex-col gap-4">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[34rem] text-sm">
          <caption class="sr-only">
            The figure in each house under both placements
          </caption>
          <thead class="text-xs uppercase tracking-wide text-muted">
            <tr class="border-b border-default">
              <th scope="col" class="py-1.5 text-left font-medium">House</th>
              <th scope="col" class="py-1.5 text-left font-medium">sequential</th>
              <th scope="col" class="py-1.5 text-left font-medium">goldenDawn</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in 12" :key="h" class="border-b border-default/60">
              <td class="py-1.5 pe-3 align-top">
                <span class="font-mono text-highlighted">{{ h }}</span>
                <span class="ms-2 text-[11px] text-dimmed">{{ HOUSE_NOTES[h - 1] }}</span>
              </td>
              <td class="py-1.5 pe-3 align-top">
                <span class="text-highlighted">{{ sequential[h - 1]?.name }}</span>
                <span class="ms-1.5 font-mono text-[11px] text-dimmed">
                  #{{ figureOfHouse('sequential', h) }}
                </span>
              </td>
              <td class="py-1.5 align-top">
                <span class="text-highlighted">{{ goldenDawn[h - 1]?.name }}</span>
                <span class="ms-1.5 font-mono text-[11px] text-dimmed">
                  #{{ figureOfHouse('goldenDawn', h) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile label="Judge XV" :value="chart.judge.name" :mono="false" :note="chart.judge.meaning" />
        <StatTile
          label="Part of Fortune"
          :value="fortune ? `${fortune.total} pts → figure ${fortune.index}` : undefined"
          :mono="false"
          :note="fortune?.figure.name"
        />
        <StatTile
          label="Skinner’s reading"
          :value="fortune ? (goldenDawn[fortune.index - 1]?.name ?? '—') : undefined"
          :mono="false"
          note="the same remainder read as a house (goldenDawn)"
        />
      </div>

      <div v-if="checks.length" class="rounded-md border border-default bg-elevated/30 p-3">
        <p class="flex items-center gap-2 text-sm font-semibold">
          <UIcon
            :name="allPass ? 'i-lucide-check' : 'i-lucide-x'"
            class="size-4"
            :class="allPass ? 'text-success' : 'text-error'"
          />
          <span :class="allPass ? 'text-success' : 'text-error'">
            {{ allPass ? 'Reproduces Crowley’s printed chart exactly' : 'Mismatch' }}
          </span>
          <span class="font-mono text-xs text-muted">
            bytes {{ toHex(LIBER_BYTES, { sep: ' ', upper: true }) }}
          </span>
        </p>
        <ul class="mt-2 space-y-1">
          <li v-for="row in checks" :key="row.label" class="flex flex-wrap gap-x-2 text-xs">
            <UIcon
              :name="row.ok ? 'i-lucide-check' : 'i-lucide-x'"
              class="mt-0.5 size-3.5 shrink-0"
              :class="row.ok ? 'text-success' : 'text-error'"
            />
            <span class="text-muted">{{ row.label }}:</span>
            <span class="font-mono text-highlighted">{{ row.got }}</span>
            <span v-if="!row.ok" class="font-mono text-error">expected {{ row.want }}</span>
          </li>
        </ul>
        <p class="mt-2 text-xs text-muted">
          <em>Liber XCVI</em> (Equinox I:2, 1909, ch. II) prints this chart and reasons: "I + II +
          … + XII = 74 points = 6 × 12 + 2, ∴ ⊗ falls with II". Two bytes reproduce every printed
          figure — a derivation checked against its primary text, not against itself.
        </p>
      </div>

      <CodeSnippet :code="code" title="what this panel ran" />
    </div>

    <template #footer>
      House meanings are the standard table, shown for orientation only; which house answers which
      question is tradition, not mathematics. The package ships the placements and the figures — the
      reading is yours.
    </template>
  </DemoSection>
</template>
