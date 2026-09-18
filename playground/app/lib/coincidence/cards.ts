// Playing cards for Fisher's 1924 scoring scheme.
//
// A "series" here draws BOTH cards at random, which is exactly the null
// Fisher's scores are standardized against — so the demo is a calibration of
// the scheme, not a test of anyone's guessing. Bytes come from the
// header-selected source through `~/lib/entropy`.

import type { CardSuit, FisherObservation, PlayingCard } from '@mindpeeker/coincidence'
import { playingCardGrades } from '@mindpeeker/coincidence'
import { uniformInt } from '@mindpeeker/oracle'
import type { ByteReader } from '@mindpeeker/oracle'

export const SUITS: readonly CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs']

const SUIT_GLYPH: Record<CardSuit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
}

const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export function cardLabel(card: PlayingCard): string {
  return `${RANK_LABEL[card.rank - 1] ?? card.rank}${SUIT_GLYPH[card.suit]}`
}

export function suitItems(): { label: string; value: CardSuit }[] {
  return SUITS.map((suit) => ({ label: `${SUIT_GLYPH[suit]} ${suit}`, value: suit }))
}

export function rankItems(): { label: string; value: number }[] {
  return RANK_LABEL.map((label, index) => ({ label, value: index + 1 }))
}

/** Index 0…51 → a card, suit-major so consecutive indices share a suit. */
export function cardFromIndex(index: number): PlayingCard {
  return { suit: SUITS[Math.floor(index / 13)] as CardSuit, rank: (index % 13) + 1 }
}

/** The nine grade cells of `PLAYING_CARD_SCHEME`, in Fisher's printed order. */
export const SUIT_GRADES = ['O', 'C', 'S'] as const
export const VALUE_GRADES = ['O', 'R', 'N'] as const

/** Exact null probability of a grade cell: ½/¼/¼ times 60/169, 96/169, 13/169. */
export const SUIT_GRADE_P: Record<string, number> = { O: 1 / 2, C: 1 / 4, S: 1 / 4 }
export const VALUE_GRADE_P: Record<string, number> = { O: 60 / 169, R: 96 / 169, N: 13 / 169 }

export function cellIndex(suit: string, value: string): number {
  return SUIT_GRADES.indexOf(suit as 'O') * 3 + VALUE_GRADES.indexOf(value as 'O')
}

export const CELL_LABELS: readonly string[] = SUIT_GRADES.flatMap((suit) =>
  VALUE_GRADES.map((value) => `${suit}${value}`),
)

/** Exact null probability per cell, in `CELL_LABELS` order. */
export const CELL_PROBABILITIES: readonly number[] = SUIT_GRADES.flatMap((suit) =>
  VALUE_GRADES.map((value) => (SUIT_GRADE_P[suit] as number) * (VALUE_GRADE_P[value] as number)),
)

export interface CardTrial {
  readonly called: PlayingCard
  readonly drawn: PlayingCard
  readonly grades: FisherObservation
}

/** One trial: two independent uniform cards and their grade pair. */
export async function drawTrial(reader: ByteReader): Promise<CardTrial> {
  const called = cardFromIndex(await uniformInt(reader, 52))
  const drawn = cardFromIndex(await uniformInt(reader, 52))
  return { called, drawn, grades: playingCardGrades(called, drawn) }
}
