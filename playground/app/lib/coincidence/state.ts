// Shared state for the unequal-categories tab, so the vector editor and the
// non-uniformity lemma below it price the same distribution without prop
// plumbing through the tab container.
//
// CLIENT-ONLY: `parseVector` imports `@mindpeeker/coincidence`, so this module
// may only be imported from `Coincidence*.client.vue` components.

import type { NonUniformMethod } from '@mindpeeker/coincidence'
import { computed, type ComputedRef, reactive } from 'vue'
import { parseVector, type ParsedVector } from './vectors'
import { distributionPreset } from './presets'

export interface UnequalState {
  /** The preset that filled the field, or 'custom' once it is edited. */
  presetId: string
  /** Counts or probabilities, whitespace separated — the single source of truth. */
  text: string
  /** Draws. */
  n: number
  method: 'auto' | NonUniformMethod
}

export const unequal = reactive<UnequalState>({
  presetId: 'readme',
  text: distributionPreset('readme')?.text() ?? '0.5 0.25 0.125 0.125',
  n: 3,
  method: 'auto',
})

/** The parsed vector every section of the tab reads. */
export const unequalVector: ComputedRef<ParsedVector> = computed(() => parseVector(unequal.text))

/** Load a preset into the field (and remember which one it was). */
export function loadDistribution(id: string): void {
  const preset = distributionPreset(id)
  if (!preset) return
  unequal.presetId = id
  unequal.text = preset.text()
}
