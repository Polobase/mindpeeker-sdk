<script setup lang="ts">
useHead({ title: 'Fifteen packages, one honest pipeline' })

const news = [
  {
    icon: 'i-lucide-shield-alert',
    title: 'A security fix in @mindpeeker/vdf',
    body:
      'The 0.1.0 verifier accepted the negated output n − y together with a re-derived proof, so whoever computed a seal could choose between two values that both verified. 0.2.0 computes in the signed quadratic residues QR_N+ and rejects anything else. Every output, proof and seal stored under 0.1.0 must be recomputed.',
    to: '/vdf',
    cta: 'Open the VDF demo',
  },
  {
    icon: 'i-lucide-sigma',
    title: 'Statistical correctness fixes',
    body:
      "scan's deviation p is now an exact binomial tail (the old normal tail crossed 0.05 on 7.7% of fair runs at N = 16); field's void p was ≤ 0.05 on 88.5–100% of random fields and is now calibrated; negentropy's χ² tail no longer throws at GCP scale; psi's rollingNetvar floor and gematria's reverse alphabets are corrected.",
    to: '/scan',
    cta: 'See the honest null',
  },
  {
    icon: 'i-lucide-package-plus',
    title: 'Four new packages',
    body:
      'ledger (tamper-evident records), coincidence (exact coincidence probabilities), ephemeris (time, sky and the sidereal-time scan) and judging (exact scoring for forced-choice and free-response designs).',
    to: '/ledger',
    cta: 'Start with ledger',
  },
]
</script>

<template>
  <UContainer class="py-10 sm:py-16">
    <section class="border-b border-default pb-10">
      <p class="font-mono text-sm uppercase tracking-widest text-primary">
        mindpeeker-sdk {{ SDK_VERSION }}
      </p>
      <h1 class="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-highlighted max-w-4xl">
        Rigorous randomness, frontier questions, honest statistics — running in your browser.
      </h1>
      <p class="mt-4 max-w-3xl text-lg text-muted">
        Fifteen TypeScript packages: entropy sources with health tests, order detection with
        anytime-valid boundaries, experiment protocols with control arms, exact symbolic mappings,
        and tamper-evident records. Every demo below draws live from your browser's CSPRNG — or the
        beacon, quantum source or seeded DRBG you pick in the header — with no server.
      </p>
      <div class="mt-6 flex flex-wrap gap-3">
        <UButton to="#packages" size="lg" trailing-icon="i-lucide-arrow-down">
          Explore the 15 demos
        </UButton>
        <UButton
          :to="RESEARCH_URL"
          target="_blank"
          rel="noreferrer"
          size="lg"
          color="neutral"
          variant="outline"
          icon="i-lucide-flask-conical"
        >
          Read the research notes
        </UButton>
        <UButton
          :to="REPO_URL"
          target="_blank"
          rel="noreferrer"
          size="lg"
          color="neutral"
          variant="ghost"
          icon="i-lucide-github"
        >
          Source on GitHub
        </UButton>
      </div>
    </section>

    <section class="mt-10">
      <h2 class="text-sm uppercase tracking-wider text-muted border-s-2 border-primary ps-2">
        What's new in {{ SDK_VERSION }}
      </h2>
      <div class="mt-4 grid gap-4 md:grid-cols-3">
        <div
          v-for="item in news"
          :key="item.title"
          class="flex flex-col rounded-lg border border-default bg-elevated/40 p-4"
        >
          <UIcon :name="item.icon" class="size-5 text-primary" />
          <h3 class="mt-2 font-semibold text-highlighted">{{ item.title }}</h3>
          <p class="mt-2 text-sm text-muted flex-1">{{ item.body }}</p>
          <UButton
            :to="item.to"
            class="mt-3 self-start"
            size="xs"
            variant="soft"
            trailing-icon="i-lucide-arrow-right"
          >
            {{ item.cta }}
          </UButton>
        </div>
      </div>
      <p class="mt-3 text-sm text-muted">
        None of these fixes makes an anomaly more or less likely to be real. They make the reported
        p-values and Bayes factors mean what their documentation says under the stated null models —
        the full list is in
        <ULink :to="RELEASES_URL" target="_blank" rel="noreferrer" class="text-primary">RELEASES.md</ULink>.
      </p>
    </section>

    <section class="mt-10">
      <HonestNote variant="exact" title="How to read everything on this site">
        <p>
          The mathematics is asserted: exact probabilities, exact p-values under stated null models,
          exact integer ciphers, cryptography specified byte for byte. The contested hypotheses are
          not: mind–matter interaction, radionics, the meaning of a divination draw and
          sidereal-time effects are stated as hypotheses and never as results. A small p-value here
          says the data are unusual under a stated null model — nothing more. The seeded DRBG source
          in the header makes any demo reproducible, which is what a control arm needs.
        </p>
      </HonestNote>
    </section>

    <section id="packages" class="mt-12 scroll-mt-20">
      <div v-for="group in GROUPS" :key="group.id" :id="group.id" class="mt-10 scroll-mt-20 first:mt-0">
        <h2 class="flex flex-wrap items-baseline gap-x-3 text-sm uppercase tracking-wider text-muted border-s-2 border-primary ps-2">
          <span class="inline-flex items-center gap-1.5 text-highlighted">
            <UIcon :name="group.icon" class="size-4" />
            {{ group.label }}
          </span>
          <span class="normal-case tracking-normal">{{ group.description }}</span>
        </h2>
        <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NuxtLink
            v-for="entry in packagesInGroup(group.id)"
            :key="entry.id"
            :to="`/${entry.id}`"
            class="group flex flex-col rounded-lg border border-default bg-default/60 p-4 transition hover:border-primary hover:bg-elevated/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div class="flex items-center gap-2">
              <UIcon :name="entry.icon" class="size-5 text-primary" />
              <span class="font-semibold text-highlighted">{{ entry.title }}</span>
              <UBadge v-if="entry.isNew" size="sm" color="primary" variant="subtle">new</UBadge>
            </div>
            <p class="mt-1 font-mono text-xs text-primary">{{ entry.pkg }}</p>
            <p class="mt-2 text-sm text-muted">{{ entry.tagline }}</p>
            <ul class="mt-3 space-y-1">
              <li
                v-for="item in entry.highlights.slice(0, 2)"
                :key="item"
                class="flex gap-1.5 text-xs text-dimmed"
              >
                <UIcon name="i-lucide-check" class="size-3.5 shrink-0 mt-0.5" />
                <span>{{ item }}</span>
              </li>
            </ul>
            <span
              class="mt-3 inline-flex items-center gap-1 text-sm text-primary group-hover:gap-2 transition-all"
            >
              Open demo
              <UIcon name="i-lucide-arrow-right" class="size-4" />
            </span>
          </NuxtLink>
        </div>
      </div>
    </section>

    <section class="mt-12 grid gap-4 sm:grid-cols-3">
      <ULink
        :to="RESEARCH_URL"
        target="_blank"
        rel="noreferrer"
        class="rounded-lg border border-default p-4 hover:border-primary"
      >
        <UIcon name="i-lucide-flask-conical" class="size-5 text-primary" />
        <p class="mt-2 font-semibold text-highlighted">Research notes ↗</p>
        <p class="mt-1 text-sm text-muted">
          Fourteen sections: what each package measures, the literature behind it, and what would
          count as evidence.
        </p>
      </ULink>
      <ULink
        :to="COOKBOOK_URL"
        target="_blank"
        rel="noreferrer"
        class="rounded-lg border border-default p-4 hover:border-primary"
      >
        <UIcon name="i-lucide-chef-hat" class="size-5 text-primary" />
        <p class="mt-2 font-semibold text-highlighted">Cookbook ↗</p>
        <p class="mt-1 text-sm text-muted">
          Twelve runnable cross-package recipes, each with its output and what it cannot mean.
        </p>
      </ULink>
      <ULink
        :to="RELEASES_URL"
        target="_blank"
        rel="noreferrer"
        class="rounded-lg border border-default p-4 hover:border-primary"
      >
        <UIcon name="i-lucide-file-text" class="size-5 text-primary" />
        <p class="mt-2 font-semibold text-highlighted">Release notes ↗</p>
        <p class="mt-1 text-sm text-muted">
          Everything 0.2.0 changed, including the upgrade guide and the publish order.
        </p>
      </ULink>
    </section>
  </UContainer>
</template>
