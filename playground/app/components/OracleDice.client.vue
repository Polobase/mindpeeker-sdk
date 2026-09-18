<script setup lang="ts">
/**
 * Astragaloi and the Homer oracle — a non-dyadic weighted draw against its fair
 * null, and three dice indexing a 216-entry list.
 */
import type { AstragaloiCast, AstragalusModel, HomeromanteionCast } from '@mindpeeker/oracle'
import {
  ASTRAGALUS_FACES,
  ASTRAGALUS_WEIGHTS,
  castAstragaloi,
  castHomeromanteion,
} from '@mindpeeker/oracle'
import { fmtNum } from '~/lib/format'
import { sourceSummary, withReader } from '~/lib/entropy'
import { acceptance, binomial, clampInt, expectedUniformBytes } from '~/lib/oracle/exact'
import { bulkChunkBytes, repeatCasts } from '~/lib/oracle/loops'
import {
  autoRunAllowed,
  defaultSampleSource,
  isNetworkSample,
  type SampleSourceId,
  sampleHint,
  sampleProvider,
  sampleSourceName,
  sampleSourceOptions,
} from '~/lib/oracle/sources'
import { goodnessOfFit, toFrequencies } from '~/lib/oracle/stats'

interface FaceTally {
  readonly counts: readonly number[]
  readonly bones: number
  readonly model: AstragalusModel
  readonly bytesConsumed: number
  readonly source: string
}

const MODELS = [
  { value: 'hagstrom', label: 'Hagström 1:4:4:1 of 10 — rejection-sampled' },
  { value: 'uniform', label: 'Uniform 1/4 — the fair null, 2 bits per bone' },
] as const

const THROWS = [
  { value: 100, label: '100 throws' },
  { value: 500, label: '500 throws' },
  { value: 2000, label: '2 000 throws' },
] as const

const FACE_NOTES: Record<number, string> = {
  1: 'narrow side',
  3: 'broad side',
  4: 'broad side',
  6: 'narrow side',
}

const summary = sourceSummary()
const count = ref<number>(5)
/** A cleared number input must never reach the cast. */
const safeCount = computed(() => clampInt(count.value, 1, 64, 5))
const model = ref<AstragalusModel>('hagstrom')
const bones = useTask<AstragaloiCast>()
const boneCast = computed(() => bones.result.value)

const throws = ref<number>(100)
const sample = ref<SampleSourceId>(defaultSampleSource())
const sourceItems = sampleSourceOptions()
const bulk = useTask<FaceTally>()
const tally = computed(() => bulk.result.value)

const homer = useTask<HomeromanteionCast>()
const homerCast = computed(() => homer.result.value)

function goBones(): Promise<AstragaloiCast | undefined> {
  return bones.run((signal) =>
    withReader((reader) => castAstragaloi(reader, safeCount.value, { model: model.value }), {
      signal,
    }),
  )
}

function goBulk(): void {
  void bulk.run(async (signal, setProgress) => {
    const chosen = model.value
    const perThrow = safeCount.value
    const counts = [0, 0, 0, 0]
    const runs = throws.value
    setProgress(0)
    const receipt = await repeatCasts(
      runs,
      async (reader) => {
        const cast = await castAstragaloi(reader, perThrow, { model: chosen })
        for (const face of cast.bones) {
          const i = ASTRAGALUS_FACES.indexOf(face)
          counts[i] = (counts[i] as number) + 1
        }
      },
      {
        signal,
        setProgress,
        source: sampleProvider(sample.value),
        chunkBytes: bulkChunkBytes(isNetworkSample(sample.value)),
      },
    )
    return {
      counts,
      bones: runs * perThrow,
      model: chosen,
      bytesConsumed: receipt.bytesConsumed,
      source: sampleSourceName(sample.value),
    }
  })
}

function goHomer(): Promise<HomeromanteionCast | undefined> {
  return homer.run((signal) => withReader((reader) => castHomeromanteion(reader), { signal }))
}

/** P(this unordered throw) = multinomial coefficient × Π pᶠ — exact for the model. */
const throwProbability = computed(() => {
  const cast = boneCast.value
  if (!cast) return undefined
  const table = ASTRAGALUS_WEIGHTS[cast.model]
  const total = table.reduce((a, b) => a + b, 0)
  const counts = [0, 0, 0, 0]
  for (const face of cast.bones) {
    const i = ASTRAGALUS_FACES.indexOf(face)
    counts[i] = (counts[i] as number) + 1
  }
  let remaining = cast.bones.length
  let p = 1
  for (let i = 0; i < 4; i++) {
    const n = counts[i] as number
    p *= binomial(remaining, n) * ((table[i] as number) / total) ** n
    remaining -= n
  }
  return p
})

const observed = computed(() => (tally.value ? toFrequencies(tally.value.counts) : []))
const referenceProbs = computed(() => {
  const table = ASTRAGALUS_WEIGHTS[tally.value?.model ?? model.value]
  const total = table.reduce((a, b) => a + b, 0)
  return table.map((w) => w / total)
})
const fit = computed(() =>
  tally.value ? goodnessOfFit(tally.value.counts, referenceProbs.value) : undefined,
)

const bonesCode = computed(
  () => `import { castAstragaloi, ASTRAGALUS_WEIGHTS } from '@mindpeeker/oracle'

const cast = await castAstragaloi(source, ${safeCount.value}, { model: '${model.value}' })
cast.bones  // each 1, 3, 4 or 6, in throw order
cast.key    // the unordered throw, e.g. '13346' (56 keys for five bones)
ASTRAGALUS_WEIGHTS.${model.value}  // [${ASTRAGALUS_WEIGHTS[model.value].join(', ')}]`,
)

const homerCode = `import { castHomeromanteion } from '@mindpeeker/oracle'

const cast = await castHomeromanteion(source)  // three uniformInt(6) draws
cast.dice   // [a, b, c], each 1–6
cast.index  // 36(a−1) + 6(b−1) + c — entry 1–216, each exactly 1/216`

onMounted(() => {
  // Sequential: two concurrent readers would interleave a deterministic source.
  if (autoRunAllowed()) void goBones().then(() => goHomer())
})
</script>

<template>
  <DemoSection
    id="dice-astragaloi"
    title="Astragaloi — knucklebones"
    :api="['castAstragaloi', 'ASTRAGALUS_WEIGHTS', 'ASTRAGALUS_FACES', 'weightedIndexRational', 'weightedIndex']"
    description="Each bone lands on 1, 3, 4 or 6. The 1:4:4:1 model is not dyadic, so it needs weightedIndexRational — one rejection-sampled uniformInt(10) per bone; the fair 1/4 null is dyadic and costs two bits."
  >
    <template #controls>
      <UFormField label="Bones" size="sm" class="w-28">
        <UInputNumber v-model="count" :min="1" :max="64" class="w-full" />
      </UFormField>
      <UFormField label="Face model" size="sm" class="w-full sm:w-80">
        <USelect v-model="model" :items="MODELS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="bones.busy.value"
        label="Throw"
        busy-label="Throwing…"
        icon="i-lucide-dice-5"
        :hint="
          model === 'hagstrom'
            ? `≈ ${fmtNum(safeCount * expectedUniformBytes(10), { digits: 2 })} bytes (α = ${fmtNum(acceptance(10), { digits: 4 })})`
            : `${Math.ceil((2 * safeCount) / 8)} bytes — no rejection`
        "
        @run="goBones"
        @cancel="bones.cancel()"
      />
    </template>

    <ErrorAlert :err="bones.error.value" title="The throw failed" @dismiss="bones.reset()" />

    <div v-if="boneCast" class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-2">
        <div
          v-for="(face, i) in boneCast.bones"
          :key="i"
          class="rounded-md border border-default bg-elevated/40 px-3 py-2 text-center"
          :title="FACE_NOTES[face]"
        >
          <div class="font-mono text-2xl text-highlighted tabular-nums">{{ face }}</div>
          <div class="text-[10px] text-dimmed">{{ FACE_NOTES[face] }}</div>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="Sum" :value="boneCast.sum" note="ordered bones, summed" />
        <StatTile
          label="Unordered key"
          :value="boneCast.key"
          note="56 keys for five bones"
          size="sm"
        />
        <StatTile
          label="P(this unordered throw)"
          :value="throwProbability"
          :digits="6"
          tone="primary"
          :note="`exact under '${boneCast.model}'`"
        />
        <StatTile
          label="Bytes consumed"
          :value="boneCast.bytesConsumed"
          :note="boneCast.model === 'hagstrom' ? 'rejections included' : '2 bits per bone'"
        />
      </div>

      <AccountingBadge
        :bytes-consumed="boneCast.bytesConsumed"
        :bytes-fetched="boneCast.bytesFetched"
        :bits-used="boneCast.bitsUsed"
        :source="summary.providerName"
      />

      <CodeSnippet :code="bonesCode" title="what this button ran" />
    </div>

    <div class="mt-2 flex flex-col gap-4">
      <div class="flex flex-wrap items-end gap-3">
        <UFormField label="Throws" size="sm" class="w-full sm:w-48">
          <USelect v-model="throws" :items="THROWS" class="w-full" :disabled="bulk.busy.value" />
        </UFormField>
        <UFormField label="Sample from" size="sm" class="w-full sm:w-72">
          <USelect v-model="sample" :items="sourceItems" class="w-full" :disabled="bulk.busy.value" />
        </UFormField>
        <RunControls
          :busy="bulk.busy.value"
          :progress="bulk.progress.value"
          :label="`Check ${throws * safeCount} faces`"
          icon="i-lucide-bar-chart-3"
          :hint="sampleHint(sample, Math.ceil(throws * safeCount * (model === 'hagstrom' ? expectedUniformBytes(10) : 0.25)))"
          @run="goBulk"
          @cancel="bulk.cancel()"
        />
      </div>

      <ErrorAlert :err="bulk.error.value" title="The run failed" @dismiss="bulk.reset()" />

      <template v-if="tally">
        <BarChart
          :categories="ASTRAGALUS_FACES.map(String)"
          :values="observed"
          :expected="referenceProbs"
          :expected-label="`exact ${tally.model} weights`"
          x-label="face"
          y-label="frequency"
          :height="230"
          :format="(v) => fmtNum(v, { digits: 4 })"
          aria-label="observed astragalus face frequencies against the model weights"
        />
        <div class="grid gap-3 sm:grid-cols-3">
          <StatTile label="Bones thrown" :value="tally.bones" />
          <StatTile label="Bytes consumed" :value="tally.bytesConsumed" note="rejections included" />
          <StatTile label="χ²" :value="fit?.chi2" :note="`df = ${fit?.df ?? 0}`" />
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <PValue :p="fit?.p" kind="pointwise" label="χ² p" />
          <span class="text-xs text-muted">
            against the <span class="font-mono">{{ tally.model }}</span> weights, from
            <span class="font-mono">{{ tally.source }}</span>
          </span>
        </div>
      </template>

      <HonestNote variant="caveat" title="Modeled, emphatically not measured">
        1:4:4:1 is a rounded summary commonly attributed to Hagström's 1932 throws, not a property
        of any particular bone: real tali vary with species, wear and shaping. The frequency check
        above tests whether <em>this implementation</em> realizes the stated model, never whether
        the model describes knucklebones. Pre-register whichever model you intend to test against.
      </HonestNote>
    </div>

    <template #footer>
      Five bones are the Asia-Minor oracle inscriptions' throw, with their 56 unordered outcomes.
    </template>
  </DemoSection>

  <DemoSection
    id="dice-homer"
    title="The Homer oracle"
    :api="['castHomeromanteion', 'uniformInt']"
    description="PGM VII.1–148 keys 216 Homeric verses to three throws of a six-sided die. Three independent uniformInt(6) draws, each of the 216 entries exactly 1/216, in the papyrus order 1-1-1 … 6-6-6."
  >
    <template #controls>
      <RunControls
        :busy="homer.busy.value"
        label="Throw three dice"
        busy-label="Throwing…"
        icon="i-lucide-dice-6"
        :hint="`≈ ${fmtNum(3 * expectedUniformBytes(6), { digits: 2 })} bytes (α = ${fmtNum(acceptance(6), { digits: 4 })})`"
        @run="goHomer"
        @cancel="homer.cancel()"
      />
    </template>

    <ErrorAlert :err="homer.error.value" title="The throw failed" @dismiss="homer.reset()" />

    <div v-if="homerCast" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex gap-2">
          <span
            v-for="(die, i) in homerCast.dice"
            :key="i"
            class="grid size-12 place-items-center rounded-md border border-default bg-elevated/40 font-mono text-2xl text-highlighted"
          >
            {{ die }}
          </span>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-wide text-muted">Entry</div>
          <div class="font-mono text-4xl text-primary tabular-nums">{{ homerCast.index }}</div>
          <div class="text-[11px] text-dimmed">
            36({{ homerCast.dice[0] }}−1) + 6({{ homerCast.dice[1] }}−1) + {{ homerCast.dice[2] }}
          </div>
        </div>
        <StatTile label="P(this entry)" :value="1 / 216" :digits="6" note="exactly 1/216" />
      </div>

      <AccountingBadge
        :bytes-consumed="homerCast.bytesConsumed"
        :bytes-fetched="homerCast.bytesFetched"
        :bits-used="homerCast.bitsUsed"
        :source="summary.providerName"
      />

      <HonestNote variant="caveat" title="Index only">
        No verse text or verse references ship with the package — the entry number is the key into
        an edition you supply. “One die thrown three times would achieve the same purpose” (Betz,
        ed., 1986, note to PGM VII.1–148), which is exactly what three
        <code>uniformInt(6)</code> draws are.
      </HonestNote>

      <CodeSnippet :code="homerCode" title="what this button ran" />
    </div>
  </DemoSection>
</template>
