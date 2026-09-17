/**
 * Pure directory reconciliation for the panel grid: which panels to drop,
 * which to create, in what order, and how many grid columns — no DOM, so it is
 * unit-tested headlessly while `mount.ts` applies the plan.
 */
import type { ChannelInfo, ChannelKind } from '../src/types.js'
import { fitColumns } from './math.js'

/** What identifies a mounted panel: a channel id keeps its panel while name and kind match. */
export interface SlotIdentity {
  readonly name: string
  readonly kind: ChannelKind
}

/** One directory entry in display order. */
export interface PlannedEntry {
  readonly info: ChannelInfo
  /** `true` when no reusable panel exists for this id. */
  readonly create: boolean
}

/** The reconciliation of mounted slots against a new directory. */
export interface DirectoryPlan {
  /** Mounted ids whose channel vanished or changed name/kind. */
  readonly remove: readonly number[]
  /** Directory entries in order (a repeated id keeps its first position, last entry wins). */
  readonly entries: readonly PlannedEntry[]
  /** Final grid column count — known before any panel is created or sized. */
  readonly columns: number
}

/**
 * Plan how mounted slots (`id → identity`) become the channels of a new
 * directory; `containerWidth` (CSS pixels, 0 when unknown) caps the columns.
 */
export function planDirectory(
  mounted: ReadonlyMap<number, SlotIdentity>,
  channels: readonly ChannelInfo[],
  containerWidth = 0,
): DirectoryPlan {
  const incoming = new Map<number, ChannelInfo>()
  for (const info of channels) incoming.set(info.id, info)
  const remove: number[] = []
  for (const [id, slot] of mounted) {
    const next = incoming.get(id)
    if (!next || next.name !== slot.name || next.kind !== slot.kind) remove.push(id)
  }
  const removed = new Set(remove)
  const entries = [...incoming.values()].map((info) => ({
    info,
    create: !mounted.has(info.id) || removed.has(info.id),
  }))
  return { remove, entries, columns: fitColumns(incoming.size, containerWidth) }
}
