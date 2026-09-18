<script setup lang="ts">
/** Section 5 — fallback, xorMix and race, each with a member that is meant to
 * fail, plus the privacy algebra read off real composites. */
import { nextMacrotask } from '~/lib/async'
import {
  privacyAlgebra,
  runStrategy,
  STRATEGY_DEMOS,
  type StrategyDemo,
  type StrategyId,
  type StrategyOutcome,
} from '~/lib/entropy/strategies'
import { fmtDuration } from '~/lib/format'

const task = useTask<void>()
const outcomes = ref<Partial<Record<StrategyId, StrategyOutcome>>>({})
const running = ref<StrategyId | undefined>(undefined)

async function attempt(demo: StrategyDemo, signal: AbortSignal): Promise<void> {
  running.value = demo.id
  try {
    outcomes.value = { ...outcomes.value, [demo.id]: await runStrategy(demo, signal) }
  } finally {
    running.value = undefined
  }
}

function runOne(demo: StrategyDemo): void {
  void task.run(async (signal) => {
    await attempt(demo, signal)
  })
}

function runAll(): void {
  void task.run(async (signal, setProgress) => {
    for (const [i, demo] of STRATEGY_DEMOS.entries()) {
      setProgress(i / STRATEGY_DEMOS.length)
      await attempt(demo, signal)
      await nextMacrotask()
    }
    setProgress(1)
  })
}

const algebra = privacyAlgebra()
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      title="Combining strategies"
      :api="['fallback', 'xorMix', 'race', 'defineProvider']"
      description="Strategies implement the same EntropyProvider interface, so they nest arbitrarily. Each demo below includes a member built with defineProvider that is designed to fail or to stall, so you can see what the strategy does about it."
    >
      <template #controls>
        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          label="Run all six"
          busy-label="Combining…"
          icon="i-lucide-git-merge"
          hint="No network: the members are the local CSPRNG, seeded DRBGs and two deliberately broken providers. All six resolve in milliseconds — the race's 900 ms member loses and is aborted."
          @run="runAll"
          @cancel="task.cancel()"
        />
      </template>

      <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

      <div class="grid gap-4 xl:grid-cols-2">
        <div
          v-for="demo in STRATEGY_DEMOS"
          :key="demo.id"
          class="rounded-md border border-default p-3 flex flex-col gap-2"
        >
          <div class="flex items-start justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">{{ demo.title }}</h3>
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              icon="i-lucide-play"
              :loading="running === demo.id"
              :disabled="task.busy.value"
              @click="runOne(demo)"
            >
              Run
            </UButton>
          </div>
          <p class="text-sm text-muted">{{ demo.description }}</p>
          <p class="text-xs text-dimmed">
            <UIcon name="i-lucide-target" class="size-3 inline-block" /> expected:
            {{ demo.expect }}
          </p>

          <div
            v-if="outcomes[demo.id]"
            class="rounded border border-default bg-elevated/40 p-2 flex flex-col gap-1.5"
          >
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                size="sm"
                :color="outcomes[demo.id]?.ok ? 'success' : 'error'"
                variant="subtle"
              >
                {{ outcomes[demo.id]?.ok ? 'resolved' : outcomes[demo.id]?.code }}
              </UBadge>
              <span class="text-xs text-muted font-mono">
                {{ fmtDuration(outcomes[demo.id]?.ms ?? 0) }}
              </span>
              <UBadge size="sm" color="neutral" variant="outline">
                kind {{ outcomes[demo.id]?.kind }}
              </UBadge>
              <UBadge
                size="sm"
                :color="outcomes[demo.id]?.privacy === 'public' ? 'warning' : 'neutral'"
                variant="outline"
              >
                privacy {{ outcomes[demo.id]?.privacy }}
              </UBadge>
            </div>

            <code class="block font-mono text-[11px] break-all text-dimmed">
              {{ outcomes[demo.id]?.providerName }}
            </code>

            <template v-if="outcomes[demo.id]?.ok">
              <code class="block font-mono text-[11px] break-all text-highlighted">
                {{ outcomes[demo.id]?.hex }}
              </code>
              <p v-if="outcomes[demo.id]?.allZero" class="text-xs text-error">
                Every byte is zero — two identical members XORed themselves away. This is the case
                the guard cannot catch below 8 bytes.
              </p>
              <p class="text-xs text-muted">
                sources[]:
                <span
                  v-for="s in outcomes[demo.id]?.sources"
                  :key="s.name"
                  class="font-mono text-highlighted"
                >
                  {{ s.name }}
                </span>
              </p>
            </template>
            <template v-else>
              <p class="text-xs text-muted">{{ outcomes[demo.id]?.message }}</p>
              <ul v-if="outcomes[demo.id]?.causes" class="text-xs text-dimmed flex flex-col gap-0.5">
                <li v-for="line in outcomes[demo.id]?.causes" :key="line" class="font-mono break-all">
                  ↳ {{ line }}
                </li>
              </ul>
            </template>
          </div>

          <CodeSnippet :code="demo.code" />
        </div>
      </div>

      <template #footer>
        <code class="font-mono">xorMix</code> fails closed: if any member fails, the call fails —
        wrap it in <code class="font-mono">fallback</code> to degrade. When a strategy exhausts all
        members you get <code class="font-mono">insufficient_entropy</code> whose
        <code class="font-mono">cause</code> is an <code class="font-mono">AggregateError</code>
        holding each member's error in attempt order.
      </template>
    </DemoSection>

    <DemoSection
      title="The privacy algebra, read off real composites"
      :level="3"
      :api="['EntropyProvider.kind', 'EntropyProvider.privacy']"
      description="Constructing a strategy makes no network call, so these five composites are built live and simply asked what they are. XOR with at least one independent private member yields a private result; fallback and race must assume the worst, because you cannot know statically which member will serve."
    >
      <div class="overflow-x-auto rounded-md border border-default">
        <table class="w-full text-sm border-collapse">
          <caption class="sr-only">Composite kind and privacy per strategy expression</caption>
          <thead class="bg-elevated/60 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" class="text-left font-medium px-3 py-2">Expression</th>
              <th scope="col" class="text-left font-medium px-3 py-2">provider.name</th>
              <th scope="col" class="text-left font-medium px-3 py-2">kind</th>
              <th scope="col" class="text-left font-medium px-3 py-2">privacy</th>
              <th scope="col" class="text-left font-medium px-3 py-2">Rule</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in algebra" :key="row.expression" class="border-t border-default align-top">
              <td class="px-3 py-2 font-mono text-xs text-primary break-all">{{ row.expression }}</td>
              <td class="px-3 py-2 font-mono text-[11px] text-muted break-all">{{ row.name }}</td>
              <td class="px-3 py-2">
                <UBadge size="sm" color="neutral" variant="subtle">{{ row.kind }}</UBadge>
              </td>
              <td class="px-3 py-2">
                <UBadge
                  size="sm"
                  :color="row.privacy === 'public' ? 'warning' : 'success'"
                  variant="subtle"
                >
                  {{ row.privacy }}
                </UBadge>
              </td>
              <td class="px-3 py-2 text-xs text-muted">{{ row.rule }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <HonestNote variant="caveat" class="mt-4">
        The independence of the mixed sources is <strong>your</strong> assumption to keep: don't
        feed the same upstream in twice. <code class="font-mono">xorMix</code> only catches the
        blatant case — two members returning byte-identical results, and only from 8 bytes up,
        because below that independent sources collide too often to tell. Mixing a public beacon
        with an independent private source keeps the output private, but it does not make the
        beacon's bytes secret: they were published for everyone.
      </HonestNote>
    </DemoSection>
  </div>
</template>
