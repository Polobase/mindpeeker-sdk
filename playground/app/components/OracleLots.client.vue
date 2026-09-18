<script setup lang="ts">
/**
 * Kau cim and Tibetan Mo — a uniform lot with an optional confirming throw of
 * the moon blocks, and the six-syllable die thrown twice.
 */
import type { LotCast, LotSticks, MoCast } from '@mindpeeker/oracle'
import { castLot, castMo, JIAOBEI_WEIGHTS, MO_SYLLABLES } from '@mindpeeker/oracle'
import { fmtNum } from '~/lib/format'
import { sourceSummary, withReader } from '~/lib/entropy'
import { acceptance, expectedUniformBytes } from '~/lib/oracle/exact'
import { autoRunAllowed } from '~/lib/oracle/sources'

const STICK_ITEMS = [
  { value: 100, label: '100 — the usual temple set' },
  { value: 78, label: '78 — the “Chi Chi” sets exported from 1915' },
  { value: 60, label: '60 — sexagenary-cycle sets (liushi jiazi)' },
  { value: 64, label: '64 — hexagram-keyed sets' },
] as const

const CONFIRM_ITEMS = [
  { value: 0, label: 'No confirmation — one stick' },
  { value: -1, label: 'Shake until a holy throw — Geometric(1/2), mean 2' },
  { value: 3, label: 'At most 3 sticks — confirmed with p = 7/8' },
  { value: 5, label: 'At most 5 sticks — confirmed with p = 31/32' },
] as const

const THROW_LABELS: Record<string, string> = {
  holy: 'holy — one flat, one round (2/4)',
  twoFlat: 'two flat (1/4)',
  twoRound: 'two round (1/4)',
}

const sticks = ref<LotSticks>(100)
const confirm = ref<number>(-1)
const summary = sourceSummary()

const lot = useTask<LotCast>()
const lotCast = computed(() => lot.result.value)

const confirmOption = computed<boolean | number>(() =>
  confirm.value === 0 ? false : confirm.value === -1 ? true : confirm.value,
)

function goLot(): Promise<LotCast | undefined> {
  return lot.run((signal) =>
    withReader(
      (reader) => castLot(reader, { sticks: sticks.value, confirm: confirmOption.value }),
      { signal },
    ),
  )
}

const confirmProbability = computed(() =>
  confirm.value <= 0 ? undefined : 1 - 2 ** -confirm.value,
)

const mo = useTask<MoCast>()
const again = useTask<MoCast>()
const moCast = computed(() => mo.result.value)
const moAgain = computed(() => again.result.value)

function goMo(): Promise<MoCast | undefined> {
  again.reset()
  return mo.run((signal) => withReader((reader) => castMo(reader), { signal }))
}

function goMoAgain(): void {
  void again.run((signal) => withReader((reader) => castMo(reader), { signal }))
}

/** Mipham's firmness check: throw again and compare the ordered pair. */
const firmness = computed(() => {
  const a = moCast.value
  const b = moAgain.value
  if (!a || !b) return undefined
  if (a.first.index === b.first.index && a.second.index === b.second.index) {
    return { tone: 'success' as const, text: 'the same pair — a very firm answer' }
  }
  if (a.first.index === b.second.index && a.second.index === b.first.index) {
    return { tone: 'warning' as const, text: 'the reversed pair — a weak answer' }
  }
  return { tone: 'neutral' as const, text: 'a different pair — the answer stands' }
})

const lotCode = computed(
  () => `import { castLot, JIAOBEI_WEIGHTS } from '@mindpeeker/oracle'

const cast = await castLot(source, { sticks: ${sticks.value}, confirm: ${String(confirmOption.value)} })
cast.lot        // 1 + uniformInt(${sticks.value}) — exactly uniform either way
cast.attempts   // every stick drawn, with its jiaobei throw
JIAOBEI_WEIGHTS // [2, 1, 1] over ['holy', 'twoFlat', 'twoRound']`,
)

const moCode = `import { castMo, MO_SYLLABLES } from '@mindpeeker/oracle'

const cast = await castMo(source)  // two uniformInt(6) draws
cast.number                        // 6·first.index + second.index + 1, each exactly 1/36
// The book's firmness check is a second, independent castMo you compare.`

onMounted(() => {
  // Sequential: two concurrent readers would interleave a deterministic source.
  if (autoRunAllowed()) void goLot().then(() => goMo())
})
</script>

<template>
  <DemoSection
    id="lots-kaucim"
    title="Kau cim — fortune sticks and moon blocks"
    :api="['castLot', 'JIAOBEI_WEIGHTS', 'uniformInt', 'weightedIndex']"
    description="Shake one numbered stick out of the cylinder, then let the two crescent blocks confirm it. The final lot is exactly uniform on 1..n with or without confirmation — the throws are independent of the stick, so confirming changes how long it takes, never which lot you get."
  >
    <template #controls>
      <UFormField label="Stick set" size="sm" class="w-full sm:w-80">
        <USelect v-model="sticks" :items="STICK_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Confirmation" size="sm" class="w-full sm:w-80">
        <USelect v-model="confirm" :items="CONFIRM_ITEMS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="lot.busy.value"
        label="Shake"
        busy-label="Shaking…"
        icon="i-lucide-dices"
        :hint="`≈ ${fmtNum(expectedUniformBytes(sticks), { digits: 2 })} bytes per stick`"
        @run="goLot"
        @cancel="lot.cancel()"
      />
    </template>

    <ErrorAlert :err="lot.error.value" title="The cast failed" @dismiss="lot.reset()" />

    <div v-if="lotCast" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-4">
        <div class="rounded-lg border border-primary/40 bg-primary/5 px-5 py-3 text-center">
          <div class="text-[11px] uppercase tracking-wide text-muted">Lot</div>
          <div class="font-mono text-4xl text-primary tabular-nums">{{ lotCast.lot }}</div>
          <div class="text-[11px] text-dimmed">of {{ lotCast.sticks }}</div>
        </div>
        <div class="min-w-0">
          <UBadge
            v-if="lotCast.confirmed !== undefined"
            :color="lotCast.confirmed ? 'success' : 'warning'"
            variant="subtle"
          >
            {{ lotCast.confirmed ? 'confirmed by a holy throw' : 'not confirmed' }}
          </UBadge>
          <p class="mt-2 text-sm text-muted">
            {{ lotCast.attempts.length }} stick{{ lotCast.attempts.length > 1 ? 's' : '' }} drawn.
            No lot poems ship with the package — the number is the result.
          </p>
        </div>
      </div>

      <div v-if="lotCast.attempts.some((a) => a.blocks)" class="overflow-x-auto">
        <table class="w-full min-w-[22rem] text-sm">
          <caption class="sr-only">
            Every stick drawn with its jiaobei throw
          </caption>
          <thead class="text-xs uppercase tracking-wide text-muted">
            <tr class="border-b border-default">
              <th scope="col" class="py-1.5 text-left font-medium">#</th>
              <th scope="col" class="py-1.5 text-left font-medium">Stick</th>
              <th scope="col" class="py-1.5 text-left font-medium">Blocks</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(attempt, i) in lotCast.attempts"
              :key="i"
              class="border-b border-default/60"
              :class="attempt.blocks === 'holy' ? 'text-success' : 'text-muted'"
            >
              <td class="py-1 font-mono">{{ i + 1 }}</td>
              <td class="py-1 font-mono tabular-nums">{{ attempt.lot }}</td>
              <td class="py-1">{{ attempt.blocks ? THROW_LABELS[attempt.blocks] : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="P(this lot)" :value="1 / lotCast.sticks" :digits="5" note="exactly 1/n" />
        <StatTile
          label="uniformInt acceptance"
          :value="acceptance(lotCast.sticks)"
          :digits="4"
          :note="lotCast.sticks === 64 ? '64 divides 256 — never rejects' : 'rejected draws still spend bytes'"
        />
        <StatTile
          label="P(confirmed)"
          :value="confirm === -1 ? 1 : confirmProbability"
          :digits="4"
          :note="confirm === -1 ? 'shaking until holy — almost surely' : confirm === 0 ? 'no throw' : `1 − 2^−${confirm}`"
        />
        <StatTile label="Bytes consumed" :value="lotCast.bytesConsumed" note="8 bits per stick byte + 2 per throw" />
      </div>

      <AccountingBadge
        :bytes-consumed="lotCast.bytesConsumed"
        :bytes-fetched="lotCast.bytesFetched"
        :bits-used="lotCast.bitsUsed"
        :source="summary.providerName"
      />

      <HonestNote variant="caveat" title="Named by what lands">
        Sources disagree which double throw is the refusal and which the “laughing” one, so the
        outcomes are named <code>holy</code>, <code>twoFlat</code>, <code>twoRound</code> — by the
        blocks, not by a reading. Weights {{ JIAOBEI_WEIGHTS.join(' : ') }} of 4 model two fair
        two-sided blocks; real crescent blocks are asymmetric and no measured probability is used.
      </HonestNote>

      <CodeSnippet :code="lotCode" title="what this button ran" />
    </div>

    <template #footer>
      A block standing on its end (a rethrow in practice) is not modeled.
    </template>
  </DemoSection>

  <DemoSection
    id="lots-mo"
    title="Tibetan Mo — two throws of the syllable die"
    :api="['castMo', 'MO_SYLLABLES', 'uniformInt']"
    description="The six faces are the syllables of Manjushri's mantra, AH RA PA TSA NA DHI. The ordered pair names one of 36 answers, each with probability exactly 1/36 — RA then DHI is answer 12, as in the book's own example."
  >
    <template #controls>
      <RunControls
        :busy="mo.busy.value"
        label="Throw"
        busy-label="Throwing…"
        icon="i-lucide-dice-6"
        :hint="`2 × uniformInt(6) — ≈ ${fmtNum(2 * expectedUniformBytes(6), { digits: 2 })} bytes`"
        @run="goMo"
        @cancel="mo.cancel()"
      >
        <UButton
          v-if="moCast"
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-lucide-repeat"
          :loading="again.busy.value"
          @click="goMoAgain"
        >
          Firmness check
        </UButton>
      </RunControls>
    </template>

    <ErrorAlert :err="mo.error.value" title="The throw failed" @dismiss="mo.reset()" />
    <ErrorAlert :err="again.error.value" title="The second throw failed" @dismiss="again.reset()" />

    <div v-if="moCast" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-4">
        <div
          v-for="(face, i) in [moCast.first, moCast.second]"
          :key="i"
          class="rounded-lg border border-default bg-elevated/40 px-4 py-3 text-center"
        >
          <div class="text-[11px] uppercase tracking-wide text-muted">
            {{ i === 0 ? 'First throw' : 'Second throw' }}
          </div>
          <div class="font-mono text-3xl text-highlighted">{{ face.syllable }}</div>
          <div class="text-[11px] text-dimmed">die face {{ face.pips }} · index {{ face.index }}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-wide text-muted">Answer</div>
          <div class="font-mono text-4xl text-primary tabular-nums">{{ moCast.number }}</div>
          <div class="text-[11px] text-dimmed">of 36 · p = 1/36 exactly</div>
        </div>
      </div>

      <div v-if="moAgain" class="rounded-md border border-default bg-elevated/30 p-3">
        <p class="text-[11px] uppercase tracking-wide text-muted">
          Firmness check — a second, independent cast
        </p>
        <p class="mt-1 text-sm">
          <span class="font-mono text-highlighted">
            {{ moAgain.first.syllable }} {{ moAgain.second.syllable }}
          </span>
          → answer {{ moAgain.number }}:
          <span
            :class="
              firmness?.tone === 'success'
                ? 'text-success'
                : firmness?.tone === 'warning'
                  ? 'text-warning'
                  : 'text-muted'
            "
          >
            {{ firmness?.text }}
          </span>
        </p>
        <p class="mt-1 text-xs text-dimmed">
          P(the same pair again) = 1/36; for a mixed pair the reversed pair is another 1/36, while a
          double pair is its own reverse. The rule is the book's; the odds are the model's.
        </p>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <UBadge
          v-for="face in MO_SYLLABLES"
          :key="face.syllable"
          color="neutral"
          variant="subtle"
          class="font-mono"
        >
          {{ face.syllable }} = {{ face.pips }}
        </UBadge>
      </div>

      <AccountingBadge
        :bytes-consumed="moCast.bytesConsumed"
        :bytes-fetched="moCast.bytesFetched"
        :bits-used="moCast.bitsUsed"
        :source="summary.providerName"
      />

      <CodeSnippet :code="moCode" title="what this button ran" />
    </div>

    <template #footer>
      Structure only: the translated answer texts (Mipham, tr. Goldberg &amp; Dakpa, 1990) are
      copyrighted and are not shipped. The number is the key into the book.
    </template>
  </DemoSection>
</template>
