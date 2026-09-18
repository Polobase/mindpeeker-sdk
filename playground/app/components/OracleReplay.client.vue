<script setup lang="ts">
/**
 * Record and replay — `recordingReader` captures every byte a session consumed,
 * and those bytes reproduce the readings exactly, forever.
 */
import type { EntropyAccounting } from '@mindpeeker/oracle'
import {
  byteReader,
  castAstragaloi,
  castCowries,
  castHexagram,
  castHomeromanteion,
  castLot,
  castMo,
  castOdu,
  castRunes,
  castShield,
  castSpread,
  partOfFortune,
  recordingReader,
} from '@mindpeeker/oracle'
import { fmtNum, fromHex, toHex } from '~/lib/format'
import { provider, sourceSummary } from '~/lib/entropy'

interface Reading {
  readonly label: string
  readonly headline: string
  readonly detail: string
  readonly acc: EntropyAccounting
}

interface Session {
  readonly readings: readonly Reading[]
  readonly bytes: Uint8Array
  readonly source: string
}

const KINDS = [
  { value: 'shield', label: 'castShield — geomancy (2 bytes)' },
  { value: 'hexagram-yarrow', label: 'castHexagram — yarrow (3 bytes)' },
  { value: 'hexagram-coins', label: 'castHexagram — coins (3 bytes)' },
  { value: 'hexagram-single', label: 'castHexagram — one moving line (≥ 2 bytes)' },
  { value: 'odu-ikin', label: 'castOdu — ikin (1 byte)' },
  { value: 'odu-opele', label: 'castOdu — opele (1 byte)' },
  { value: 'cowries', label: 'castCowries (2 bytes)' },
  { value: 'runes', label: 'castRunes — three, merkstave (≈ 4 bytes)' },
  { value: 'tarot', label: 'castSpread — three cards, reversals (≈ 5 bytes)' },
  { value: 'celtic', label: 'castSpread — Celtic Cross, reversals (≈ 14 bytes)' },
  { value: 'mo', label: 'castMo (≈ 2 bytes)' },
  { value: 'homer', label: 'castHomeromanteion (≈ 3 bytes)' },
  { value: 'lot', label: 'castLot — 100 sticks (≈ 1 byte)' },
  { value: 'astragaloi', label: 'castAstragaloi — five bones (≈ 6 bytes)' },
] as const

type Kind = (typeof KINDS)[number]['value']

const summary = sourceSummary()

/** One reading of each kind, from any input the oracle accepts. */
async function readOne(kind: Kind, input: Uint8Array | Parameters<typeof castShield>[0]): Promise<Reading> {
  switch (kind) {
    case 'hexagram-yarrow':
    case 'hexagram-coins':
    case 'hexagram-single': {
      const method =
        kind === 'hexagram-yarrow' ? 'yarrow' : kind === 'hexagram-coins' ? 'coins' : 'singleLine'
      const cast = await castHexagram(input, { method })
      return {
        label: `castHexagram({ method: '${method}' })`,
        headline: `${cast.primary.character} #${cast.primary.kingWen} ${cast.primary.name.en}`,
        detail: `moving [${cast.changing.join(', ') || '—'}]${cast.relating ? ` → #${cast.relating.kingWen} ${cast.relating.name.en}` : ''}`,
        acc: cast,
      }
    }
    case 'shield': {
      const cast = await castShield(input)
      const fortune = partOfFortune(cast)
      return {
        label: 'castShield()',
        headline: `Judge ${cast.judge.name}`,
        detail: `mothers ${cast.mothers.map((m) => m.name).join(', ')} · ${fortune.total} pts → figure ${fortune.index} ${fortune.figure.name}`,
        acc: cast,
      }
    }
    case 'odu-ikin':
    case 'odu-opele': {
      const method = kind === 'odu-ikin' ? 'ikin' : 'opele'
      const cast = await castOdu(input, { method })
      return {
        label: `castOdu({ method: '${method}' })`,
        headline: cast.name,
        detail: `marks ${cast.marks.join('')}${cast.meji ? ' · meji' : ''}`,
        acc: cast,
      }
    }
    case 'cowries': {
      const cast = await castCowries(input)
      return {
        label: 'castCowries()',
        headline: `${cast.odu.name} — ${cast.up} up`,
        detail: `${fmtNum(cast.odu.ways)} of 65 536 patterns`,
        acc: cast,
      }
    }
    case 'runes': {
      const cast = await castRunes(input, 3, { merkstave: true })
      return {
        label: "castRunes(3, { merkstave: true })",
        headline: cast.runes.map((r) => r.rune.glyph).join(' '),
        detail: cast.runes
          .map((r) => `${r.rune.name}${r.merkstave ? ' (merkstave)' : ''}`)
          .join(', '),
        acc: cast,
      }
    }
    case 'tarot':
    case 'celtic': {
      const spread = kind === 'tarot' ? 'threeCard' : 'celticCross'
      const cast = await castSpread(input, spread, { reversals: true })
      return {
        label: `castSpread('${spread}', { reversals: true })`,
        headline: cast.cards.map((c) => `${c.card.name}${c.reversed ? ' ⤺' : ''}`).join(' · '),
        detail: cast.spread.name,
        acc: cast,
      }
    }
    case 'mo': {
      const cast = await castMo(input)
      return {
        label: 'castMo()',
        headline: `${cast.first.syllable} ${cast.second.syllable} → answer ${cast.number}`,
        detail: 'one of 36, each exactly 1/36',
        acc: cast,
      }
    }
    case 'homer': {
      const cast = await castHomeromanteion(input)
      return {
        label: 'castHomeromanteion()',
        headline: `entry ${cast.index}`,
        detail: `dice ${cast.dice.join('-')} · 1/216`,
        acc: cast,
      }
    }
    case 'lot': {
      const cast = await castLot(input, { sticks: 100 })
      return {
        label: 'castLot({ sticks: 100 })',
        headline: `lot ${cast.lot}`,
        detail: 'uniform on 1..100',
        acc: cast,
      }
    }
    default: {
      const cast = await castAstragaloi(input, 5)
      return {
        label: 'castAstragaloi(5)',
        headline: cast.key,
        detail: `bones ${cast.bones.join(', ')} · sum ${cast.sum}`,
        acc: cast,
      }
    }
  }
}

/* ---------------------------------------------------------------- session */

const SESSION: readonly Kind[] = ['hexagram-yarrow', 'hexagram-single', 'shield']

const record = useTask<Session>()
const session = computed(() => record.result.value)
const replay = useTask<readonly Reading[]>()
const replayed = computed(() => replay.result.value)

function goRecord(): void {
  replay.reset()
  void record.run(async (signal) => {
    const rec = recordingReader(provider, { signal, chunkBytes: 32 })
    try {
      const readings: Reading[] = []
      for (const kind of SESSION) readings.push(await readOne(kind, rec.reader))
      return { readings, bytes: rec.bytes(), source: summary.providerName }
    } finally {
      await rec.reader.close()
    }
  })
}

function goReplay(): void {
  const recorded = session.value?.bytes
  if (!recorded) return
  void replay.run(async () => {
    const reader = byteReader(recorded)
    try {
      const readings: Reading[] = []
      for (const kind of SESSION) readings.push(await readOne(kind, reader))
      return readings
    } finally {
      await reader.close()
    }
  })
}

const matches = computed(() => {
  const live = session.value?.readings
  const again = replayed.value
  if (!live || !again) return []
  return live.map((reading, i) => ({
    label: reading.label,
    ok: again[i]?.headline === reading.headline && again[i]?.detail === reading.detail,
    headline: again[i]?.headline ?? '—',
  }))
})
const allMatch = computed(() => matches.value.length > 0 && matches.value.every((m) => m.ok))
const recordedTotal = computed(() =>
  session.value ? session.value.readings.reduce((sum, r) => sum + r.acc.bytesConsumed, 0) : 0,
)

/* ------------------------------------------------------------ paste bytes */

const kind = ref<Kind>('shield')
const hexInput = ref('ca 34')
const manual = useTask<Reading>()
const manualReading = computed(() => manual.result.value)

function goManual(): void {
  const text = hexInput.value
  const chosen = kind.value
  void manual.run(async () => readOne(chosen, fromHex(text)))
}

function useRecorded(): void {
  const bytes = session.value?.bytes
  if (bytes) hexInput.value = toHex(bytes, { sep: ' ' })
}

const sessionCode = `import { byteReader, castHexagram, castShield, recordingReader } from '@mindpeeker/oracle'

const rec = recordingReader(source)
const yarrow = await castHexagram(rec.reader, { method: 'yarrow' })
const single = await castHexagram(rec.reader, { method: 'singleLine' })
const shield = await castShield(rec.reader)
await rec.reader.close()          // releases the provider's stream
const recorded = rec.bytes()      // every byte the session consumed

// Later, anywhere, forever:
const replay = byteReader(recorded)
await castHexagram(replay, { method: 'yarrow' })   // the same hexagram
await castHexagram(replay, { method: 'singleLine' })
await castShield(replay)`
</script>

<template>
  <DemoSection
    id="replay-record"
    title="Record a session"
    :api="['recordingReader', 'byteReader', 'castHexagram', 'castShield', 'partOfFortune']"
    description="One reader, three casts, one recording. bytesConsumed is what a replay needs; bytesFetched is what the source actually delivered — the first cast pulls a whole 32-byte chunk, and the next two spend what is already buffered, so they fetch nothing."
  >
    <template #controls>
      <RunControls
        :busy="record.busy.value"
        label="Record three casts"
        busy-label="Casting…"
        icon="i-lucide-circle-dot"
        :hint="`from ${summary.providerName}`"
        @run="goRecord"
        @cancel="record.cancel()"
      >
        <UButton
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-lucide-rotate-ccw"
          :disabled="!session || replay.busy.value"
          :loading="replay.busy.value"
          @click="goReplay"
        >
          Replay from the bytes
        </UButton>
      </RunControls>
    </template>

    <ErrorAlert :err="record.error.value" title="The session failed" @dismiss="record.reset()" />
    <ErrorAlert :err="replay.error.value" title="The replay failed" @dismiss="replay.reset()" />

    <div v-if="session" class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <div
          v-for="(reading, i) in session.readings"
          :key="reading.label"
          class="rounded-md border border-default bg-elevated/40 p-3"
        >
          <p class="font-mono text-[11px] text-primary">{{ reading.label }}</p>
          <p class="mt-1 text-sm font-semibold text-highlighted">{{ reading.headline }}</p>
          <p class="text-xs text-muted">{{ reading.detail }}</p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <AccountingBadge
              :bytes-consumed="reading.acc.bytesConsumed"
              :bytes-fetched="reading.acc.bytesFetched"
              :bits-used="reading.acc.bitsUsed"
            />
            <span
              v-if="matches[i]"
              class="inline-flex items-center gap-1 text-xs"
              :class="matches[i]?.ok ? 'text-success' : 'text-error'"
            >
              <UIcon :name="matches[i]?.ok ? 'i-lucide-check' : 'i-lucide-x'" class="size-3.5" />
              replay {{ matches[i]?.ok ? 'identical' : `differs: ${matches[i]?.headline}` }}
            </span>
          </div>
        </div>
      </div>

      <div class="rounded-md border border-default bg-elevated/30 p-3">
        <p class="text-[11px] uppercase tracking-wide text-muted">
          Recorded bytes — {{ session.bytes.length }} of them
        </p>
        <p class="mt-1 break-all font-mono text-xs text-highlighted">
          {{ toHex(session.bytes, { sep: ' ', upper: true }) }}
        </p>
        <p class="mt-1.5 text-xs text-dimmed">
          = the {{ recordedTotal }} bytes the three casts consumed, including everything rejection
          sampling discarded. Source: <span class="font-mono">{{ session.source }}</span
          >.
        </p>
      </div>

      <div
        v-if="replayed"
        class="rounded-md border p-3"
        :class="allMatch ? 'border-success/50 bg-success/5' : 'border-error/50 bg-error/5'"
      >
        <p class="flex items-center gap-2 text-sm font-semibold">
          <UIcon
            :name="allMatch ? 'i-lucide-check' : 'i-lucide-x'"
            class="size-4"
            :class="allMatch ? 'text-success' : 'text-error'"
          />
          <span :class="allMatch ? 'text-success' : 'text-error'">
            {{ allMatch ? 'All three readings reproduced exactly' : 'A reading differed' }}
          </span>
        </p>
        <p class="mt-1 text-xs text-muted">
          Same bytes in, same readings out. That is all a replay proves: it does not prove the bytes
          were random, or honestly recorded. For that you need source attribution, a beacon pulse or
          a published log — which is what the ledger, entropy and vdf packages are for.
        </p>
      </div>

      <CodeSnippet :code="sessionCode" title="what these buttons ran" />
    </div>

    <p v-else-if="!record.busy.value" class="text-sm text-muted">
      Press <strong>Record three casts</strong>, then replay them from the bytes.
    </p>

    <template #footer>
      A cast closes the reader it opened; a reader you pass in stays open, which is why the session
      closes <code>rec.reader</code> itself. Closing waits at most 250 ms for the source's
      <code>return()</code>, so a socket or device session is always released.
    </template>
  </DemoSection>

  <DemoSection
    id="replay-bytes"
    title="Cast from bytes you supply"
    :api="['castHexagram', 'castShield', 'castOdu', 'castSpread', 'castCowries', 'OracleError']"
    description="Every cast accepts a Uint8Array directly, so any hex string is a reading. Determinism means this is not a simulation of the reading — it is the reading."
  >
    <template #controls>
      <UFormField label="Cast" size="sm" class="w-full sm:w-96">
        <USelect v-model="kind" :items="KINDS" class="w-full" />
      </UFormField>
      <UFormField label="Bytes (hex)" size="sm" class="w-full sm:w-96" help="spaces, : and - are ignored">
        <UInput v-model="hexInput" class="w-full font-mono" placeholder="ca 34" />
      </UFormField>
      <RunControls
        :busy="manual.busy.value"
        label="Cast from these bytes"
        icon="i-lucide-binary"
        :cancellable="false"
        @run="goManual"
      >
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-clipboard-copy"
          :disabled="!session"
          @click="useRecorded"
        >
          Use the recorded bytes
        </UButton>
      </RunControls>
    </template>

    <ErrorAlert :err="manual.error.value" title="That did not cast" @dismiss="manual.reset()" />

    <div v-if="manualReading" class="flex flex-col gap-3">
      <div class="rounded-md border border-default bg-elevated/40 p-3">
        <p class="font-mono text-[11px] text-primary">{{ manualReading.label }}</p>
        <p class="mt-1 text-lg font-semibold text-highlighted">{{ manualReading.headline }}</p>
        <p class="text-xs text-muted">{{ manualReading.detail }}</p>
        <AccountingBadge
          class="mt-2"
          :bytes-consumed="manualReading.acc.bytesConsumed"
          :bytes-fetched="manualReading.acc.bytesFetched"
          :bits-used="manualReading.acc.bitsUsed"
          source="Uint8Array (batch)"
        />
      </div>

      <HonestNote variant="caveat" title="Two typed errors worth provoking">
        Give it an odd number of hex digits and <code>fromHex</code> throws
        <code>FormatError(invalid_hex)</code>. Give <code>ca 34</code> to the Celtic Cross and the
        cast throws <code>OracleError(insufficient_entropy)</code> — a finite input that runs out
        mid-cast is an error, never a silently shortened reading. Both are rendered above instead of
        being thrown into the console.
      </HonestNote>
    </div>

    <template #footer>
      <code>ca 34</code> with <em>castShield</em> is the worked chart of Crowley's
      <em>Liber XCVI</em>; <code>53</code> with <em>castOdu — ikin</em> is Bascom's Figure 2,
      Okanran Irete.
    </template>
  </DemoSection>
</template>
