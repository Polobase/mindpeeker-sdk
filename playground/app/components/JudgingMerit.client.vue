<script setup lang="ts">
/**
 * May et al.'s figure of merit: accuracy × reliability over descriptor
 * memberships, with its null taken from the design — the rank of the true
 * target's figure among the decoys it was drawn with.
 */
import type { FigureOfMeritRank } from '@mindpeeker/judging'
import { figureOfMerit, figureOfMeritRank } from '@mindpeeker/judging'
import { fmtNum } from '~/lib/format'
import { DESCRIPTORS, MERIT_SCENES } from '~/lib/judging/presets'

const targetId = ref('harbour')
const response = ref<number[]>([1, 0.5, 0, 0.5, 1, 0, 0.5, 0.5])

const sceneItems = MERIT_SCENES.map((scene) => ({ label: scene.label, value: scene.id }))

const target = computed(() => MERIT_SCENES.find((s) => s.id === targetId.value) ?? MERIT_SCENES[0])
const decoys = computed(() => MERIT_SCENES.filter((s) => s.id !== target.value?.id))

function copyTarget(): void {
  response.value = [...(target.value?.memberships ?? [])]
}
function describeEverything(): void {
  response.value = DESCRIPTORS.map(() => 1)
}
function clearResponse(): void {
  response.value = DESCRIPTORS.map(() => 0)
}

const outcome = computed<{ rank?: FigureOfMeritRank; error?: unknown }>(() => {
  try {
    const t = target.value
    if (!t) return {}
    return {
      rank: figureOfMeritRank(
        response.value,
        [...t.memberships],
        decoys.value.map((scene) => [...scene.memberships]),
      ),
    }
  } catch (error) {
    return { error }
  }
})

const rank = computed(() => outcome.value.rank)

const perScene = computed(() => {
  const t = target.value
  if (!t) return []
  return MERIT_SCENES.map((scene) => {
    try {
      const score = figureOfMerit(response.value, [...scene.memberships])
      return { scene, score, isTarget: scene.id === t.id }
    } catch {
      return { scene, score: undefined, isTarget: scene.id === t.id }
    }
  })
})

const chart = computed(() => {
  const rows = perScene.value
  if (!rows.length) return undefined
  return {
    categories: rows.map((row) => row.scene.label),
    values: rows.map((row) => row.score?.figureOfMerit ?? 0),
    highlight: rows.flatMap((row, i) => (row.isTarget ? [i] : [])),
  }
})

const code = computed(() => {
  const r = rank.value
  const t = target.value
  if (!r || !t) return ''
  return `import { figureOfMerit, figureOfMeritRank } from '@mindpeeker/judging'

// memberships over ${DESCRIPTORS.length} descriptors: ${DESCRIPTORS.join(', ')}
const response = [${response.value.join(', ')}]
const target   = [${t.memberships.join(', ')}]   // ${t.label}
const decoys   = [
${decoys.value.map((scene) => `  [${scene.memberships.join(', ')}],  // ${scene.label}`).join('\n')}
]

figureOfMerit(response, target).accuracy      // ${fmtNum(figureOfMerit(response.value, [...t.memberships]).accuracy, { digits: 4 })}
figureOfMerit(response, target).reliability   // ${fmtNum(figureOfMerit(response.value, [...t.memberships]).reliability, { digits: 4 })}

const r = figureOfMeritRank(response, target, decoys)
r.rank        // ${r.rank} of ${r.packetSize}   (ties count against the target)
r.pValue      // ${fmtNum(r.pValue, { digits: 4 })}   = rank / packetSize, exact under random pairing`
})
</script>

<template>
  <DemoSection
    id="figure-of-merit"
    title="Figure of merit — accuracy × reliability"
    :api="['figureOfMerit', 'figureOfMeritRank']"
    description="Code a response and every candidate scene as fuzzy memberships over the same descriptor list. Accuracy is the fraction of the target described; reliability the fraction of the response that is correct. Their product punishes a response that lists everything."
  >
    <template #controls>
      <UFormField label="True target of this trial" size="sm" class="w-full sm:w-72">
        <USelect v-model="targetId" :items="sceneItems" class="w-full" />
      </UFormField>
      <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-check" @click="copyTarget">
        Describe the target exactly
      </UButton>
      <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-layers" @click="describeEverything">
        Describe everything
      </UButton>
      <UButton size="sm" variant="ghost" color="neutral" @click="clearResponse">Clear</UButton>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="The coding was rejected" />

      <div class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <UFormField
          v-for="(descriptor, i) in DESCRIPTORS"
          :key="descriptor"
          :label="`${descriptor} — ${fmtNum(response[i] ?? 0, { digits: 2 })}`"
          size="sm"
        >
          <USlider v-model="response[i]" :min="0" :max="1" :step="0.25" class="mt-2" />
        </UFormField>
      </div>

      <div v-if="rank" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Figure of merit" :value="rank.figureOfMerit" :digits="4" tone="primary" note="accuracy × reliability" />
        <StatTile
          label="Rank in the packet"
          :value="`${rank.rank} of ${rank.packetSize}`"
          note="ties counted against the target"
        />
        <StatTile label="Mid-rank" :value="rank.midRank" :digits="2" note="ties split" />
        <StatTile
          label="Exact p"
          :value="rank.pValue"
          :digits="4"
          tone="info"
          note="rank / packet size, under random pairing"
        />
      </div>

      <BarChart
        v-if="chart"
        :categories="chart.categories"
        :values="chart.values"
        :highlight="chart.highlight"
        x-label="candidate scene (the true target is highlighted)"
        y-label="figure of merit"
        :height="220"
        :format="(v) => fmtNum(v, { digits: 4 })"
        aria-label="Figure of merit of the response against every candidate scene, the true target highlighted"
      />

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th class="text-left py-1.5 pr-3 font-medium">Scene</th>
              <th class="text-right py-1.5 px-3 font-medium">Overlap</th>
              <th class="text-right py-1.5 px-3 font-medium">Accuracy</th>
              <th class="text-right py-1.5 px-3 font-medium">Reliability</th>
              <th class="text-right py-1.5 pl-3 font-medium">Figure of merit</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in perScene" :key="row.scene.id" class="border-t border-default" :class="row.isTarget ? 'bg-elevated/50' : ''">
              <td class="py-1 pr-3">
                {{ row.scene.label }}
                <UBadge v-if="row.isTarget" size="sm" color="primary" variant="subtle" class="ml-1">target</UBadge>
              </td>
              <td class="py-1 px-3 text-right font-mono tabular-nums text-muted">{{ fmtNum(row.score?.overlap, { digits: 2 }) }}</td>
              <td class="py-1 px-3 text-right font-mono tabular-nums">{{ fmtNum(row.score?.accuracy, { digits: 4 }) }}</td>
              <td class="py-1 px-3 text-right font-mono tabular-nums">{{ fmtNum(row.score?.reliability, { digits: 4 }) }}</td>
              <td class="py-1 pl-3 text-right font-mono tabular-nums text-highlighted">{{ fmtNum(row.score?.figureOfMerit, { digits: 4 }) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-sm text-muted">
        Press "Describe everything": accuracy goes to 1 for every scene while reliability collapses,
        so the figure of merit stays low and the target stops standing out — which is the point of
        multiplying the two. The p-value is exactly
        <span class="font-mono">rank / {{ rank?.packetSize ?? 4 }}</span>, so with a four-clip packet
        the smallest p a single trial can produce is
        <span class="font-mono">{{ fmtNum(1 / (rank?.packetSize ?? 4), { digits: 3 }) }}</span>:
        several trials have to be combined through
        <span class="font-mono">rankOrderStatistic</span>.
      </p>

      <CodeSnippet :code="code" title="what this panel ran" />

      <HonestNote variant="caveat">
        The arithmetic trusts its inputs completely. Whether the descriptors were coded before the
        target was known, and by someone who did not know which scene was the target, is the entire
        question — and it is not something a library can check. May et al. (1990) built the fuzzy-set
        coding precisely to make that step explicit and auditable.
      </HonestNote>
    </div>

    <template #footer>
      The rank is conservative by construction: a decoy that ties the target counts against it, so
      the p-value never understates.
    </template>
  </DemoSection>
</template>
