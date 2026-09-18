<script setup lang="ts">
/**
 * §3 — RFC 6962: the tree over a log, an O(log n) inclusion proof for one
 * line, and a consistency proof that a later tree only appended to an earlier
 * one. Both failure cases are run, not described.
 */
import {
  HASH_BYTES,
  merkleRoot,
  type MerkleTree,
  merkleTree,
  toHex,
  verifyConsistency,
  verifyInclusion,
} from '@mindpeeker/ledger'
import {
  climbRefs,
  defaultLeaves,
  inclusionRefs,
  type NodeRef,
  treeLayout,
  type TreeLayout,
} from '~/lib/ledger/merkle'

const MAX_DRAWN = 16

const text = ref(defaultLeaves(8).join('\n'))
const leaves = computed(() =>
  text.value.split('\n').map((line) => line.trimEnd()).filter((line) => line !== ''),
)
const size = computed(() => leaves.value.length)

const selected = ref(3)
const tamperLeaf = ref(false)
const checkpointAt = ref(5)
const rewriteHistory = ref(false)

watch(size, (n) => {
  if (selected.value >= n) selected.value = Math.max(0, n - 1)
  if (checkpointAt.value > n) checkpointAt.value = Math.max(1, n)
})

function grow(): void {
  const n = size.value
  text.value = `${text.value.replace(/\n+$/, '')}\n${defaultLeaves(n + 4).slice(n).join('\n')}`
}

function reset(): void {
  text.value = defaultLeaves(8).join('\n')
  selected.value = 3
  checkpointAt.value = 5
  tamperLeaf.value = false
  rewriteHistory.value = false
}

interface Report {
  readonly tree: MerkleTree
  readonly layout: TreeLayout
  readonly rootHex: string
  readonly emptyRoot: string
  readonly proof: readonly Uint8Array[]
  readonly proofRefs: readonly NodeRef[]
  readonly climb: readonly NodeRef[]
  readonly included: boolean
  readonly forged: boolean
  readonly sizeProbe: readonly { size: number; ok: boolean }[]
  readonly consistency: readonly Uint8Array[]
  readonly consistent: boolean
  readonly earlierRootHex: string
  readonly checked: number
}

const report = shallowRef<Report>()
const error = ref<unknown>()

// Editing the log fires this faster than the hashes resolve; newest run wins.
let seq = 0
watch(
  [leaves, selected, tamperLeaf, checkpointAt, rewriteHistory],
  () => {
    const mine = ++seq
    void (async () => {
      const lines = leaves.value
      if (lines.length === 0) {
        report.value = undefined
        return
      }
      try {
        const index = Math.min(selected.value, lines.length - 1)
        const m = Math.min(Math.max(1, checkpointAt.value), lines.length)
        const tree = await merkleTree(lines)
        const layout = await treeLayout(lines)
        const proof = tree.inclusionProof(index)
        const leaf = lines[index] as string
        const [included, forged] = await Promise.all([
          verifyInclusion(leaf, index, tree.size, proof, tree.root),
          verifyInclusion(`${leaf} (edited)`, index, tree.size, proof, tree.root),
        ])
        const probeSizes = [tree.size, tree.size + 1, tree.size + 2, tree.size + 3]
        const sizeProbe = await Promise.all(
          probeSizes.map(async (stated) => ({
            size: stated,
            ok: await verifyInclusion(leaf, index, stated, proof, tree.root),
          })),
        )
        // The earlier checkpoint: the tree of the first m lines, optionally
        // over a history that was quietly rewritten before that checkpoint.
        const earlier = rewriteHistory.value
          ? lines.slice(0, m).map((line, i) => (i === Math.min(1, m - 1) ? `${line} (rewritten)` : line))
          : lines.slice(0, m)
        const earlierRoot = await merkleRoot(earlier)
        const consistency = tree.consistencyProof(m)
        const consistent = await verifyConsistency(m, tree.size, earlierRoot, tree.root, consistency)
        if (mine !== seq) return
        report.value = {
          tree,
          layout,
          rootHex: toHex(tree.root),
          emptyRoot: toHex(await merkleRoot([])),
          proof,
          proofRefs: inclusionRefs(index, tree.size),
          climb: climbRefs(index, tree.size),
          included,
          forged,
          sizeProbe,
          consistency,
          consistent,
          earlierRootHex: toHex(earlierRoot),
          checked: index,
        }
        error.value = undefined
      } catch (thrown) {
        if (mine !== seq) return
        error.value = thrown
        report.value = undefined
      }
    })()
  },
  { immediate: true },
)

const ceilLog2 = computed(() => Math.ceil(Math.log2(Math.max(1, size.value))))

const proofRows = computed(() => {
  const current = report.value
  if (!current) return []
  return current.proof.map((hash, i) => {
    const ref = current.proofRefs[i]
    const node = ref === undefined ? undefined : current.layout.levels[ref.level]?.[ref.index]
    return {
      step: i,
      hex: toHex(hash),
      level: ref?.level ?? 0,
      covers: node === undefined ? '—' : `[${node.start}, ${node.end})`,
    }
  })
})

const snippet = computed(
  () => `import { merkleRoot, merkleTree, verifyConsistency, verifyInclusion } from '@mindpeeker/ledger'

const tree = await merkleTree(lines)              // ${size.value} leaves, root ${(report.value?.rootHex ?? '').slice(0, 12)}…
const proof = tree.inclusionProof(${selected.value})               // ${report.value?.proof.length ?? 0} sibling hashes

// checkpoint.size and checkpoint.root come from a SIGNED checkpoint, never from
// whoever handed you the proof — that is the whole point of the next tab.
await verifyInclusion(lines[${selected.value}], ${selected.value}, checkpoint.size, proof, checkpoint.root)
// → ${String(report.value?.included ?? false)}

const earlierRoot = await merkleRoot(lines.slice(0, ${checkpointAt.value}))   // what the earlier checkpoint signed
const consistency = tree.consistencyProof(${checkpointAt.value})     // ${report.value?.consistency.length ?? 0} hashes
await verifyConsistency(${checkpointAt.value}, ${size.value}, earlierRoot, tree.root, consistency)
// → ${String(report.value?.consistent ?? false)}`,
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <DemoSection
      id="merkle"
      title="The tree over the log"
      description="leaf(d) = SHA-256(0x00 ‖ d) and node(L, R) = SHA-256(0x01 ‖ L ‖ R): the distinct prefixes stop a leaf passing as an interior node. Pairs are formed left to right and an unpaired last node is promoted unchanged, which is exactly the RFC recursion. Edit the lines below and the whole tree rehashes."
      :api="['merkleTree', 'merkleRoot', 'leafHash', 'nodeHash', 'HASH_BYTES']"
    >
      <template #controls>
        <UButton size="sm" variant="soft" icon="i-lucide-plus" @click="grow">Add 4 lines</UButton>
        <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-rotate-ccw" @click="reset">
          Reset
        </UButton>
        <UFormField label="Prove leaf" size="sm" class="w-28">
          <UInputNumber
            v-model="selected"
            :min="0"
            :max="Math.max(0, size - 1)"
            size="sm"
            class="w-full"
          />
        </UFormField>
      </template>

      <ErrorAlert :err="error" title="The tree could not be built" :dismissible="false" />

      <div class="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div class="flex flex-col gap-2 min-w-0">
          <label for="ledger-leaves" class="text-xs uppercase tracking-wide text-muted">
            the log — one leaf per line
          </label>
          <UTextarea
            id="ledger-leaves"
            v-model="text"
            :rows="10"
            class="w-full font-mono text-[11px]"
            spellcheck="false"
          />
          <StatTile label="Merkle root (MTH)" size="sm">
            <template #value>
              <span class="block text-[11px] break-all leading-relaxed">
                {{ report?.rootHex ?? '—' }}
              </span>
            </template>
            <template #note>{{ size }} leaves · the empty tree hashes to SHA-256("")</template>
          </StatTile>
          <p class="text-[11px] text-dimmed font-mono break-all">
            merkleRoot([]) = {{ report?.emptyRoot ?? '—' }}
          </p>
        </div>

        <div class="min-w-0">
          <LedgerMerkleTree
            v-if="report && size <= MAX_DRAWN"
            :layout="report.layout"
            :selected="selected"
            :proof="report.proofRefs"
            :climb="report.climb"
          />
          <p v-else-if="report" class="text-sm text-muted">
            {{ size }} leaves is more than the diagram draws legibly ({{ MAX_DRAWN }}); the proofs
            below are still computed over the whole tree.
          </p>
        </div>
      </div>
    </DemoSection>

    <DemoSection
      id="inclusion"
      title="One line, proven in log n hashes"
      description="An inclusion proof is the sibling hashes from the leaf up to the root. A verifier who holds the line, its index, the tree size and the published root recomputes the root and compares — no part of the log is needed."
      :api="['inclusionProof', 'verifyInclusion']"
      :level="2"
    >
      <template #controls>
        <UFormField label="Edit the line before checking it" size="sm">
          <USwitch v-model="tamperLeaf" />
        </UFormField>
      </template>

      <div v-if="report" class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            size="sm"
            :color="(tamperLeaf ? report.forged : report.included) ? 'success' : 'error'"
            variant="subtle"
            :icon="(tamperLeaf ? report.forged : report.included) ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
          >
            verifyInclusion → {{ String(tamperLeaf ? report.forged : report.included) }}
          </UBadge>
          <UBadge size="sm" color="neutral" variant="subtle">
            {{ report.proof.length }} hashes · ⌈log₂ {{ size }}⌉ = {{ ceilLog2 }}
          </UBadge>
          <UBadge size="sm" color="neutral" variant="subtle">
            {{ report.proof.length * HASH_BYTES }} bytes of proof for a log of {{ size }} lines
          </UBadge>
        </div>

        <div class="rounded-md border border-default bg-elevated/40 p-3">
          <div class="text-[11px] uppercase tracking-wide text-muted">the line being proven</div>
          <code class="text-xs break-all text-highlighted">
            {{ leaves[selected] }}{{ tamperLeaf ? ' (edited)' : '' }}
          </code>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="text-muted uppercase">
              <tr>
                <th class="text-left py-1.5 pr-3 font-medium">step</th>
                <th class="text-left py-1.5 px-3 font-medium">level</th>
                <th class="text-left py-1.5 px-3 font-medium">covers leaves</th>
                <th class="text-left py-1.5 pl-3 font-medium">sibling hash</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in proofRows" :key="row.step" class="border-t border-default">
                <td class="py-1.5 pr-3 font-mono tabular-nums">{{ row.step }}</td>
                <td class="py-1.5 px-3 font-mono tabular-nums">{{ row.level }}</td>
                <td class="py-1.5 px-3 font-mono">{{ row.covers }}</td>
                <td class="py-1.5 pl-3 font-mono text-dimmed break-all">{{ row.hex }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="rounded-md border border-warning/40 bg-warning/5 p-3 flex flex-col gap-2">
          <div class="text-sm font-semibold text-highlighted">
            The same proof, with the size the caller states changed
          </div>
          <div class="flex flex-wrap gap-2">
            <UBadge
              v-for="probe in report.sizeProbe"
              :key="probe.size"
              size="sm"
              :color="probe.ok ? 'warning' : 'neutral'"
              variant="subtle"
              class="font-mono"
            >
              size {{ probe.size }} → {{ String(probe.ok) }}
            </UBadge>
          </div>
          <p class="text-xs text-muted">
            <code>verifyInclusion</code> takes the tree size from its caller, and every size that
            shares the audit path's shape accepts the very same proof against the very same root. A
            perfect tree is the lucky case — at 8 leaves only 8 passes. Press
            <strong class="text-highlighted">Add 4 lines</strong>: at 12 leaves the stated sizes 12,
            13, 14 and 15 all pass, so the proof says nothing about how big the log is. Take
            <code>(size, root)</code> from a signed checkpoint instead — that is what the next tab
            is for.
          </p>
        </div>
      </div>

      <template #footer>
        <HonestNote variant="caveat" title="What an inclusion proof does not say">
          It says the line is at that index of <em>some</em> tree with that root. It does not say the
          root was published when claimed, that the log operator did not also sign a second,
          diverging tree, or that anything in the line is true.
        </HonestNote>
      </template>
    </DemoSection>

    <DemoSection
      id="consistency"
      title="Append-only: the later tree extends the earlier one"
      description="A consistency proof shows that the tree of the first m leaves is a prefix of the tree of all n — so nothing published at the earlier checkpoint was rewritten. m = 0 and m > n are false by definition; m = n needs an empty proof and equal roots."
      :api="['consistencyProof', 'verifyConsistency', 'merkleRoot']"
      :level="2"
    >
      <template #controls>
        <UFormField label="Earlier checkpoint at m =" size="sm" class="w-36">
          <UInputNumber v-model="checkpointAt" :min="1" :max="size" size="sm" class="w-full" />
        </UFormField>
        <UFormField label="Rewrite a line before m" size="sm">
          <USwitch v-model="rewriteHistory" />
        </UFormField>
      </template>

      <div v-if="report" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            size="sm"
            :color="report.consistent ? 'success' : 'error'"
            variant="subtle"
            :icon="report.consistent ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
          >
            verifyConsistency({{ checkpointAt }}, {{ size }}) → {{ String(report.consistent) }}
          </UBadge>
          <UBadge size="sm" color="neutral" variant="subtle">
            {{ report.consistency.length }} hashes prove {{ checkpointAt }} → {{ size }}
          </UBadge>
          <UBadge v-if="rewriteHistory" size="sm" color="warning" variant="subtle">
            one line before the earlier checkpoint was changed
          </UBadge>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <StatTile label="Earlier root (size m)" size="sm">
            <template #value>
              <span class="block text-[11px] break-all">{{ report.earlierRootHex }}</span>
            </template>
            <template #note>what the earlier checkpoint signed</template>
          </StatTile>
          <StatTile label="Current root (size n)" size="sm">
            <template #value>
              <span class="block text-[11px] break-all">{{ report.rootHex }}</span>
            </template>
            <template #note>what the current checkpoint signs</template>
          </StatTile>
        </div>

        <CodeSnippet :code="snippet" title="what this section ran" />
      </div>

      <template #footer>
        <HonestNote variant="exact">
          Both proofs are exact and any conforming RFC 6962 implementation reproduces them: the
          package's tests check the roots and every proof for sizes 1–16 against an independent
          Python implementation of the RFC recursions, plus the reference roots and 196 verification
          probes of <code>transparency-dev/merkle</code>. What consistency buys is append-only
          <em>between checkpoints you actually collected</em> — a log that never published an earlier
          checkpoint has nothing to be consistent with.
        </HonestNote>
      </template>
    </DemoSection>
  </div>
</template>
