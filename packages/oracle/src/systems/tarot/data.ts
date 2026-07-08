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

export type SpreadName = 'single' | 'threeCard' | 'celticCross'

const position = (name: string, meaning: string): SpreadPosition => Object.freeze({ name, meaning })

const spread = (id: string, name: string, positions: readonly SpreadPosition[]): Spread =>
  Object.freeze({ id, name, positions: Object.freeze(positions) })

/**
 * Built-in spreads. Position names for the Celtic Cross follow Waite (1911)
 * as popularized; the three-card names match the mindpeeker frontend's
 * 'Past · Present · Future' variant.
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
})
