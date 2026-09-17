/**
 * The 78-card Rider–Waite–Smith tarot deck and the classic spreads. Card
 * titles and Major Arcana numbering follow Waite (*The Pictorial Key to the
 * Tarot*, 1911): Strength is VIII and Justice XI.
 *
 * Card `id`s use the mindpeeker frontend convention (`m00`–`m21` for
 * majors, `w01`/`c01`/`s01`/`p01`–`14` for Wands/Cups/Swords/Pentacles), so
 * readings can be joined against its `tarot.json` content without mapping.
 *
 * Canonical deck order (= `index`, the identity every draw permutes):
 * majors 0–21, then Wands, Cups, Swords, Pentacles, each Ace → King.
 */

export type Suit = 'Wands' | 'Cups' | 'Swords' | 'Pentacles'

export interface TarotCard {
  /** Frontend-compatible id: `m08`, `w03`, `c12`, … */
  readonly id: string
  /** Canonical RWS title, e.g. 'The High Priestess', 'Ace of Swords'. */
  readonly name: string
  readonly arcana: 'major' | 'minor'
  /** Major number 0–21, or minor rank 1 (Ace) – 14 (King). */
  readonly number: number
  /** Present on minor arcana only. */
  readonly suit?: Suit
  /** Position in the canonical deck order, 0–77. */
  readonly index: number
}

const MAJORS: readonly string[] = [
  'The Fool',
  'The Magician',
  'The High Priestess',
  'The Empress',
  'The Emperor',
  'The Hierophant',
  'The Lovers',
  'The Chariot',
  'Strength',
  'The Hermit',
  'Wheel of Fortune',
  'Justice',
  'The Hanged Man',
  'Death',
  'Temperance',
  'The Devil',
  'The Tower',
  'The Star',
  'The Moon',
  'The Sun',
  'Judgement',
  'The World',
]

const RANK_NAMES: readonly string[] = [
  'Ace',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Page',
  'Knight',
  'Queen',
  'King',
]

const SUITS: readonly (readonly [Suit, string])[] = [
  ['Wands', 'w'],
  ['Cups', 'c'],
  ['Swords', 's'],
  ['Pentacles', 'p'],
]

const pad2 = (n: number) => String(n).padStart(2, '0')

function buildDeck(): readonly TarotCard[] {
  const cards: TarotCard[] = []
  for (let n = 0; n < MAJORS.length; n++) {
    cards.push(
      Object.freeze({
        id: `m${pad2(n)}`,
        name: MAJORS[n] as string,
        arcana: 'major' as const,
        number: n,
        index: cards.length,
      }),
    )
  }
  for (const [suit, letter] of SUITS) {
    for (let rank = 1; rank <= 14; rank++) {
      cards.push(
        Object.freeze({
          id: `${letter}${pad2(rank)}`,
          name: `${RANK_NAMES[rank - 1]} of ${suit}`,
          arcana: 'minor' as const,
          number: rank,
          suit,
          index: cards.length,
        }),
      )
    }
  }
  return Object.freeze(cards)
}

/** The full 78-card deck in canonical order. */
export const TAROT_DECK: readonly TarotCard[] = buildDeck()

/** One named position within a spread. */
export interface SpreadPosition {
  readonly name: string
  readonly meaning: string
}

/** A spread layout: an ordered list of named positions. */
export interface Spread {
  readonly id: string
  readonly name: string
  readonly positions: readonly SpreadPosition[]
}

export type SpreadName = 'single' | 'threeCard' | 'celticCross' | 'celticCrossWaite'

const position = (name: string, meaning: string): SpreadPosition => Object.freeze({ name, meaning })

const spread = (id: string, name: string, positions: readonly SpreadPosition[]): Spread =>
  Object.freeze({ id, name, positions: Object.freeze(positions) })

/**
 * Built-in spreads. The three-card names match the mindpeeker frontend's
 * 'Past · Present · Future' variant.
 *
 * Two Celtic Crosses, both dealt in position order:
 *
 * - `celticCross` — the popular modern labels, matching the mindpeeker
 *   frontend (unchanged since 0.1).
 * - `celticCrossWaite` — Waite's own procedure (*The Pictorial Key to the
 *   Tarot*, 1911, Part III §7 "An Ancient Celtic Method of Divination"):
 *   positions in his **deal order** — 1 covers, 2 crosses, 3 crowns,
 *   4 beneath, 5 behind, 6 before, 7 himself, 8 his house, 9 hopes or fears,
 *   10 what will come — with meanings paraphrased from his text. Relative
 *   to `celticCross`, positions 3–5 are permuted (Waite's crowns/beneath/
 *   behind sit at `celticCross` 5/3/4). Waite first withdraws a Significator
 *   and deals the ten from the remaining 77 cards — pass `{ significator }`
 *   to `castSpread` to reproduce that.
 */
export const SPREADS: Readonly<Record<SpreadName, Spread>> = Object.freeze({
  single: spread('single', 'Single card', [
    position('The Card', 'The heart of your answer right now'),
  ]),
  threeCard: spread('threeCard', 'Past · Present · Future', [
    position('Past', 'What led here / the root of the situation'),
    position('Present', 'Where you stand now'),
    position('Future', 'Where this is heading'),
  ]),
  celticCross: spread('celticCross', 'Celtic Cross', [
    position('Present', 'The heart of the matter'),
    position('Challenge', 'What crosses or challenges you'),
    position('Foundation', 'The distant past / root cause'),
    position('Recent Past', 'What is passing away'),
    position('Crown', 'Your goal or best outcome'),
    position('Near Future', 'What is approaching'),
    position('Self', 'How you see yourself / your attitude'),
    position('Environment', 'Outside influences and others'),
    position('Hopes & Fears', 'What you hope for or fear'),
    position('Outcome', 'The likely resolution'),
  ]),
  celticCrossWaite: spread('celticCrossWaite', 'Celtic Cross (Waite, 1911)', [
    position('Covers', 'This covers him: the influence affecting the matter generally'),
    position('Crosses', 'This crosses him: the nature of the obstacles in the matter'),
    position('Crowns', "This crowns him: the querent's aim; the best achievable, not yet actual"),
    position('Beneath', 'This is beneath him: the foundation, already passed into actuality'),
    position('Behind', 'This is behind him: the influence just passed or now passing away'),
    position('Before', 'This is before him: the influence coming into action in the near future'),
    position('Himself', 'The Significator: its position or attitude in the circumstances'),
    position('His House', 'His environment and the tendencies at work therein'),
    position('Hopes or Fears', 'His hopes or fears in the matter'),
    position('What Will Come', 'The final result, the culmination of the other influences'),
  ]),
})
