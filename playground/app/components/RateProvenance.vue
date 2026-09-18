<script setup lang="ts">
import { PROVENANCE_ROWS, SOURCE_LINKS, STATUS_META } from '~/lib/rate/provenance'

/**
 * The README's verified-vs-modeled table, rendered. SSR-safe: no SDK imports —
 * this is provenance, not computation.
 */

const entry = computed(() => packageById('rate'))
const grouped = computed(() => ({
  verified: PROVENANCE_ROWS.filter((r) => r.status === 'verified').length,
  empirical: PROVENANCE_ROWS.filter((r) => r.status === 'empirical').length,
  web: PROVENANCE_ROWS.filter((r) => r.status === 'web').length,
  modeled: PROVENANCE_ROWS.filter((r) => r.status === 'modeled').length,
}))
</script>

<template>
  <DemoSection
    id="provenance"
    title="Verified, web-sourced, or modeled"
    description="Primary technical sources on Rae's card geometry are thin, so the package keeps four provenance classes apart and so does this page. Nothing above is evidence that any of it works."
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-2">
        <UBadge
          v-for="(meta, key) in STATUS_META"
          :key="key"
          :color="meta.color"
          variant="subtle"
          :title="meta.explain"
        >
          {{ meta.label }} · {{ grouped[key] }}
        </UBadge>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[40rem] text-sm">
          <caption class="sr-only">
            Provenance of every claim the rate package encodes
          </caption>
          <thead>
            <tr class="text-xs uppercase text-dimmed">
              <th scope="col" class="py-1.5 pr-3 text-left font-medium">Claim</th>
              <th scope="col" class="px-3 py-1.5 text-left font-medium">Status</th>
              <th scope="col" class="py-1.5 pl-3 text-left font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in PROVENANCE_ROWS" :key="row.claim" class="border-t border-default align-top">
              <td class="py-2 pr-3">
                <p class="text-highlighted">{{ row.claim }}</p>
                <p class="mt-0.5 text-xs text-muted">{{ row.detail }}</p>
              </td>
              <td class="px-3 py-2">
                <UBadge :color="STATUS_META[row.status].color" variant="subtle" size="sm">
                  {{ STATUS_META[row.status].label }}
                </UBadge>
              </td>
              <td class="py-2 pl-3 text-xs text-muted">{{ row.source }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <HonestNote variant="contested">
        Radionics has never shown diagnostic or therapeutic efficacy under controlled conditions: the
        1923–24 Scientific American / AMA investigation of Abrams concluded the reactions "do not
        exist … at least objectively", and a 1950 AMA test of the Drown instrument "was completely
        negative". Rae's contribution here is an <em>encoding</em>, and that is the only thing this
        package reproduces. That a card imprints a remedy, acts at a distance, or means the same on
        another instrument is an esoteric claim: stated as a hypothesis, asserted nowhere, and not
        tested by anything on this page.
      </HonestNote>

      <div class="rounded-md border border-default bg-elevated/40 p-3">
        <p class="text-xs uppercase tracking-wide text-dimmed">Sources</p>
        <ul class="mt-2 flex flex-col gap-1.5 text-sm">
          <li v-for="link in SOURCE_LINKS" :key="link.href">
            <ULink :to="link.href" target="_blank" rel="noreferrer" class="text-primary">
              {{ link.label }}
            </ULink>
            <span class="text-muted"> — {{ link.note }}</span>
          </li>
          <li v-if="entry" class="text-muted">
            Printed sources are cited page by page in the
            <ULink :to="entry.readmeUrl" target="_blank" rel="noreferrer" class="text-primary">
              package README
            </ULink>
            and in
            <ULink :to="researchUrl(entry)" target="_blank" rel="noreferrer" class="text-primary">
              {{ entry.researchLabel }}
            </ULink>
            of the research notes.
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      "Printed sources" means the maintainers' ark-db document library (about 88,000 books and
      documents); "web-sourced" means practitioner pages quoting their own tradition. Where the
      sources are silent, the package parameterises rather than guesses — which is why every function
      takes the base explicitly.
    </template>
  </DemoSection>
</template>
