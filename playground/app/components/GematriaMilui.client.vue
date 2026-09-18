<script setup lang="ts">
/**
 * Milui (Mispar Shemi) — the value of a letter's spelled-out *name*, the four
 * divine-name spellings of יהוה, and the two letter-name conventions the
 * package ships.
 */
import type { MiluiVariant, NamesVariant } from '@mindpeeker/gematria'
import { HE_BASE, HE_NAMES, milui, value } from '@mindpeeker/gematria'
import { hebrew } from '~/lib/gematria/state'
import { fmtNum } from '~/lib/format'

const variant = ref<'none' | MiluiVariant>('none')
const namesVariant = ref<NamesVariant>('standard')

const VARIANT_ITEMS = [
  { label: 'none — the ordinary letter names', value: 'none' },
  { label: 'AB — he הי, vav ויו → יהוה = 72', value: 'ab' },
  { label: 'SAG — he הי, vav ואו → יהוה = 63', value: 'sag' },
  { label: 'MAH — he הא, vav ואו → יהוה = 45', value: 'mah' },
  { label: 'BAN — he הה, vav וו → יהוה = 52', value: 'ban' },
]
const NAMES_ITEMS = [
  { label: 'standard — frontend parity (גמל 73, פא 81)', value: 'standard' },
  { label: 'plene — Crowley/Godwin (גימל 83, פה 85)', value: 'plene' },
]

const miluiOptions = computed(() => ({
  ...(variant.value === 'none' ? {} : { variant: variant.value as MiluiVariant }),
  namesVariant: namesVariant.value,
}))

const outcome = computed<{ total?: number; error?: unknown }>(() => {
  try {
    return { total: milui(hebrew.text, miluiOptions.value) }
  } catch (error) {
    return { error }
  }
})

/** The four classical Miluim of the Tetragrammaton — fixed reference values. */
const EXPECTED: Record<MiluiVariant, number> = { ab: 72, sag: 63, mah: 45, ban: 52 }

const tetragrammaton = computed(() =>
  (['ab', 'sag', 'mah', 'ban'] as const).map((v) => ({
    variant: v,
    value: milui('יהוה', { variant: v, namesVariant: namesVariant.value }),
    expected: EXPECTED[v],
  })),
)

const cipherValues = computed(() => {
  try {
    return {
      milui: value(hebrew.text, 'he-milui', { namesVariant: namesVariant.value }),
      neelam: value(hebrew.text, 'he-neelam', { namesVariant: namesVariant.value }),
      hechrachi: value(hebrew.text, 'he-hechrachi'),
      kidmi: value(hebrew.text, 'he-kidmi'),
      perati: value(hebrew.text, 'he-perati'),
      katanMispari: value(hebrew.text, 'he-katan-mispari'),
    }
  } catch {
    return undefined
  }
})

const letters = computed(() =>
  HE_BASE.map((char) => ({
    char,
    name: HE_NAMES[char] ?? '',
    standard: value(char, 'he-milui'),
    plene: value(char, 'he-milui', { namesVariant: 'plene' }),
    neelam: value(char, 'he-neelam', { namesVariant: namesVariant.value }),
    hechrachi: value(char, 'he-hechrachi'),
  })),
)

const changed = computed(() => letters.value.filter((l) => l.standard !== l.plene))

const code = computed(
  () => `import { milui, value, HE_NAMES } from '@mindpeeker/gematria'

HE_NAMES['א']                     // 'אלף' — the letter's name
value('א', 'he-milui')            // 111 — the name's own Hechrachi value
milui('יהוה', 'ab')               // 72   (SAG 63, MAH 45, BAN 52)
milui(${JSON.stringify(hebrew.text)}${variant.value === 'none' ? '' : `, { variant: '${variant.value}'${namesVariant.value === 'plene' ? ", namesVariant: 'plene'" : ''} }`}) // ${outcome.value.total ?? '—'}
value(${JSON.stringify(hebrew.text)}, 'he-neelam'${namesVariant.value === 'plene' ? ", { namesVariant: 'plene' }" : ''}) // ${cipherValues.value?.neelam ?? '—'} — Milui minus the letters themselves`,
)
</script>

<template>
  <DemoSection
    id="milui"
    title="Milui — the spelled-out names"
    :api="['milui', 'HE_NAMES', 'HE_BASE', 'he-milui', 'he-neelam', 'he-kidmi', 'he-perati']"
    description="Every Hebrew letter has a name, and the name has a value: alef spelled אלף is 111. Milui sums those names; Ne'elam keeps only the “hidden” remainder after subtracting the letter itself. The four Miluim of the Tetragrammaton differ only in how he and vav are spelled."
  >
    <template #controls>
      <UFormField label="Hebrew word" size="sm" class="w-full sm:w-48">
        <UInput v-model="hebrew.text" dir="rtl" class="w-full" spellcheck="false" />
      </UFormField>
      <UFormField label="Divine-name variant" size="sm" class="w-full sm:w-72">
        <USelect v-model="variant" :items="VARIANT_ITEMS" class="w-full" />
      </UFormField>
      <UFormField label="Letter-name spelling" size="sm" class="w-full sm:w-72">
        <USelect v-model="namesVariant" :items="NAMES_ITEMS" class="w-full" />
      </UFormField>
    </template>

    <div class="flex flex-col gap-4">
      <ErrorAlert :err="outcome.error" title="milui rejected that input" :dismissible="false" />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="milui(text)" :value="outcome.total ?? null" :digits="0" tone="primary" />
        <StatTile label="he-milui cipher" :value="cipherValues?.milui ?? null" :digits="0" note="the same sum as a cipher row" />
        <StatTile label="he-neelam" :value="cipherValues?.neelam ?? null" :digits="0" note="Milui − the letters themselves" />
        <StatTile label="he-hechrachi" :value="cipherValues?.hechrachi ?? null" :digits="0" note="for comparison" />
      </div>

      <div class="grid gap-3 sm:grid-cols-4">
        <StatTile
          v-for="row in tetragrammaton"
          :key="row.variant"
          :label="`יהוה — ${row.variant.toUpperCase()}`"
          :value="row.value"
          :digits="0"
          :tone="row.value === row.expected ? 'success' : 'error'"
          note="must come out exactly"
        />
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-120">
          <caption class="sr-only">Letter names and their values</caption>
          <thead>
            <tr class="text-muted text-xs uppercase">
              <th scope="col" class="text-left py-1.5 pr-3 font-medium">Letter</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Name</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Hechrachi</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Milui standard</th>
              <th scope="col" class="text-right py-1.5 px-3 font-medium">Milui plene</th>
              <th scope="col" class="text-right py-1.5 pl-3 font-medium">Ne'elam</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in letters" :key="row.char" class="border-t border-default">
              <td class="py-1 pr-3 text-lg" dir="rtl">{{ row.char }}</td>
              <td class="py-1 px-3 text-right text-base" dir="rtl">{{ row.name }}</td>
              <td class="py-1 px-3 text-right font-mono text-muted">{{ row.hechrachi }}</td>
              <td class="py-1 px-3 text-right font-mono">{{ row.standard }}</td>
              <td
                class="py-1 px-3 text-right font-mono"
                :class="row.standard === row.plene ? 'text-dimmed' : 'text-primary'"
              >
                {{ row.plene }}
              </td>
              <td class="py-1 pl-3 text-right font-mono text-muted">{{ row.neelam }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-sm text-muted">
        Exactly {{ changed.length }} letters differ between the conventions —
        <span dir="rtl" class="font-mono">{{ changed.map((l) => l.char).join(' ') }}</span>: gimel
        גמל 73 against גימל 83, pe פא 81 against פה 85. A word's Milui therefore rises by 10 per
        gimel and 4 per pe, which is why
        <code class="font-mono">value('גד', 'he-milui', { namesVariant: 'plene' })</code> is
        {{ fmtNum(value('גד', 'he-milui', { namesVariant: 'plene' }), { digits: 0 }) }}, not
        {{ fmtNum(value('גד', 'he-milui'), { digits: 0 }) }}.
      </p>

      <div v-if="cipherValues" class="grid gap-3 sm:grid-cols-3">
        <StatTile label="he-kidmi (triangular)" :value="cipherValues.kidmi" :digits="0" note="cumulative Σ up to each letter" />
        <StatTile label="he-perati (squared)" :value="cipherValues.perati" :digits="0" note="each letter's value squared" />
        <StatTile label="he-katan-mispari" :value="cipherValues.katanMispari" :digits="0" note="digital root of the whole total" />
      </div>

      <CodeSnippet :code="code" title="what this section ran" />

      <HonestNote variant="caveat" title="Two spellings, two literatures">
        Neither convention is a mistake. The default keeps parity with the mindpeeker frontend and
        torahcalc's charts; <code class="font-mono">'plene'</code> follows Crowley's
        <em>Sepher Sephiroth</em> (Pe = PH 85, gimel GYML 83) and Godwin's
        <em>Cabalistic Encyclopedia</em>. If you compare a number with a printed table, check which
        spelling that table used before reading anything into a difference of 10.
      </HonestNote>
    </div>

    <template #footer>
      Sources: Agrippa, <em>De Occulta Philosophia</em> II.xix; Mathers, <em>The Kabbalah
      Unveiled</em>; Crowley, <em>Sepher Sephiroth</em> (Equinox I.8, 1912); Scholem,
      <em>Kabbalah</em>; torahcalc.com for the method charts.
    </template>
  </DemoSection>
</template>
