<script setup lang="ts">
/**
 * Tab 5, part 3 — the EV race that replaced the stick, and the position
 * advantage inside it. Runs on a seeded control DRBG so a few hundred races
 * cost no beacon rounds and replay byte for byte.
 */
import { race, raceSubsetSize, resolveRaceOptions } from '@mindpeeker/scan'
import { createYielder } from '~/lib/async'
import { drbgSource, withReader } from '~/lib/entropy'
import { fmtNum } from '~/lib/format'
import { syntheticCatalog } from '~/lib/scan/catalog'
import { chiSquareUniform } from '~/lib/scan/stats'

const items = ref(12)
const maxValue = ref(100)
const races = ref(300)

const raceOptions = computed(() =>
  resolveRaceOptions({ maxValue: maxValue.value, subsetFraction: 0.1, subsetMin: 120, subsetMax: 5000 }),
)
const subsetSize = computed(() => raceSubsetSize(items.value, raceOptions.value))

interface RaceStats {
  races: number
  items: number
  subset: number
  byPosition: number[]
  byItem: number[]
  passes: number
  bytesConsumed: number
  source: string
}
const task = useTask<RaceStats>()
const stats = computed(() => task.result.value)

function go(): void {
  void task.run(async (signal, setProgress) => {
    const tick = createYielder(8, signal)
    const catalog = syntheticCatalog('race', items.value)
    const index = new Map(catalog.items.map((item, i) => [item.id ?? item.name, i]))
    const n = races.value
    const byPosition = new Array<number>(subsetSize.value).fill(0)
    const byItem = new Array<number>(items.value).fill(0)
    let passes = 0
    const control = drbgSource(`${currentSeedLabel()} / race simulation`)
    const bytesConsumed = await withReader(
      async (reader) => {
        for (let i = 0; i < n; i++) {
          const result = await race(reader, catalog.items, {
            maxValue: maxValue.value,
            subsetFraction: 0.1,
            subsetMin: 120,
            subsetMax: 5000,
          })
          passes += result.numberOfTrials
          result.items.forEach((raced, position) => {
            if (!raced.winner) return
            byPosition[position] = (byPosition[position] as number) + 1
            const at = index.get(raced.item.id ?? raced.item.name)
            if (at !== undefined) byItem[at] = (byItem[at] as number) + 1
          })
          if ((i & 3) === 0) {
            setProgress(i / n)
            await tick()
          }
        }
        return reader.bytesConsumed
      },
      { signal, source: control },
    )
    return {
      races: n,
      items: items.value,
      subset: subsetSize.value,
      byPosition,
      byItem,
      passes,
      bytesConsumed,
      source: control.name,
    }
  })
}

const positionShares = computed(() =>
  stats.value ? stats.value.byPosition.map((c) => c / stats.value!.races) : [],
)
const itemShares = computed(() =>
  stats.value ? stats.value.byItem.map((c) => c / stats.value!.races) : [],
)
const uniformShare = computed(() => (stats.value ? 1 / stats.value.subset : 0))
const itemFit = computed(() =>
  stats.value ? chiSquareUniform(stats.value.byItem, stats.value.races / stats.value.items) : undefined,
)
const firstShare = computed(() => positionShares.value[0])
const lastShare = computed(() => positionShares.value[positionShares.value.length - 1])

const snippet = computed(
  () => `import { race, raceSubsetSize, resolveRaceOptions } from '@mindpeeker/scan'
import { byteReader } from '@mindpeeker/oracle'

const reader = byteReader(source)
const result = await race(reader, catalog.items, { maxValue: ${maxValue.value} })

result.items          // raced items in DRAW order (a uniform Fisher-Yates prefix)
result.items[0].ev    // final Energetic Value
result.numberOfTrials // passes over the subset until someone reached ${maxValue.value}

raceSubsetSize(${items.value}, resolveRaceOptions({}))  // ${subsetSize.value} — AetherOnePi's rule`,
)
</script>

<template>
  <DemoSection
    id="scan-race"
    title="3 · The RNG race is AetherOne's invention"
    description="The classical literature has no random numbers in it. AetherOne replaced the stick with an energetic-value race: each pass adds uniformInt(0…10) to every raced item in draw order, and the first to reach maxValue wins."
    :api="['race', 'raceSubsetSize', 'resolveRaceOptions', 'RaceResult', 'drawWithoutReplacement']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :label="`Run ${races} races`"
        busy-label="Racing…"
        hint="a seeded control DRBG — no beacon rounds, byte-exact replay"
        @run="go"
        @cancel="task.cancel()"
      >
        <UFormField label="items" size="xs" class="w-24">
          <UInputNumber v-model="items" :min="2" :max="40" class="w-full" />
        </UFormField>
        <UFormField label="maxValue" size="xs" class="w-28">
          <UInputNumber v-model="maxValue" :min="5" :max="1000" :step="5" class="w-full" />
        </UFormField>
        <UFormField label="races" size="xs" class="w-28">
          <UInputNumber v-model="races" :min="20" :max="1000" :step="50" class="w-full" />
        </UFormField>
      </RunControls>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

    <div v-if="stats" class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="wins at position 0"
          :value="firstShare"
          :digits="3"
          size="sm"
          tone="warning"
          :note="`uniform would be ${fmtNum(uniformShare, { digits: 3 })}`"
        />
        <StatTile
          label="wins at the last position"
          :value="lastShare"
          :digits="3"
          size="sm"
          :note="`README: 0.118 vs 0.059 for 12 items at maxValue 100`"
        />
        <StatTile
          label="passes per race"
          :value="stats.passes / stats.races"
          :digits="1"
          size="sm"
          note="mean EV increment is 5"
        />
        <StatTile
          label="item wins uniform?"
          :value="itemFit ? itemFit.p : null"
          :digits="3"
          size="sm"
          :note="`χ² ${fmtNum(itemFit?.statistic, { digits: 1 })} on df ${itemFit?.df}`"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 class="text-sm font-medium text-highlighted mb-1">Wins by draw position</h3>
          <BarChart
            :categories="positionShares.map((_, i) => String(i))"
            :values="positionShares"
            :expected="uniformShare"
            expected-label="uniform 1/s"
            x-label="position in the pass"
            y-label="share of races won"
            :height="220"
            aria-label="Share of races won by each position in the draw order, against the uniform share"
            :format="(v) => v.toFixed(3)"
          />
          <p class="mt-1 text-xs text-muted">
            Not flat, and it never will be: within a pass an earlier position reaches the threshold
            first. This is a property of the loop, not of any item.
          </p>
        </div>
        <div>
          <h3 class="text-sm font-medium text-highlighted mb-1">Wins by catalog item</h3>
          <BarChart
            :categories="itemShares.map((_, i) => String(i + 1))"
            :values="itemShares"
            :expected="1 / stats.items"
            expected-label="uniform 1/M"
            x-label="catalog item"
            y-label="share of races won"
            :height="220"
            aria-label="Share of races won by each catalog item, against the uniform share"
            :format="(v) => v.toFixed(3)"
          />
          <p class="mt-1 text-xs text-muted">
            Flat — because the positions are a uniformly random ordering of the items. AetherOnePi
            iterates a Java <code class="font-mono">HashMap</code> instead, whose order follows the
            items' name hashes, so there the position advantage attaches to particular names.
          </p>
        </div>
      </div>

      <AccountingBadge :bytes-consumed="stats.bytesConsumed" :source="stats.source" />
    </div>
    <p v-else-if="!task.busy.value" class="text-sm text-muted">
      Nothing has raced yet. The prediction is specific: the by-position chart bends downwards
      (position 0 wins about twice as often as the last position for 12 items at maxValue 100),
      while the by-item chart stays flat.
    </p>

    <CodeSnippet :code="snippet" title="one race, by hand" />

    <HonestNote variant="caveat">
      Energy has no chance baseline at all. The race produces a winner every time by construction,
      and that winner is uniform over the catalog — which means a scan's top row is, under Reading A
      (the neutral key), exactly a uniform draw from your own list.
    </HonestNote>

    <template #footer>
      Lineage: the stick pad comes from Drown and de la Warr; the practitioner manual gives the
      sweep. The RNG race does not appear in that literature — it is AetherOne's invention, and no
      source there states how often a stick at a given position happens by chance.
    </template>
  </DemoSection>
</template>
