/**
 * Designs, decks and published studies used across the judging page.
 *
 * Pure data and pure functions — no SDK import, so this module is safe to pull
 * into any of the judging client components without dragging bytes around.
 */

export interface ZenerSymbol {
  readonly id: number
  readonly name: string
  readonly glyph: string
}

/** Rhine's five Zener symbols, in the order the deck vector [5,5,5,5,5] indexes them. */
export const ZENER_SYMBOLS: readonly ZenerSymbol[] = [
  { id: 0, name: 'Circle', glyph: '○' },
  { id: 1, name: 'Cross', glyph: '✚' },
  { id: 2, name: 'Waves', glyph: '≋' },
  { id: 3, name: 'Square', glyph: '□' },
  { id: 4, name: 'Star', glyph: '☆' },
]

export interface ChoicePreset {
  readonly id: string
  readonly label: string
  readonly choices: number
  /** What one trial is, in the design's own words. */
  readonly trial: string
  readonly note: string
}

/** The four forced-choice designs the README scores: ¼, ⅕, ⅙ and ½. */
export const CHOICE_PRESETS: readonly ChoicePreset[] = [
  {
    id: 'ganzfeld',
    label: 'Ganzfeld — one target among four clips (p₀ = ¼)',
    choices: 4,
    trial: 'session',
    note: 'the decoys are the other members of a randomly chosen packet, so p₀ = ¼ exactly whatever the receiver prefers',
  },
  {
    id: 'zener',
    label: 'Zener call — five symbols (p₀ = ⅕)',
    choices: 5,
    trial: 'call',
    note: 'exact only for independent draws; a shuffled 25-card pack is a closed deck with a different SD',
  },
  {
    id: 'dice',
    label: 'Die face — six faces (p₀ = ⅙)',
    choices: 6,
    trial: 'throw',
    note: 'targets must rotate over all six faces, or die bias alone produces hits (Radin & Ferrari 1991)',
  },
  {
    id: 'placement',
    label: 'Placement / two-way choice (p₀ = ½)',
    choices: 2,
    trial: 'trial',
    note: 'a die is willed to one half of the table; the two halves are symmetric, so chance is ½',
  },
]

export function choicePreset(id: string): ChoicePreset | undefined {
  return CHOICE_PRESETS.find((preset) => preset.id === id)
}

export interface StudyPreset {
  readonly id: string
  readonly label: string
  readonly hits: number
  readonly trials: number
  readonly choices: number
  readonly note: string
}

/**
 * Published counts whose Rhine–Pratt statistics the package's tests pin
 * (packages/judging/test/forced-choice.test.ts). They are the historical
 * numbers; whether the designs held is exactly the contested part.
 */
export const STUDY_PRESETS: readonly StudyPreset[] = [
  {
    id: 'autoganzfeld',
    label: 'Autoganzfeld — 122 direct hits in 354 sessions',
    hits: 122,
    trials: 354,
    choices: 4,
    note: 'Carter’s total for the PRL autoganzfeld series; CR 4.112, MCE 88.5',
  },
  {
    id: 'tyrrell',
    label: 'Tyrrell Table III — 644 hits in 2704 trials',
    hits: 644,
    trials: 2704,
    choices: 5,
    note: 'deviation +103.2, CR 4.96 — a five-box apparatus, scored at ⅕',
  },
  {
    id: 'placement',
    label: 'Rhine & Pratt placement — 268 hits in 600 trials',
    hits: 268,
    trials: 600,
    choices: 2,
    note: 'SD 12.25, CR −2.61: a below-chance ("psi-missing") series, kept here because the same test has two tails',
  },
  {
    id: 'zener-run',
    label: 'One Zener run — 9 hits in 25 calls',
    hits: 9,
    trials: 25,
    choices: 5,
    note: 'the binomial shortcut gives 0.0468 and the exact closed deck 0.0504 — opposite sides of 0.05',
  },
  {
    id: 'chance',
    label: 'Exactly chance — 25 hits in 100 sessions at ¼',
    hits: 25,
    trials: 100,
    choices: 4,
    note: 'what a null result looks like: deviation 0, two-sided p exactly 1',
  },
]

export interface DeckPreset {
  readonly id: string
  readonly label: string
  readonly counts: readonly number[]
  readonly note: string
}

/** Closed packs whose exact matching distribution is worth looking at. */
export const DECK_PRESETS: readonly DeckPreset[] = [
  {
    id: 'zener',
    label: 'Zener pack — 5 symbols × 5 cards (25)',
    counts: [5, 5, 5, 5, 5],
    note: 'Rhine’s pack: mean 5, variance 25/6, SD 2.0412 against the binomial 2.000',
  },
  {
    id: 'colours',
    label: 'Playing cards by colour — 26 + 26 (52)',
    counts: [26, 26],
    note: 'calling red/black through a shuffled deck: the classic closed-deck bet',
  },
  {
    id: 'suits',
    label: 'Playing cards by suit — 4 × 13 (52)',
    counts: [13, 13, 13, 13],
    note: 'mean 13 matches per pass; the open-deck shortcut again understates the SD',
  },
  {
    id: 'esp-half',
    label: 'Half a Zener pack — 5 × 2 (10)',
    counts: [2, 2, 2, 2, 2],
    note: 'a small pack where the whole integer count table fits on screen',
  },
  {
    id: 'unbalanced',
    label: 'Unbalanced pack — 10, 5, 5, 3, 2 (25)',
    counts: [10, 5, 5, 3, 2],
    note: 'an uneven pack: the mean rises above N/k once calls and pack agree on the common symbol',
  },
]

export function deckPreset(id: string): DeckPreset | undefined {
  return DECK_PRESETS.find((preset) => preset.id === id)
}

/**
 * The SRI-style 6 × 6 judging matrix from the README: transcript i scored
 * against target j, ranks with 1 = best, true pairs on the diagonal.
 * Exact permutation p = 2/720.
 */
export const SRI_MATRIX: readonly (readonly number[])[] = [
  [1, 3, 2, 5, 6, 4],
  [2, 1, 4, 3, 5, 6],
  [4, 2, 1, 6, 3, 5],
  [6, 5, 3, 2, 1, 4],
  [3, 6, 5, 1, 2, 3],
  [5, 4, 6, 4, 4, 1],
]

/** A judging matrix with no signal: every transcript ranks the targets the same way. */
export const FLAT_MATRIX: readonly (readonly number[])[] = [
  [3, 1, 2, 4],
  [3, 1, 2, 4],
  [3, 1, 2, 4],
  [3, 1, 2, 4],
]

/**
 * Soal's Table I pattern counts (Proc. SPR 48). The five groups are the
 * multiplicity patterns of the calls compared with one target when offsets
 * −1/0/+1 are pooled: AAA, AAB, ABC, and the two-call patterns at run ends.
 * Σ count × variance = 872.00 exactly, against the binomial 934.4.
 */
export const SOAL_TABLE_I: readonly {
  readonly signature: string
  readonly pattern: string
  readonly count: number
  readonly variance: number
}[] = [
  { signature: '3', pattern: 'AAA — three equal calls', count: 41, variance: 36 / 25 },
  { signature: '2+1', pattern: 'AAB — two equal, one other', count: 818, variance: 16 / 25 },
  { signature: '1+1+1', pattern: 'ABC — three different', count: 981, variance: 6 / 25 },
  { signature: '2 (end)', pattern: 'AA at a run end', count: 39, variance: 16 / 25 },
  { signature: '1+1 (end)', pattern: 'AB at a run end', count: 121, variance: 6 / 25 },
]

/** Descriptor list for the figure-of-merit demo (May et al. style coding). */
export const DESCRIPTORS: readonly string[] = [
  'water',
  'building',
  'people',
  'motion',
  'tall/vertical',
  'enclosed',
  'natural',
  'noisy',
]

export interface MeritScene {
  readonly id: string
  readonly label: string
  readonly memberships: readonly number[]
}

/** Target and decoy scenes, coded as fuzzy memberships over DESCRIPTORS. */
export const MERIT_SCENES: readonly MeritScene[] = [
  { id: 'harbour', label: 'Harbour with cranes', memberships: [1, 0.8, 0.4, 0.6, 1, 0, 0.3, 0.7] },
  { id: 'cathedral', label: 'Cathedral interior', memberships: [0, 1, 0.5, 0.1, 1, 1, 0, 0.2] },
  { id: 'meadow', label: 'Alpine meadow', memberships: [0.2, 0, 0, 0.3, 0.2, 0, 1, 0] },
  { id: 'market', label: 'Covered market', memberships: [0, 1, 1, 0.8, 0.3, 1, 0, 1] },
]

/** Parse whitespace/comma separated integers; invalid tokens are reported, not thrown. */
export function parseIntList(text: string): { values: number[]; bad: string[] } {
  const values: number[] = []
  const bad: string[] = []
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    const n = Number(token)
    if (Number.isInteger(n)) values.push(n)
    else bad.push(token)
  }
  return { values, bad }
}
