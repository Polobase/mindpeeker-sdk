<script setup lang="ts">
/**
 * Ifá — the sixteen principal odu, in either of the two documented rank orders.
 */
import { ODU_FIGURES, oduFromBinary } from '@mindpeeker/oracle'

const ORDERS = [
  { value: 'ife', label: 'Ifẹ order — the one Bascom follows (Table 3 A)' },
  { value: 'southwestern', label: 'Southwestern order — Lagos, Abẹokuta, Ibadan (Table 3 B)' },
] as const

const order = ref<'ife' | 'southwestern'>('ife')

const rows = computed(() =>
  [...ODU_FIGURES].sort((a, b) => a.rank[order.value] - b.rank[order.value]),
)

const code = `import { ODU_FIGURES, oduFromBinary } from '@mindpeeker/oracle'

oduFromBinary('${ODU_FIGURES[0]?.binary}')?.name          // '${oduFromBinary(ODU_FIGURES[0]?.binary ?? '')?.name}'
ODU_FIGURES.map((o) => o.rank.southwestern) // the other documented order`
</script>

<template>
  <DemoSection
    id="ifa-table"
    title="The sixteen principal odu"
    :api="['ODU_FIGURES', 'oduFromBinary']"
    description="Marks after Bascom (1969), Tables 1 and 3, cross-checked against Frisvold's independent listing. A cast names a pair of these — right half first."
  >
    <template #controls>
      <UFormField label="Rank order" size="sm" class="w-full sm:w-96">
        <USelect v-model="order" :items="ORDERS" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <div
          v-for="odu in rows"
          :key="odu.id"
          class="rounded-md border border-default bg-elevated/30 px-2 py-2"
        >
          <OracleFigure
            :binary="odu.binary"
            variant="strokes"
            size="sm"
            :label="odu.name"
            :caption="odu.yoruba === odu.name ? undefined : odu.yoruba"
            :numeral="`${odu.rank[order]}`"
          />
          <p class="mt-1 text-center font-mono text-[10px] text-dimmed">{{ odu.binary }}</p>
        </div>
      </div>

      <HonestNote variant="caveat" title="Rank order is lineage-dependent">
        The array order and <code>rank.ife</code> are the order recognized at Ifẹ, which Bascom
        follows; <code>rank.southwestern</code> is the more widely recognized order of Lagos,
        Abẹokuta and Ibadan, which moves Irosun and Ọwọnrin ahead of Ọbara and Ọkanran and reverses
        Irẹtẹ, Otura, Oturupọn, Ika. Bascom records twenty-one other rankings. None of this changes
        a single probability — every odu is 1/256 either way.
      </HonestNote>

      <CodeSnippet :code="code" title="the data behind this table" />
    </div>

    <template #footer>
      Yoruba spellings carry Bascom's subdots with tone marks omitted; ASCII <code>name</code> is
      what a cast's compound name uses. Edi is also written Odi.
    </template>
  </DemoSection>
</template>
