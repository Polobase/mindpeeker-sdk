<script setup lang="ts">
/**
 * `@mindpeeker/oracle` — one tab per divination system, plus two utility tabs
 * (exactness and replay). Every cast draws from the header-selected entropy
 * source through `~/lib/entropy`, and every cast prints its own receipt.
 */
import { DEFAULT_CAST_CHUNK_BYTES, TAROT_DECK } from '@mindpeeker/oracle'
import { sourceSummary } from '~/lib/entropy'

const TABS = [
  { value: 'iching', label: 'I Ching', icon: 'i-lucide-square-equal' },
  { value: 'tarot', label: 'Tarot', icon: 'i-lucide-layers' },
  { value: 'runes', label: 'Runes', icon: 'i-lucide-feather' },
  { value: 'geomancy', label: 'Geomancy', icon: 'i-lucide-grip' },
  { value: 'ifa', label: 'Ifá', icon: 'i-lucide-git-fork' },
  { value: 'cowries', label: 'Cowries', icon: 'i-lucide-shell' },
  { value: 'lots', label: 'Lots & dice', icon: 'i-lucide-dices' },
  { value: 'exactness', label: 'Exactness', icon: 'i-lucide-sigma' },
  { value: 'replay', label: 'Record & replay', icon: 'i-lucide-rotate-ccw' },
] as const

const tab = useTabQuery('iching', { tabs: TABS.map((t) => t.value) })
const summary = sourceSummary()
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="rounded-lg border border-default bg-elevated/30 p-4 flex flex-col gap-3">
      <p class="text-sm text-muted">
        Ten systems, one contract: uniform bytes in, symbols out with their exact stated
        probability, and a receipt —
        <code class="font-mono text-primary">bytesConsumed</code>,
        <code class="font-mono text-primary">bytesFetched</code>,
        <code class="font-mono text-primary">bitsUsed</code> — on every cast. Bytes come from the
        source picked in the header (<span class="font-mono text-highlighted">{{
          summary.providerName
        }}</span>), and a cast asks it for
        <span class="font-mono">{{ DEFAULT_CAST_CHUNK_BYTES }}</span>-byte chunks, so a three-byte
        hexagram never pulls a kilobyte.
      </p>
      <div class="grid gap-3 sm:grid-cols-2">
        <HonestNote variant="exact">
          Every probability on this page — 1/8 and 3/8 per coin line, 1/65 536 per shield,
          {{ TAROT_DECK.length }}!/68! ordered Celtic Crosses, 1/256 per odu — is an exact rational
          number of the model, realized by rejection sampling, dyadic Knuth–Yao draws and
          Fisher–Yates. No modulo, no float thresholds, no shuffle bias.
        </HonestNote>
        <HonestNote variant="caveat" title="What none of this asserts">
          Divination systems are cultural artifacts. The package makes no claim about what a
          hexagram, card, rune or figure <em>means</em>, and no claim that a quantum-sourced
          reading is more meaningful than one from <code>Math.random()</code>. The physical
          procedures (coins, stalks, shells, blocks, bones) are idealized models — the stated null
          of a pre-registered study, not a measurement of real objects.
        </HonestNote>
      </div>
    </div>

    <UTabs
      v-model="tab"
      :items="TABS"
      :content="false"
      variant="link"
      size="sm"
      class="w-full"
      :ui="{ list: 'overflow-x-auto', trigger: 'shrink-0' }"
    />

    <template v-if="tab === 'iching'">
      <OracleIching />
      <OracleIchingOdds />
      <OracleIchingStructure />
    </template>
    <template v-else-if="tab === 'tarot'">
      <OracleTarot />
      <OracleTarotOdds />
    </template>
    <template v-else-if="tab === 'runes'">
      <OracleRunes />
      <OracleRuneRows />
    </template>
    <template v-else-if="tab === 'geomancy'">
      <OracleGeomancy />
      <OracleGeomancyHouses />
      <OracleGeomancyFigures />
    </template>
    <template v-else-if="tab === 'ifa'">
      <OracleIfa />
      <OracleIfaTable />
    </template>
    <template v-else-if="tab === 'cowries'">
      <OracleCowries />
    </template>
    <template v-else-if="tab === 'lots'">
      <OracleLots />
      <OracleDice />
    </template>
    <template v-else-if="tab === 'exactness'">
      <OracleExactness />
      <OracleBudget />
    </template>
    <template v-else>
      <OracleReplay />
    </template>
  </div>
</template>
