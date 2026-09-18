<script setup lang="ts">
/**
 * `castGematria` — the full reading: entropy picks one admissible word of the
 * lexicon, and the package returns its profile, its value and every peer within
 * the colel window, with the honest commonness attached.
 */
import type { CipherId } from '@mindpeeker/gematria'
import type { GematriaCast } from '@mindpeeker/gematria/oracle'
import { castGematria } from '@mindpeeker/gematria/oracle'
import { cipherSelectItems } from '~/lib/gematria/ciphers'
import { glossOf, SEPHER_SEPHIROTH, wordsFor } from '~/lib/gematria/lexicon'
import { restartSource, sourceSummary, withReader } from '~/lib/entropy'
import { fmtNum } from '~/lib/format'

const cipherItems = cipherSelectItems({ scripts: ['hebrew', 'greek', 'latin'] })
const cipher = ref<CipherId>('he-hechrachi')
const colel = ref(true)

const task = useTask<GematriaCast>()
const cast = computed(() => task.result.value)
const summary = sourceSummary()

const pool = computed(() => {
  try {
    return wordsFor(cipher.value).length
  } catch {
    return 0
  }
})

function go(): void {
  const id = cipher.value
  const useColel = colel.value
  void task.run(async (signal) => {
    if (summary.deterministic) restartSource()
    return await withReader(
      (reader) =>
        castGematria(SEPHER_SEPHIROTH, id, reader, {
          signal,
          ...(useColel ? { colel: true } : {}),
        }),
      { signal },
    )
  })
}

const peers = computed(() => {
  const result = cast.value
  if (!result) return []
  const exact = new Set(result.exact)
  return result.matches.map((word) => ({
    word,
    gloss: glossOf(word),
    exact: exact.has(word),
    self: word === result.word,
  }))
})

const code = computed(
  () => `import { castGematria } from '@mindpeeker/gematria/oracle'
import { SEPHER_SEPHIROTH } from '@mindpeeker/gematria/lexicon'

const cast = await castGematria(SEPHER_SEPHIROTH, '${cipher.value}', source${colel.value ? ', { colel: true }' : ''})
cast.word          // ${cast.value ? `'${cast.value.word}'` : 'the drawn word'}
cast.value         // ${cast.value?.value ?? 'its value under the cipher'}
cast.profile       // every cipher of its script, for free
cast.matches       // peers within the window — cast.exact is the strict subset
cast.commonness    // ${fmtNum(cast.value?.commonness ?? 0, { digits: 4 })} of ${cast.value?.lexiconSize ?? pool.value} admissible words
cast.bytesConsumed // ${cast.value?.bytesConsumed ?? 1} — the draw's own accounting`,
)
</script>

<template>
  <DemoSection
    id="cast"
    title="Cast a reading"
    :api="['castGematria', 'withReader', 'GematriaCast']"
    description="One word drawn uniformly among the lexicon's admissible entries under the chosen cipher — rejection-sampled, never modulo — with its full profile, its peers and the fraction of the corpus that shares its value."
  >
    <template #controls>
      <UFormField label="Cipher" size="sm" class="w-full sm:w-64">
        <USelect v-model="cipher" :items="cipherItems" class="w-full" />
      </UFormField>
      <UFormField label="Colel (±1) for the peers" size="sm">
        <USwitch v-model="colel" :label="colel ? 'on' : 'off'" />
      </UFormField>
      <RunControls
        :busy="task.busy.value"
        label="Cast"
        busy-label="Drawing…"
        icon="i-lucide-sparkles"
        :hint="`1–2 bytes from ${summary.providerName} · ${pool} words in the pool`"
        @run="go"
        @cancel="task.cancel()"
      />
    </template>

    <ErrorAlert :err="task.error.value" title="The cast failed" @dismiss="task.reset()" />

    <div class="flex flex-col gap-4">
      <p v-if="!cast && !task.busy.value" class="text-sm text-muted">
        Nothing cast yet — press <strong>Cast</strong>. Identical bytes reproduce an identical
        reading, which is what makes the seeded DRBG source in the header a replay button.
      </p>

      <template v-if="cast">
        <div class="flex flex-wrap items-baseline gap-3">
          <span class="text-4xl leading-none text-highlighted" dir="auto">{{ cast.word }}</span>
          <span v-if="glossOf(cast.word)" class="text-muted">{{ glossOf(cast.word) }}</span>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Value" :value="cast.value" :digits="0" tone="primary" :note="cast.cipher" />
          <StatTile label="Reduced" :value="cast.reduced" :digits="0" note="digital root" />
          <StatTile
            label="Commonness"
            :value="cast.commonness"
            :digits="4"
            :tone="cast.commonness > 0.02 ? 'warning' : 'neutral'"
            :note="`${cast.matches.length} of ${cast.lexiconSize} admissible words`"
          />
          <StatTile label="Window" :value="`± ${cast.tolerance}`" :mono="false" note="colel is exactly tolerance 1" />
        </div>

        <div>
          <h4 class="text-xs uppercase tracking-wide text-muted mb-2">
            Peers within ± {{ cast.tolerance }}
          </h4>
          <ul class="flex flex-wrap gap-1.5">
            <li
              v-for="peer in peers"
              :key="peer.word"
              class="rounded border px-2 py-1 text-sm"
              :class="peer.self ? 'border-primary bg-primary/10' : 'border-default bg-elevated/40'"
              :title="peer.gloss"
            >
              <span dir="auto">{{ peer.word }}</span>
              <span v-if="!peer.exact" class="ml-1 text-dimmed">±</span>
            </li>
          </ul>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm min-w-80">
            <caption class="sr-only">The drawn word under every cipher of its script</caption>
            <thead>
              <tr class="text-muted text-xs uppercase">
                <th scope="col" class="text-left py-1.5 pr-3 font-medium">Cipher</th>
                <th scope="col" class="text-right py-1.5 px-3 font-medium">Value</th>
                <th scope="col" class="text-right py-1.5 pl-3 font-medium">Reduced</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in cast.profile.values" :key="row.cipher" class="border-t border-default">
                <td class="py-1 pr-3">{{ row.label }}</td>
                <td class="py-1 px-3 text-right font-mono">{{ fmtNum(row.value, { digits: 0 }) }}</td>
                <td class="py-1 pl-3 text-right font-mono text-muted">{{ row.reduced }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <AccountingBadge
          :bytes-consumed="cast.bytesConsumed"
          :bytes-fetched="cast.bytesFetched"
          :bits-used="cast.bitsUsed"
          :source="summary.providerName"
        />
      </template>

      <CodeSnippet :code="code" title="what this button ran" />

      <HonestNote variant="contested" title="A draw is a draw">
        The entropy picked a word out of a curated dictionary; the value that follows is arithmetic
        and the peers are whoever else sits at that number. Whether the reading <em>means</em>
        anything is a contemplative tradition, not a result — and the commonness above is there so
        the coincidence stays visibly a coincidence.
      </HonestNote>
    </div>

    <template #footer>
      Lifecycle: the bridge validates every argument before touching the entropy input, reads
      through <code class="font-mono">byteReader(source, { signal })</code> and closes what it
      opened in <code class="font-mono">finally</code>. A reader you pass in stays open, and an
      already-aborted signal rejects even a draw that would need no bytes.
    </template>
  </DemoSection>
</template>
