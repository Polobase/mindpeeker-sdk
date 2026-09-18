// Shared state for the rate page: the rate string, its base, the one-based
// label switch, and the parse result every section reads.
//
// CLIENT-ONLY: imports `@mindpeeker/rate`, so it may be imported only from
// `Rate*.client.vue` components (or modules those import). Never from a page.

import { formatRate, parseRate, type Rate, RateError } from '@mindpeeker/rate'
import { computed, type ComputedRef, ref } from 'vue'

export interface BaseOption {
  readonly value: number
  readonly label: string
  readonly note: string
}

/**
 * The two bases the sources actually describe: Rae's 44 and the base-10 dials
 * of the De La Warr / Copen instruments he replaced. Combe's "base 336" is a
 * digit sequence, not a radix, so it is deliberately absent.
 */
export const BASE_OPTIONS: readonly BaseOption[] = [
  { value: 44, label: '44 — Rae Magneto-Geometric card', note: '360/44 = 8.18° per step' },
  { value: 10, label: '10 — De La Warr / Copen dials', note: '360/10 = 36° per step' },
]

export const rateInput = ref('12-33-7')
export const rateBase = ref(44)
export const oneBased = ref(false)
/** Ring count for a random draw (real base-44 book rates run ~5 digits). */
export const ringCount = ref(5)

const parseResult = computed<{ rate?: Rate; error?: unknown }>(() => {
  const text = rateInput.value.trim()
  try {
    return { rate: parseRate(text, { base: rateBase.value, oneBased: oneBased.value }) }
  } catch (error) {
    // parseRate throws RateError; anything else would be a bug — surface both
    // through ErrorAlert rather than letting a computed throw during render.
    return { error }
  }
})

/** The parsed rate, or undefined while the input is malformed. */
export const parsedRate: ComputedRef<Rate | undefined> = computed(() => parseResult.value.rate)

/** The typed `RateError` for the current input, or undefined. */
export const rateProblem: ComputedRef<unknown> = computed(() => parseResult.value.error)

export const isRateError = (error: unknown): error is RateError => error instanceof RateError

/** Canonical dash form, the dot form, and the printed book form. */
export const rateForms = computed(() => {
  const rate = parsedRate.value
  if (!rate) return undefined
  return {
    canonical: formatRate(rate),
    dotted: formatRate(rate, { separator: '.' }),
    book: formatRate(rate, { oneBased: true, pad: true, separator: ' ' }),
  }
})

export interface RatePreset {
  readonly id: string
  readonly label: string
  readonly input: string
  readonly base: number
  readonly oneBased: boolean
  readonly note: string
}

/** Rates worth starting from — one real book rate, one dial rate, two extremes. */
export const PRESETS: readonly RatePreset[] = [
  {
    id: 'default',
    label: '12-33-7',
    input: '12-33-7',
    base: 44,
    oneBased: false,
    note: "the README's three-ring example, 0-based digits",
  },
  {
    id: 'combe',
    label: '01 04 19 27 28',
    input: '01-04-19-27-28',
    base: 44,
    oneBased: true,
    note: 'a real Combe base-44 book rate, printed 1..44 (spaces replaced by dashes)',
  },
  {
    id: 'delawarr',
    label: '1-1-1-4-8 (base 10)',
    input: '1-1-1-4-8',
    base: 10,
    oneBased: false,
    note: 'a De La Warr-style base-10 dial rate',
  },
  {
    id: 'aligned',
    label: '7-7-7-7-7',
    input: '7-7-7-7-7',
    base: 44,
    oneBased: false,
    note: 'every ring on one angle — resultant length exactly 1',
  },
  {
    id: 'balanced',
    label: '0-11-22-33',
    input: '0-11-22-33',
    base: 44,
    oneBased: false,
    note: 'four equally spaced angles — resultant length exactly 0',
  },
]

/** Malformed inputs worth clicking: each raises a typed `RateError`. */
export interface SeparatorCase {
  readonly id: string
  readonly input: string
  readonly valid: boolean
  readonly why: string
}

export const SEPARATOR_CASES: readonly SeparatorCase[] = [
  { id: 'dash', input: '12-33-7', valid: true, why: 'dashes — the canonical form' },
  { id: 'dot', input: '12.33.7', valid: true, why: 'dots — the same rate' },
  { id: 'bare', input: '7', valid: true, why: 'a single bare digit is a one-ring rate' },
  { id: 'space', input: '12 33 7', valid: false, why: 'spaces are not a separator' },
  { id: 'mixed', input: '12-33.7', valid: false, why: 'one kind of separator per rate' },
  { id: 'range', input: '12-44-7', valid: false, why: '44 is out of range for 0-based base 44' },
  { id: 'empty', input: '12--7', valid: false, why: 'an empty digit group' },
]

export function applyPreset(preset: { input: string; base: number; oneBased: boolean }): void {
  rateBase.value = preset.base
  oneBased.value = preset.oneBased
  rateInput.value = preset.input
}

/** Write drawn digits into the input, respecting the one-based label switch. */
export function setDigits(digits: readonly number[]): void {
  rateInput.value = digits.map((d) => (oneBased.value ? d + 1 : d)).join('-')
}
