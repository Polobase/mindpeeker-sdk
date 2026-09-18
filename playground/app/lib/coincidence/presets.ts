// What a "category" is on this page, and a few histograms worth pricing.
//
// The equal-category presets only fix c; the non-uniform presets produce the
// text that goes into the editable vector field, so what is priced is always
// visible and editable. The gematria preset is the real value histogram of the
// bundled Hebrew lexicon — the distribution cookbook recipe 6 prices.

import { collisionProfile } from '@mindpeeker/gematria'
import { defaultLexicon } from '@mindpeeker/gematria/lexicon'

export interface CategoryPreset {
  readonly id: string
  readonly label: string
  /** Equally likely categories. */
  readonly c: number
  /** What one draw is, for the prose. */
  readonly draw: string
  readonly note: string
}

/** Category counts a reader of this SDK actually meets. */
export const CATEGORY_PRESETS: readonly CategoryPreset[] = [
  {
    id: 'days',
    label: 'Days of the year — 365',
    c: 365,
    draw: 'person',
    note: 'the classic problem; real birthdays are not uniform, which only makes matches cheaper',
  },
  { id: 'months', label: 'Months — 12', c: 12, draw: 'person', note: 'the same arithmetic, coarser' },
  {
    id: 'hexagrams',
    label: 'I Ching hexagrams — 64',
    c: 64,
    draw: 'cast',
    note: 'a repeated hexagram in ten casts has probability 0.5232',
  },
  { id: 'cards', label: 'Playing cards — 52', c: 52, draw: 'draw', note: 'with replacement' },
  { id: 'tarot', label: 'Tarot cards — 78', c: 78, draw: 'card', note: 'one card, with replacement' },
  { id: 'runes', label: 'Elder Futhark runes — 24', c: 24, draw: 'draw', note: 'one rune' },
  { id: 'odu', label: 'Ifá odù — 256', c: 256, draw: 'cast', note: 'one of 256 figures' },
  {
    id: 'geomancy',
    label: 'Geomantic figures — 16',
    c: 16,
    draw: 'figure',
    note: 'not equally likely in a real shield chart — this is the idealized draw',
  },
  {
    id: 'gematria-values',
    label: 'Gematria values in the bundled lexicon — 115',
    c: 115,
    draw: 'word',
    note: 'if the 115 distinct values were equally likely; they are not — see the next tab',
  },
  {
    id: 'lotto',
    label: 'Lottery combinations 6/49 — 13,983,816',
    c: 13_983_816,
    draw: 'ticket',
    note: 'two tickets in the same draw; 4,404 tickets give even odds of a duplicate',
  },
]

export function categoryPreset(id: string): CategoryPreset | undefined {
  return CATEGORY_PRESETS.find((preset) => preset.id === id)
}

export interface DistributionPreset {
  readonly id: string
  readonly label: string
  readonly note: string
  /** Text for the editable vector field: counts or probabilities. */
  text: () => string
}

function uniformCounts(c: number): string {
  return Array.from({ length: c }, () => '1').join(' ')
}

function zipfCounts(c: number, exponent: number): string {
  return Array.from({ length: c }, (_, i) => Math.max(1, Math.round(1000 / (i + 1) ** exponent)))
    .map(String)
    .join(' ')
}

let lexiconCounts: string | undefined

/**
 * The real value histogram of the bundled Sepher Sephiroth under Hechrachi:
 * 160 words over 115 distinct values, q = 27/2560 ≈ 0.0105.
 */
export function gematriaHistogramText(): string {
  if (lexiconCounts !== undefined) return lexiconCounts
  const profile = collisionProfile(defaultLexicon('he-hechrachi'), 'he-hechrachi')
  const text = profile.histogram.map((bin) => bin.count).join(' ')
  lexiconCounts = text
  return text
}

/** Summary numbers of that same profile, for the prose next to the vector. */
export function gematriaProfileSummary(): {
  n: number
  distinct: number
  collisionProbability: number
  collisionEntropyBits: number
  observedEqualPairs: number
  birthdayBound50: number
} {
  const profile = collisionProfile(defaultLexicon('he-hechrachi'), 'he-hechrachi')
  return {
    n: profile.n,
    distinct: profile.distinct,
    collisionProbability: profile.collisionProbability,
    collisionEntropyBits: profile.collisionEntropyBits,
    observedEqualPairs: profile.observedEqualPairs,
    birthdayBound50: profile.birthdayBound50,
  }
}

export const DISTRIBUTION_PRESETS: readonly DistributionPreset[] = [
  {
    id: 'readme',
    label: 'The README’s four categories — ½, ¼, ⅛, ⅛',
    note: 'three draws match with probability 0.7421875; four equal categories would give 0.625',
    text: () => '0.5 0.25 0.125 0.125',
  },
  {
    id: 'gematria',
    label: 'Gematria value histogram — 160 Hebrew words, 115 values',
    note: 'counts per value from `collisionProfile` — the distribution cookbook recipe 6 prices',
    text: gematriaHistogramText,
  },
  {
    id: 'uniform365',
    label: 'Uniform — 365 equal days',
    note: 'the flat reference: exactly the birthday problem, and the cheapest coincidences possible',
    text: () => uniformCounts(365),
  },
  {
    id: 'zipf',
    label: 'Zipf-like — 200 categories, exponent 1',
    note: 'a word-frequency shape: heavy head, long tail, matches far cheaper than 200 equal bins',
    text: () => zipfCounts(200, 1),
  },
  {
    id: 'zipf-half',
    label: 'Mildly uneven — 200 categories, exponent ½',
    note: 'between flat and Zipf: the same 200 bins, less mass in the head',
    text: () => zipfCounts(200, 0.5),
  },
  {
    id: 'hexagram-yarrow',
    label: 'I Ching lines under the yarrow stalks — 4 categories',
    note: 'the classic 1/16, 5/16, 7/16, 3/16 line odds: an unfair four-sided die',
    text: () => '0.0625 0.3125 0.4375 0.1875',
  },
]

export function distributionPreset(id: string): DistributionPreset | undefined {
  return DISTRIBUTION_PRESETS.find((preset) => preset.id === id)
}
