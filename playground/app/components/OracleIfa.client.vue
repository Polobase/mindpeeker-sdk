<script setup lang="ts">
/**
 * Ifá — one of the 256 odu from exactly eight bits, and the same byte read
 * under both mark orders, which is a different figure.
 */
import type { OduCast, OduMethod } from '@mindpeeker/oracle'
import { castOdu } from '@mindpeeker/oracle'
import { sourceSummary, withReader } from '~/lib/entropy'
import { clampInt } from '~/lib/oracle/exact'
import { autoRunAllowed } from '~/lib/oracle/sources'

const METHODS = [
  { value: 'opele', label: 'Opele — the divining chain, right four shells then left' },
  { value: 'ikin', label: 'Ikin — sixteen palm nuts, marked row by row, right then left' },
] as const

const method = ref<OduMethod>('opele')
const byteValue = ref<number>(0x53)
/** A cleared number input must never reach the cast. */
const safeByte = computed(() => clampInt(byteValue.value, 0, 255, 0))
const summary = sourceSummary()

const task = useTask<OduCast>()
const cast = computed(() => task.result.value)

function go(): void {
  void task.run((signal) =>
    withReader((reader) => castOdu(reader, { method: method.value }), { signal }),
  )
}

const explorer = useTask<{ opele: OduCast; ikin: OduCast }>()
const byteCasts = computed(() => explorer.result.value)

function explore(): void {
  const bytes = new Uint8Array([safeByte.value])
  void explorer.run(async () => ({
    opele: await castOdu(bytes, { method: 'opele' }),
    ikin: await castOdu(bytes, { method: 'ikin' }),
  }))
}

watch(byteValue, () => explore())

const hexByte = computed(() => `0x${safeByte.value.toString(16).padStart(2, '0')}`)
const bitsByte = computed(() => safeByte.value.toString(2).padStart(8, '0'))

const code = computed(
  () => `import { castOdu, ODU_FIGURES } from '@mindpeeker/oracle'

const odu = await castOdu(source, { method: '${method.value}' })
odu.name        // right (male) half first, or '<Name> Meji' when both agree
odu.marks       // the eight bits in production order, 1 = single mark (I)
odu.right.rank  // { ife, southwestern } — rank order is lineage-dependent

// The same byte is a different figure under the two mark orders:
await castOdu(new Uint8Array([${hexByte.value}]), { method: 'ikin' })   // ${byteCasts.value?.ikin.name ?? '…'}
await castOdu(new Uint8Array([${hexByte.value}]), { method: 'opele' })  // ${byteCasts.value?.opele.name ?? '…'}`,
)

onMounted(() => {
  explore()
  if (autoRunAllowed()) go()
})
</script>

<template>
  <DemoSection
    id="ifa-cast"
    title="Cast an odu"
    :api="['castOdu', 'oduFromBinary', 'bitReader']"
    description="Eight MSB-first bits, each a mark (single I or double II), give one of the 256 figures with probability exactly 1/256 — the value Bascom (1969) states for a good divining chain. The two halves are drawn as legs: right (male, read first), then left."
  >
    <template #controls>
      <UFormField label="Procedure" size="sm" class="w-full sm:w-96">
        <USelect v-model="method" :items="METHODS" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        label="Cast"
        busy-label="Casting…"
        icon="i-lucide-git-fork"
        :hint="`exactly 1 byte from ${summary.providerName}`"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The cast failed" @dismiss="task.reset()" />

    <div v-if="cast" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-start gap-8">
        <OracleFigure
          :binary="cast.right.binary"
          variant="strokes"
          :label="cast.right.name"
          :caption="`right · male · ${cast.right.yoruba}`"
        />
        <OracleFigure
          :binary="cast.left.binary"
          variant="strokes"
          :label="cast.left.name"
          :caption="`left · female · ${cast.left.yoruba}`"
        />
        <div class="min-w-0">
          <h3 class="text-xl font-semibold text-highlighted">{{ cast.name }}</h3>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <UBadge v-if="cast.meji" color="primary" variant="subtle">meji — both halves agree</UBadge>
            <UBadge color="neutral" variant="subtle" class="font-mono">
              marks {{ cast.marks.join('') }}
            </UBadge>
            <UBadge color="neutral" variant="outline">method {{ cast.method }}</UBadge>
          </div>
          <p class="mt-2 text-sm text-muted">
            Ranks — right: Ifẹ {{ cast.right.rank.ife }}, southwestern
            {{ cast.right.rank.southwestern }} · left: Ifẹ {{ cast.left.rank.ife }}, southwestern
            {{ cast.left.rank.southwestern }}.
          </p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile label="P(this odu)" value="1/256" note="exactly, for all 256" tone="primary" />
        <StatTile label="Bytes consumed" :value="cast.bytesConsumed" note="always 1" />
        <StatTile label="Bits used" :value="cast.bitsUsed" note="always 8" />
        <StatTile
          label="Sample space"
          value="16 meji + 240"
          :mono="false"
          note="16 × 16 half-figures"
        />
      </div>

      <AccountingBadge
        :bytes-consumed="cast.bytesConsumed"
        :bytes-fetched="cast.bytesFetched"
        :bits-used="cast.bitsUsed"
        :source="summary.providerName"
      />

      <HonestNote variant="caveat" title="Modeled, and lineage-dependent">
        A palm-nut grasp leaving two nuts rather than one is not physically a 1/2 event, and a chain
        shell is not a fair coin — the fair-mark model is the stated null, not a measurement. Rank
        orders differ by lineage: the package ships the Ifẹ order Bascom follows and the more widely
        recognized southwestern order, and he records twenty-one more. Rank changes how questions
        are answered by alternatives, never a cast's probabilities.
      </HonestNote>
    </div>

    <template #footer>
      Names put the right (male) half first — <code>'Okanran Irete'</code>, or
      <code>'Ogbe Meji'</code> when both halves agree.
    </template>
  </DemoSection>

  <DemoSection
    id="ifa-byte"
    title="One byte, two procedures"
    :api="['castOdu', 'oduFromBinary']"
    description="Both mark orders are bijections of the byte onto the 256 figures, so both are exactly uniform — but they are different bijections. Bascom's Figure 2 is byte 0x53."
    :level="2"
  >
    <template #controls>
      <UFormField label="Byte" size="sm" class="w-40" :help="`${hexByte} · ${bitsByte}`">
        <UInputNumber v-model="byteValue" :min="0" :max="255" class="w-full" />
      </UFormField>
    </template>

    <ErrorAlert :err="explorer.error.value" @dismiss="explorer.reset()" />

    <div v-if="byteCasts" class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <div
          v-for="entry in [
            { key: 'ikin', cast: byteCasts.ikin, note: 'row by row, right then left (b₀b₂b₄b₆ | b₁b₃b₅b₇)' },
            { key: 'opele', cast: byteCasts.opele, note: 'right four shells then left (b₀b₁b₂b₃ | b₄b₅b₆b₇)' },
          ]"
          :key="entry.key"
          class="rounded-md border border-default bg-elevated/40 p-3"
        >
          <p class="text-[11px] uppercase tracking-wide text-primary">{{ entry.key }}</p>
          <div class="mt-2 flex items-start gap-6">
            <OracleFigure
              :binary="entry.cast.right.binary"
              variant="strokes"
              size="sm"
              :label="entry.cast.right.name"
              caption="right"
            />
            <OracleFigure
              :binary="entry.cast.left.binary"
              variant="strokes"
              size="sm"
              :label="entry.cast.left.name"
              caption="left"
            />
            <div class="min-w-0">
              <p class="text-sm font-semibold text-highlighted">{{ entry.cast.name }}</p>
              <p class="mt-1 text-[11px] leading-snug text-muted">{{ entry.note }}</p>
            </div>
          </div>
        </div>
      </div>

      <p class="text-sm text-muted">
        Byte <span class="font-mono text-highlighted">{{ hexByte }}</span> =
        <span class="font-mono text-highlighted">{{ bitsByte }}</span> is
        <strong>{{ byteCasts.ikin.name }}</strong> by ikin and
        <strong>{{ byteCasts.opele.name }}</strong> by opele. Same bytes in, same reading out — the
        determinism guarantee, which is what makes a recorded reading replayable forever.
      </p>

      <CodeSnippet :code="code" title="both readings of this byte" />
    </div>

    <template #footer>
      Marks: <code>1</code> = a single mark (I), <code>0</code> = a double mark (II) — the same
      convention as the geomantic figures' <code>binary</code>, so the two tables share their
      sixteen shapes.
    </template>
  </DemoSection>
</template>
