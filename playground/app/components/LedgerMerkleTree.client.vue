<script setup lang="ts">
/**
 * The RFC 6962 tree as responsive SVG: leaves at the bottom, the root on top,
 * the audit path for the selected leaf highlighted. Theme-aware through the
 * --viz-* variables the shared charts use.
 */
import { useElementWidth, vizColor } from '~/lib/chart'
import { hasRef, type NodeRef, refSet, type TreeLayout } from '~/lib/ledger/merkle'

const props = withDefaults(
  defineProps<{
    layout: TreeLayout
    /** The leaf whose inclusion is being proven. */
    selected?: number
    /** Sibling hashes of the audit path. */
    proof?: readonly NodeRef[]
    /** Nodes recomputed from the leaf up to the root. */
    climb?: readonly NodeRef[]
    height?: number
  }>(),
  { selected: undefined, proof: () => [], climb: () => [], height: 260 },
)

const wrapper = ref<HTMLDivElement>()
const width = useElementWidth(wrapper, 720)

const proofSet = computed(() => refSet([...props.proof]))
const climbSet = computed(() => refSet([...props.climb]))

const PAD_X = 10
const PAD_TOP = 14
const PAD_BOTTOM = 28

interface Drawn {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly level: number
  readonly index: number
  readonly hex: string
  readonly start: number
  readonly end: number
  readonly kind: 'proof' | 'climb' | 'leaf' | 'plain'
}

const geometry = computed(() => {
  const levels = props.layout.levels
  const n = Math.max(1, props.layout.size)
  const innerWidth = Math.max(240, width.value) - PAD_X * 2
  const rowHeight = (props.height - PAD_TOP - PAD_BOTTOM) / Math.max(1, levels.length - 1 || 1)
  const slot = innerWidth / n
  const nodes: Drawn[] = []
  const edges: { x1: number; y1: number; x2: number; y2: number; active: boolean }[] = []
  const centre = (level: number, index: number): { x: number; y: number; w: number } => {
    const node = levels[level]?.[index]
    const start = node?.start ?? 0
    const end = node?.end ?? 0
    const w = Math.max(10, (end - start) * slot - 6)
    return {
      x: PAD_X + start * slot + ((end - start) * slot) / 2,
      y: PAD_TOP + (levels.length - 1 - level) * rowHeight,
      w,
    }
  }
  levels.forEach((row, level) => {
    row.forEach((node, index) => {
      const { x, y, w } = centre(level, index)
      const kind = hasRef(proofSet.value, level, index)
        ? 'proof'
        : hasRef(climbSet.value, level, index)
          ? 'climb'
          : level === 0
            ? 'leaf'
            : 'plain'
      nodes.push({ x, y, w, level, index, hex: node.hex, start: node.start, end: node.end, kind })
      if (level > 0) {
        for (const child of [index * 2, index * 2 + 1]) {
          const below = levels[level - 1]?.[child]
          if (below === undefined || below.start < node.start || below.end > node.end) continue
          const from = centre(level - 1, child)
          edges.push({
            x1: from.x,
            y1: from.y,
            x2: x,
            y2: y,
            active:
              hasRef(climbSet.value, level, index) && hasRef(climbSet.value, level - 1, child),
          })
        }
      }
    })
  })
  return { nodes, edges, rowHeight, slot }
})

const colours = computed(() => ({
  proof: vizColor(2),
  climb: vizColor('primary'),
  leaf: vizColor('muted'),
  plain: vizColor('grid'),
  axis: vizColor('axis'),
}))

const hovered = ref<Drawn>()

const label = computed(() =>
  props.selected === undefined
    ? `RFC 6962 Merkle tree over ${props.layout.size} leaves`
    : `RFC 6962 Merkle tree over ${props.layout.size} leaves; the audit path for leaf ${props.selected} is highlighted`,
)
</script>

<template>
  <div ref="wrapper" class="w-full min-w-0">
    <svg
      :viewBox="`0 0 ${Math.max(240, width)} ${height}`"
      :height="height"
      class="w-full"
      role="img"
      :aria-label="label"
    >
      <line
        v-for="(edge, i) in geometry.edges"
        :key="`e${i}`"
        :x1="edge.x1"
        :y1="edge.y1"
        :x2="edge.x2"
        :y2="edge.y2"
        :stroke="edge.active ? colours.climb : colours.plain"
        :stroke-width="edge.active ? 2 : 1"
        :opacity="edge.active ? 0.9 : 0.5"
      />
      <g v-for="node in geometry.nodes" :key="`${node.level}:${node.index}`">
        <rect
          :x="node.x - node.w / 2"
          :y="node.y - 9"
          :width="node.w"
          :height="18"
          rx="4"
          :fill="
            node.kind === 'proof'
              ? colours.proof
              : node.kind === 'climb'
                ? colours.climb
                : 'transparent'
          "
          :fill-opacity="node.kind === 'proof' || node.kind === 'climb' ? 0.22 : 1"
          :stroke="
            node.kind === 'proof'
              ? colours.proof
              : node.kind === 'climb'
                ? colours.climb
                : colours.plain
          "
          :stroke-width="node.kind === 'plain' || node.kind === 'leaf' ? 1 : 1.8"
          tabindex="0"
          :aria-label="`level ${node.level} node covering leaves ${node.start} to ${node.end - 1}, hash ${node.hex.slice(0, 8)}`"
          class="cursor-pointer focus:outline-none"
          @pointerenter="hovered = node"
          @pointerleave="hovered = undefined"
          @focus="hovered = node"
          @blur="hovered = undefined"
        />
        <text
          v-if="node.w > 34"
          :x="node.x"
          :y="node.y + 3.5"
          text-anchor="middle"
          :fill="colours.axis"
          font-size="9"
          font-family="ui-monospace, monospace"
        >
          {{ node.hex.slice(0, node.w > 70 ? 8 : 4) }}
        </text>
      </g>
      <text
        v-for="node in geometry.nodes.filter((n) => n.level === 0 && geometry.slot > 22)"
        :key="`l${node.index}`"
        :x="node.x"
        :y="height - 12"
        text-anchor="middle"
        :fill="colours.axis"
        font-size="10"
        font-family="ui-monospace, monospace"
      >
        {{ node.index }}
      </text>
    </svg>
    <p class="text-[11px] text-muted mt-1 min-h-8">
      <span v-if="hovered" class="font-mono break-all">
        level {{ hovered.level }} · leaves [{{ hovered.start }}, {{ hovered.end }}) ·
        {{ hovered.hex }}
      </span>
      <span v-else>
        Hover or tab a node for its full hash. Amber = the audit path
        <code>inclusionProof({{ selected ?? 0 }})</code> hands the verifier; blue = the nodes the
        verifier recomputes from the leaf up to the root.
      </span>
    </p>
  </div>
</template>
