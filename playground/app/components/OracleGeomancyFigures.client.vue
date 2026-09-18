<script setup lang="ts">
/**
 * Geomancy — the sixteen figures as identity data, with the one attribution the
 * sources disagree about made switchable.
 */
import type { GeomanticElementSystem } from '@mindpeeker/oracle'
import { figureElement, GEOMANTIC_FIGURES } from '@mindpeeker/oracle'

const SYSTEMS = [
  { value: 'goldenDawn', label: 'Golden Dawn / Skinner (1980) — Fortuna Minor = Fire' },
  { value: 'liber96', label: 'Liber XCVI (1909) — Fortuna Minor = Air' },
] as const

const ROW_TITLES = ['Fire', 'Air', 'Water', 'Earth'] as const

const system = ref<GeomanticElementSystem>('goldenDawn')

const rows = computed(() =>
  GEOMANTIC_FIGURES.map((figure) => ({
    figure,
    element: figureElement(figure, system.value),
    differs: figureElement(figure, 'goldenDawn') !== figureElement(figure, 'liber96'),
    even: figure.points % 2 === 0,
  })),
)

const evenCount = computed(() => rows.value.filter((r) => r.even).length)
const perElement = computed(() => {
  const tally = new Map<string, number>()
  for (const row of rows.value) tally.set(row.element, (tally.get(row.element) ?? 0) + 1)
  return [...tally.entries()].map(([element, count]) => `${element} ${count}`).join(' · ')
})

const code = computed(
  () => `import { GEOMANTIC_FIGURES, figureElement, figureFromBinary } from '@mindpeeker/oracle'

figureFromBinary('1100').name                       // 'Fortuna Minor'
figureElement(figureFromBinary('1100'), '${system.value}')  // '${figureElement(GEOMANTIC_FIGURES[3]!, system.value)}'
GEOMANTIC_FIGURES.filter((f) => f.points % 2 === 0) // the ${evenCount.value} figures a Judge can be`,
)
</script>

<template>
  <DemoSection
    id="geomancy-figures"
    title="The sixteen figures"
    :api="['GEOMANTIC_FIGURES', 'figureElement', 'figureFromBinary']"
    description="Names and English meanings are the standard table (Agrippa 1655 ed.; Greer 2009). Signs, planets and elements are the Golden Dawn table printed in Liber XCVI, cross-checked against Skinner (1980) — identity data to join against, not doctrine."
  >
    <template #controls>
      <UFormField label="Element attribution" size="sm" class="w-full sm:w-96">
        <USelect v-model="system" :items="SYSTEMS" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[44rem] text-sm">
          <caption class="sr-only">
            The sixteen geomantic figures with their attributions
          </caption>
          <thead class="text-xs uppercase tracking-wide text-muted">
            <tr class="border-b border-default">
              <th scope="col" class="py-1.5 text-left font-medium">Figure</th>
              <th scope="col" class="py-1.5 text-left font-medium">Name</th>
              <th scope="col" class="py-1.5 text-left font-medium">Meaning</th>
              <th scope="col" class="py-1.5 text-right font-medium">Points</th>
              <th scope="col" class="py-1.5 text-left font-medium">Element</th>
              <th scope="col" class="py-1.5 text-left font-medium">Planet</th>
              <th scope="col" class="py-1.5 text-left font-medium">Sign / node</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.figure.id"
              class="border-b border-default/60"
              :class="row.even ? '' : 'opacity-70'"
            >
              <td class="py-1.5 pe-3">
                <OracleFigure
                  :binary="row.figure.binary"
                  size="sm"
                  :row-titles="ROW_TITLES"
                  :dimmed="!row.even"
                />
              </td>
              <td class="py-1.5 pe-3 align-middle">
                <span class="text-highlighted">{{ row.figure.name }}</span>
                <span class="ms-1.5 font-mono text-[11px] text-dimmed">{{ row.figure.binary }}</span>
              </td>
              <td class="py-1.5 pe-3 align-middle text-muted">{{ row.figure.meaning }}</td>
              <td class="py-1.5 pe-3 text-right align-middle font-mono tabular-nums">
                {{ row.figure.points }}
                <span v-if="row.even" class="text-success" title="even — a possible Judge">✓</span>
              </td>
              <td class="py-1.5 pe-3 align-middle">
                <span :class="row.differs ? 'text-warning' : 'text-muted'">{{ row.element }}</span>
                <span v-if="row.differs" class="ms-1 text-[11px] text-warning">(varies)</span>
              </td>
              <td class="py-1.5 pe-3 align-middle text-muted">{{ row.figure.planet }}</td>
              <td class="py-1.5 align-middle text-muted">
                {{ row.figure.sign ?? `${row.figure.node} node` }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Possible Judges"
          :value="evenCount"
          note="only even-point figures — proved, then checked over all 65 536 charts"
        />
        <StatTile
          label="Elements under this system"
          :value="perElement"
          :mono="false"
          note="Liber XCVI gives four per element"
          size="sm"
        />
        <StatTile label="Figures" :value="GEOMANTIC_FIGURES.length" note="2⁴ row patterns" />
      </div>

      <HonestNote variant="caveat" title="One attribution the sources disagree about">
        Fortuna Minor is Fire in the Golden Dawn / Skinner table and Air in <em>Liber XCVI</em>
        itself — which is the only assignment that gives exactly four figures per element. The
        package ships both and names the source of each; Caput and Cauda Draconis carry the Moon's
        nodes instead of a sign, so their <code>sign</code> is <code>null</code> and their
        <code>node</code> says which.
      </HonestNote>

      <CodeSnippet :code="code" title="the data behind this table" />
    </div>

    <template #footer>
      Figure ids and the Fire → Earth <code>binary</code> keys match the mindpeeker frontend's
      <code>geomancy.json</code>, so a reading joins against its content without a mapping layer.
    </template>
  </DemoSection>
</template>
