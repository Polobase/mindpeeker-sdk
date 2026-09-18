<script setup lang="ts">
/**
 * Near matches: two of n uniform points among c positions within distance d.
 *
 * Two closed forms — Abramson & Moser's on a circle (calendar days wrap) and
 * the falling factorial on a line (an interval does not). Both were checked
 * against brute-force enumeration before they produced a reference value, and
 * both cost a handful of logarithms, so this whole tab is live.
 */
import {
  nearMatch,
  nearNoMatch,
  peopleForNearMatch,
  peopleForNearMatchApprox,
} from '@mindpeeker/coincidence'
import type { NearTopology } from '@mindpeeker/coincidence'
import { nearCurves } from '~/lib/coincidence/curves'
import { fmtNum } from '~/lib/format'

const c = ref(365)
const d = ref(1)
const n = ref(14)
const topology = ref<NearTopology>('circle')

const TOPOLOGY_ITEMS = [
  { label: 'circle — day 365 neighbours day 1 (a calendar)', value: 'circle' },
  { label: 'line — no wrap-around (an interval)', value: 'line' },
]

/** The closeness windows the chart compares, with the current d folded in. */
const CURVE_DS = [0, 1, 3, 7]

const safeC = computed(() => Math.max(1, Math.trunc(Number(c.value) || 1)))
const safeD = computed(() => Math.max(0, Math.trunc(Number(d.value) || 0)))
const safeN = computed(() => Math.max(0, Math.trunc(Number(n.value) || 0)))

interface Outcome {
  match: number
  noMatch: number
  other: number
  people50: number
  people50Approx: number
  people95: number
}

const outcome = computed<{ value?: Outcome; error?: unknown }>(() => {
  try {
    const args = [safeN.value, safeC.value, safeD.value] as const
    const opts = { topology: topology.value }
    const flipped = { topology: topology.value === 'circle' ? ('line' as const) : ('circle' as const) }
    return {
      value: {
        match: nearMatch(...args, opts),
        noMatch: nearNoMatch(...args, opts),
        other: nearMatch(...args, flipped),
        people50: peopleForNearMatch(0.5, safeC.value, safeD.value, opts),
        people50Approx: peopleForNearMatchApprox(0.5, safeC.value, safeD.value),
        people95: peopleForNearMatch(0.95, safeC.value, safeD.value, opts),
      },
    }
  } catch (error) {
    return { error }
  }
})

const value = computed(() => outcome.value.value)

const ds = computed(() => {
  const set = new Set<number>([...CURVE_DS, safeD.value])
  return [...set].filter((entry) => 2 * entry < safeC.value).sort((a, b) => a - b)
})

const curves = computed(() => {
  const widest = Math.max(1, ds.value[ds.value.length - 1] ?? 1)
  const nMax = Math.max(
    8,
    Math.min(
      Math.floor(safeC.value / (widest + 1)) + 1,
      Math.max(20, Math.ceil(3 * Math.sqrt(safeC.value / (2 * widest + 1))), safeN.value + 2),
    ),
  )
  return nearCurves(safeC.value, ds.value, nMax, topology.value)
})

const series = computed(() =>
  curves.value.curves.map((curve, index) => ({
    name: curve.d === 0 ? 'd = 0 — the birthday problem' : `d = ${curve.d}`,
    y: curve.y,
    x: curves.value.x,
    color: ((index % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6,
    dashed: curve.d !== safeD.value,
  })),
)

/** Values the README and the literature print, recomputed live. */
const pinned = computed(() => [
  {
    label: 'nearMatch(14, 365, 1) — circle',
    live: nearMatch(14, 365, 1),
    published: 0.5374927880366435,
    source: 'README; Abramson & Moser (1970)',
  },
  {
    label: 'peopleForNearMatch(0.5, 365, 1)',
    live: peopleForNearMatch(0.5, 365, 1),
    published: 14,
    source: '“14 people suffice” — within a day',
  },
  {
    label: 'peopleForNearMatch(0.5, 365, 7)',
    live: peopleForNearMatch(0.5, 365, 7),
    published: 7,
    source: 'within a week',
  },
  {
    label: 'peopleForNearMatchApprox(0.5, 365, 1)',
    live: peopleForNearMatchApprox(0.5, 365, 1),
    published: 12.987140329427929,
    source: 'D–M eq. 7.6 (they print 13.2); exact is 14',
  },
])

const code = computed(
  () => `import { nearMatch, nearNoMatch, peopleForNearMatch } from '@mindpeeker/coincidence'

nearNoMatch(${safeN.value}, ${safeC.value}, ${safeD.value}, { topology: '${topology.value}' })
// ${fmtNum(value.value?.noMatch ?? 0, { digits: 10 })}
nearMatch(${safeN.value}, ${safeC.value}, ${safeD.value}, { topology: '${topology.value}' })
// ${fmtNum(value.value?.match ?? 0, { digits: 10 })}
peopleForNearMatch(0.5, ${safeC.value}, ${safeD.value}, { topology: '${topology.value}' })
// ${value.value?.people50 ?? '—'}`,
)
</script>

<template>
  <DemoSection
    id="near"
    title="Near matches — “within a day of each other”"
    :api="['nearMatch', 'nearNoMatch', 'peopleForNearMatch', 'peopleForNearMatchApprox']"
    description="Loosening “the same day” to “within d days” makes a coincidence far cheaper: 14 people suffice for two birthdays within a day, where 23 are needed for the same day. The closed forms are exact for both topologies."
  >
    <template #controls>
      <UFormField label="c — positions (days)" size="sm" class="w-full sm:w-44">
        <UInputNumber v-model="c" :min="1" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="d — closeness window" size="sm" class="w-full sm:w-44">
        <UInputNumber v-model="d" :min="0" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="n — points (people)" size="sm" class="w-full sm:w-36">
        <UInputNumber v-model="n" :min="0" :step="1" class="w-full" />
      </UFormField>
      <UFormField label="Topology" size="sm" class="w-full sm:w-80">
        <USelect v-model="topology" :items="TOPOLOGY_ITEMS" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="The arguments were rejected" />

      <div v-if="value" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="P(some pair within d)"
          :value="value.match"
          :digits="6"
          tone="primary"
          :note="`${safeN} points, ${fmtNum(safeC, { digits: 0 })} positions, d = ${safeD}, ${topology}`"
        />
        <StatTile label="P(all further than d apart)" :value="value.noMatch" :digits="6" note="the exact closed form" />
        <StatTile
          label="Points for even odds"
          :value="value.people50"
          :digits="0"
          tone="warning"
          :note="`exact; the eq. 7.6 estimate is ${fmtNum(value.people50Approx, { digits: 2 })}`"
        />
        <StatTile
          label="Points for 0.95"
          :value="value.people95"
          :digits="0"
          note="exact inversion at the same d"
        />
      </div>

      <div v-if="value" class="rounded-md border border-default bg-elevated/40 p-3 text-sm">
        On the other topology the same configuration gives
        <span class="font-mono text-highlighted">{{ fmtNum(value.other, { digits: 8 }) }}</span>
        ({{ topology === 'circle' ? 'line' : 'circle' }}) against
        <span class="font-mono text-highlighted">{{ fmtNum(value.match, { digits: 8 }) }}</span>
        ({{ topology }}). Wrapping adds the pairs that straddle the year boundary, so the circle is
        never the cheaper one — but with c ≫ nd the two agree to several digits, which is why the
        distinction is usually invisible and worth stating anyway.
      </div>

      <LineChart
        :series="series"
        :hlines="[{ value: 0.5, label: '½' }]"
        :vlines="[{ value: safeN, label: `you: n = ${safeN}`, color: 'primary', dashed: false }]"
        :y-domain="[0, 1]"
        x-label="points n"
        y-label="P(some pair within d)"
        :height="300"
        :format="(v) => fmtNum(v, { digits: 4 })"
        aria-label="Probability of a near match against the number of points, one curve per closeness window"
      />

      <div>
        <h3 class="text-sm font-semibold text-highlighted">Published values, recomputed here</h3>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th class="text-left py-1.5 pr-3 font-medium">Call</th>
                <th class="text-right py-1.5 px-3 font-medium">Computed now</th>
                <th class="text-right py-1.5 px-3 font-medium">Published</th>
                <th class="text-left py-1.5 pl-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in pinned" :key="row.label" class="border-t border-default">
                <td class="py-1.5 pr-3 font-mono text-xs">{{ row.label }}</td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums">
                  {{ Number.isInteger(row.published) ? row.live : row.live.toPrecision(12) }}
                </td>
                <td class="py-1.5 px-3 text-right font-mono tabular-nums text-muted">
                  {{ Number.isInteger(row.published) ? row.published : row.published.toPrecision(12) }}
                </td>
                <td class="py-1.5 pl-3 text-muted text-xs">{{ row.source }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <CodeSnippet :code="code" title="what these controls ran" />

      <HonestNote variant="caveat" title="d is part of the hypothesis">
        “Within a day” is a far weaker claim than “the same day”, and “within a week” weaker still —
        the price drops from 23 people to 14 to 7. Choosing d <em>after</em> seeing how close the
        two dates happened to be is the same multiplicity the law of truly large numbers describes,
        and no closed form on this page can see it. Fisher's closeness score, on the Fisher tab,
        is the alternative: it avoids a cutoff by scoring the observed distance directly.
      </HonestNote>
    </div>

    <template #footer>
      M. Abramson &amp; W. O. J. Moser, <em>More Birthday Surprises</em>, American Mathematical
      Monthly 77 (1970); B. A. Sevast'yanov (1972) behind Diaconis &amp; Mosteller's eq. 7.6.
    </template>
  </DemoSection>
</template>
