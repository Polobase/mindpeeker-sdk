<script setup lang="ts">
/**
 * The ten-word oracle: five English and five German words drawn uniformly from
 * real frequency lists through the header-selected entropy source, then scored
 * by a Latin cipher.
 */
import type { CipherId } from '@mindpeeker/gematria'
import { getCipher, reduce, value } from '@mindpeeker/gematria'
import { drawWord } from '@mindpeeker/gematria/oracle'
import { cipherSelectItems } from '~/lib/gematria/ciphers'
import { restartSource, sourceSummary, withReader } from '~/lib/entropy'
import { loadWordLibraries } from '~/lib/words'
import { fmtNum } from '~/lib/format'

interface Draw {
  readonly lang: 'EN' | 'DE'
  readonly word: string
  readonly total: number
  readonly reduced: number
  readonly bytes: number
}

interface DrawRun {
  readonly draws: readonly Draw[]
  readonly bytesConsumed: number
  readonly bytesFetched: number
  readonly bitsUsed: number
  readonly poolEn: number
  readonly poolDe: number
}

const cipherItems = cipherSelectItems({ scripts: ['latin'] })
const cipher = ref<CipherId>('en-ordinal')
const perLanguage = ref(5)

const task = useTask<DrawRun>()
const run = computed(() => task.result.value)
const summary = sourceSummary()

function go(): void {
  const wanted = Math.max(1, Math.min(10, Math.trunc(perLanguage.value)))
  const id = cipher.value
  void task.run(async (signal, setProgress) => {
    setProgress(0)
    // A deterministic source rewinds first, so the same seed replays the same
    // ten words — a control arm, never a secret.
    if (summary.deterministic) restartSource()
    const { en, de } = await loadWordLibraries()
    return await withReader(
      async (reader) => {
        const draws: Draw[] = []
        let bytesConsumed = 0
        let bytesFetched = 0
        let bitsUsed = 0
        for (const [lang, list] of [
          ['EN', en],
          ['DE', de],
        ] as const) {
          const seen = new Set<string>()
          let attempts = 0
          while (seen.size < wanted && attempts < wanted * 20) {
            attempts++
            const drawn = await drawWord(list, reader, { signal })
            bytesConsumed += drawn.bytesConsumed
            bytesFetched += drawn.bytesFetched ?? 0
            bitsUsed += drawn.bitsUsed
            if (seen.has(drawn.word)) continue
            seen.add(drawn.word)
            const total = value(drawn.word, id)
            draws.push({
              lang,
              word: drawn.word,
              total,
              reduced: reduce(total),
              bytes: drawn.bytesConsumed,
            })
            setProgress(draws.length / (wanted * 2))
          }
        }
        return {
          draws,
          bytesConsumed,
          bytesFetched,
          bitsUsed,
          poolEn: en.length,
          poolDe: de.length,
        }
      },
      { signal },
    )
  })
}

/** Values two or more of the ten drawn words share — the birthday effect, live. */
const shared = computed(() => {
  const counts = new Map<number, string[]>()
  for (const draw of run.value?.draws ?? []) {
    const list = counts.get(draw.total) ?? []
    list.push(draw.word)
    counts.set(draw.total, list)
  }
  return [...counts.entries()]
    .filter(([, words]) => words.length > 1)
    .map(([total, words]) => ({ total, words }))
})

const cipherLabel = computed(() => getCipher(cipher.value).label)

const code = `import { drawWord } from '@mindpeeker/gematria/oracle'
import { reduce, value } from '@mindpeeker/gematria'
import { byteReader } from '@mindpeeker/oracle'

const reader = byteReader(provider)          // one reader, many draws
try {
  const drawn = await drawWord(words, reader) // uniform — rejection-sampled, never modulo
  drawn.word                                  // the word
  drawn.bytesConsumed                         // this draw's own accounting
  value(drawn.word, 'en-ordinal')             // scoring is separate, and exact
  reduce(value(drawn.word, 'en-ordinal'))     // its digital root
} finally {
  await reader.close()
}`
</script>

<template>
  <DemoSection
    id="word-draw"
    title="Ten words from entropy"
    :api="['drawWord', 'value', 'reduce', 'withReader']"
    description="Five English and five German words, each drawn uniformly from a real frequency list (about 5 900 words per language, fetched once; a bundled list is the offline fallback). The draw is entropy; the scoring that follows is arithmetic."
  >
    <template #controls>
      <UFormField label="Cipher" size="sm" class="w-full sm:w-64">
        <USelect v-model="cipher" :items="cipherItems" class="w-full" />
      </UFormField>
      <UFormField label="Words per language" size="sm" class="w-full sm:w-36">
        <UInputNumber v-model="perLanguage" :min="1" :max="10" class="w-full" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        label="Draw"
        busy-label="Drawing…"
        icon="i-lucide-dices"
        :hint="`≈ ${perLanguage * 2} bytes from ${summary.providerName}`"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The draw failed" @dismiss="task.reset()" />

    <div class="flex flex-col gap-4">
      <p v-if="!run && !task.busy.value" class="text-sm text-muted">
        Nothing drawn yet — press <strong>Draw</strong>. The word lists are fetched from their
        public sources on the first draw, so the first run also pays a network round for them.
      </p>

      <template v-if="run">
        <div class="overflow-x-auto">
          <table class="w-full text-sm min-w-96">
            <caption class="sr-only">Words drawn from entropy with their values</caption>
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th scope="col" class="text-left py-1.5 pr-3 font-medium">Lang</th>
                <th scope="col" class="text-left py-1.5 px-3 font-medium">Word</th>
                <th scope="col" class="text-right py-1.5 px-3 font-medium">Value</th>
                <th scope="col" class="text-right py-1.5 px-3 font-medium">Reduced</th>
                <th scope="col" class="text-right py-1.5 pl-3 font-medium">Bytes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(draw, i) in run.draws" :key="i" class="border-t border-default">
                <td class="py-1.5 pr-3">
                  <UBadge :color="draw.lang === 'EN' ? 'primary' : 'neutral'" variant="subtle" size="sm">
                    {{ draw.lang }}
                  </UBadge>
                </td>
                <td class="py-1.5 px-3 font-mono">{{ draw.word }}</td>
                <td class="py-1.5 px-3 text-right font-mono text-highlighted">{{ fmtNum(draw.total, { digits: 0 }) }}</td>
                <td class="py-1.5 px-3 text-right font-mono">{{ draw.reduced }}</td>
                <td class="py-1.5 pl-3 text-right font-mono text-dimmed">{{ draw.bytes }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="grid gap-3 sm:grid-cols-3">
          <StatTile label="Words drawn" :value="run.draws.length" :digits="0" :note="`scored under ${cipherLabel}`" />
          <StatTile
            label="Pool"
            :value="`${fmtNum(run.poolEn, { digits: 0 })} EN · ${fmtNum(run.poolDe, { digits: 0 })} DE`"
            :mono="false"
            note="uniform over the list, not over the language"
          />
          <StatTile
            label="Shared values"
            :value="shared.length"
            :digits="0"
            :tone="shared.length ? 'warning' : 'neutral'"
            note="among these draws alone"
          />
        </div>

        <p v-if="shared.length" class="text-sm text-muted">
          <template v-for="(row, i) in shared" :key="row.total">
            <span v-if="i"> · </span>
            <span class="font-mono text-highlighted">{{ row.total }}</span> =
            {{ row.words.join(' = ') }}
          </template>
          — with {{ run.draws.length }} draws over a few hundred reachable values, a shared value is
          the ordinary outcome, not a sign.
        </p>

        <AccountingBadge
          :bytes-consumed="run.bytesConsumed"
          :bytes-fetched="run.bytesFetched"
          :bits-used="run.bitsUsed"
          :source="summary.providerName"
        />
      </template>

      <CodeSnippet :code="code" title="what this button ran" />

      <HonestNote variant="caveat" title="German letters do not all score">
        Latin normalization is NFKD with every combining mark stripped, so ä ö ü fold to a o u —
        but ß has no decomposition and scores 0, and so does every digit. “straße” is
        {{ fmtNum(value('straße', cipher), { digits: 0 }) }} where “strasse” is
        {{ fmtNum(value('strasse', cipher), { digits: 0 }) }}. That is a spelling artefact of the
        cipher, and a good reminder of how much any such reading depends on orthography.
      </HonestNote>
    </div>

    <template #footer>
      Word lists: google-10000-english (no swears) and the de_50k frequency list of
      hermitdave/FrequencyWords, the first 120 entries of each dropped. A frequency list is not a
      random sample of a language, so nothing here says anything about English or German —
      only about these lists and these bytes.
    </template>
  </DemoSection>
</template>
