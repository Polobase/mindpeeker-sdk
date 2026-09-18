<script setup lang="ts">
/**
 * Western geomancy — the full shield chart from exactly 16 bits, and the two
 * derived figures the sources add on top of it.
 */
import type { ShieldCast } from '@mindpeeker/oracle'
import { castShield, partOfFortune, reconciler } from '@mindpeeker/oracle'
import { sourceSummary, withReader } from '~/lib/entropy'
import { autoRunAllowed } from '~/lib/oracle/sources'

const ROMAN = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
] as const
const ROW_TITLES = ['Fire', 'Air', 'Water', 'Earth'] as const

const task = useTask<ShieldCast>()
const shield = computed(() => task.result.value)
const summary = sourceSummary()

function go(): void {
  void task.run((signal) => withReader((reader) => castShield(reader), { signal }))
}

const fortune = computed(() => (shield.value ? partOfFortune(shield.value) : undefined))
const reconcile = computed(() => (shield.value ? reconciler(shield.value) : undefined))

const code = `import { castShield, partOfFortune, reconciler } from '@mindpeeker/oracle'

const chart = await castShield(source)   // 16 bits, 2 bytes, always
chart.mothers[0].name                    // figure I
chart.nephews === chart.nieces           // the sources' name, same frozen array
chart.judge.points % 2 === 0             // true for all 65 536 charts
partOfFortune(chart)                     // { total, index, figure }
reconciler(chart).name                   // XVI = I + XV`

onMounted(() => {
  if (autoRunAllowed()) go()
})
</script>

<template>
  <DemoSection
    id="geomancy-shield"
    title="The shield chart"
    :api="['castShield', 'partOfFortune', 'reconciler', 'figureFromBinary']"
    description="Sixteen MSB-first bits make four Mothers of four rows each (Fire, Air, Water, Earth; one point = active), uniform over all 2¹⁶ = 65 536 charts. Everything below them is derivation, not chance: Daughters by transposition, then Nephews, Witnesses and Judge by row-wise geomantic addition — which with active = 1 is exactly r = a ⊕ b."
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        label="Cast a chart"
        busy-label="Casting…"
        icon="i-lucide-grip"
        :hint="`exactly 2 bytes from ${summary.providerName}`"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The cast failed" @dismiss="task.reset()" />

    <div v-if="shield" class="flex flex-col gap-5">
      <div>
        <p class="text-[11px] uppercase tracking-wide text-muted">
          Mothers I–IV (cast) · Daughters V–VIII (transposed)
        </p>
        <div class="mt-2 grid grid-cols-4 gap-3 sm:grid-cols-8">
          <OracleFigure
            v-for="(figure, i) in [...shield.mothers, ...shield.daughters]"
            :key="`m${i}`"
            :binary="figure.binary"
            :label="figure.name"
            :caption="`${figure.points} pts`"
            :numeral="ROMAN[i]"
            :row-titles="ROW_TITLES"
          />
        </div>
      </div>

      <div>
        <p class="text-[11px] uppercase tracking-wide text-muted">
          Nephews IX–XII — <code>shield.nieces</code>, aliased <code>shield.nephews</code>
        </p>
        <div class="mt-2 grid grid-cols-4 gap-3 sm:max-w-md">
          <OracleFigure
            v-for="(figure, i) in shield.nieces"
            :key="`n${i}`"
            :binary="figure.binary"
            :label="figure.name"
            :caption="`${figure.points} pts`"
            :numeral="ROMAN[i + 8]"
            :row-titles="ROW_TITLES"
          />
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-start">
        <div>
          <p class="text-[11px] uppercase tracking-wide text-muted">Witnesses XIII, XIV</p>
          <div class="mt-2 flex gap-4">
            <OracleFigure
              :binary="shield.witnesses[0].binary"
              :label="shield.witnesses[0].name"
              caption="Right Witness"
              numeral="XIII"
              :row-titles="ROW_TITLES"
            />
            <OracleFigure
              :binary="shield.witnesses[1].binary"
              :label="shield.witnesses[1].name"
              caption="Left Witness"
              numeral="XIV"
              :row-titles="ROW_TITLES"
            />
          </div>
        </div>
        <div>
          <p class="text-[11px] uppercase tracking-wide text-muted">Judge XV</p>
          <div class="mt-2 rounded-md border border-primary/40 bg-primary/5 px-4 py-2">
            <OracleFigure
              :binary="shield.judge.binary"
              :label="shield.judge.name"
              :caption="`${shield.judge.meaning} · ${shield.judge.points} pts`"
              numeral="XV"
              :row-titles="ROW_TITLES"
            />
          </div>
        </div>
        <div v-if="reconcile">
          <p class="text-[11px] uppercase tracking-wide text-muted">Reconciler XVI = I + XV</p>
          <div class="mt-2">
            <OracleFigure
              :binary="reconcile.binary"
              :label="reconcile.name"
              :caption="reconcile.meaning"
              numeral="XVI"
              :row-titles="ROW_TITLES"
            />
          </div>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Points of I–XII"
          :value="fortune?.total"
          note="always even — the parity theorem"
        />
        <StatTile
          label="Part of Fortune"
          :value="fortune ? `figure ${fortune.index}` : undefined"
          :note="fortune?.figure.name"
          tone="primary"
        />
        <StatTile
          label="Judge points"
          :value="shield.judge.points"
          note="even in all 65 536 charts"
        />
        <StatTile label="Chart probability" value="1/65 536" note="exactly, for every chart" />
      </div>

      <AccountingBadge
        :bytes-consumed="shield.bytesConsumed"
        :bytes-fetched="shield.bytesFetched"
        :bits-used="shield.bitsUsed"
        :source="summary.providerName"
      />

      <HonestNote variant="exact" title="Two theorems, checked over all 65 536 charts">
        Each Mother bit enters the XOR pipeline exactly twice, so the Judge always lands on one of
        the eight even-point figures — the classical validity check, here a proof. And because the
        Daughters transpose the Mothers, the points of I–XII always sum to an even number, so the
        Part of Fortune can only fall on figure II, IV, VI, VIII, X or XII. Skinner reads the same
        remainder as a <em>house</em> number instead; both readings are exposed.
      </HonestNote>

      <CodeSnippet :code="code" title="what this button ran" />
    </div>

    <p v-else-if="!task.busy.value" class="text-sm text-muted">
      Press <strong>Cast a chart</strong> — it costs exactly two bytes, every time.
    </p>

    <template #footer>
      The shield is traditionally drawn right to left; the Roman numerals are what identify the
      figures. Points per figure are the dot count 4–8, shown under each name. Attributions live in
      the table below — identity data from the <em>Liber XCVI</em> table, not doctrine.
    </template>
  </DemoSection>
</template>
