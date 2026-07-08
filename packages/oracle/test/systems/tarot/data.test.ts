import { describe, expect, test } from 'bun:test'
import { SPREADS, TAROT_DECK } from '../../../src/systems/tarot/data.js'

describe('tarot data', () => {
  test('78 cards: 22 majors + 4 suits × 14 ranks, unique ids', () => {
    expect(TAROT_DECK.length).toBe(78)
    expect(TAROT_DECK.filter((c) => c.arcana === 'major').length).toBe(22)
    for (const suit of ['Wands', 'Cups', 'Swords', 'Pentacles'] as const) {
      const cards = TAROT_DECK.filter((c) => c.suit === suit)
      expect(cards.length).toBe(14)
      expect(cards.map((c) => c.number)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1))
    }
    expect(new Set(TAROT_DECK.map((c) => c.id)).size).toBe(78)
  })

  test('index is the canonical deck position', () => {
    TAROT_DECK.forEach((card, i) => {
      expect(card.index).toBe(i)
    })
  })

  test('frontend-compatible ids and canonical RWS names', () => {
    expect(TAROT_DECK[0]).toMatchObject({ id: 'm00', name: 'The Fool', number: 0 })
    expect(TAROT_DECK[8]).toMatchObject({ id: 'm08', name: 'Strength' }) // RWS: Strength is VIII
    expect(TAROT_DECK[11]).toMatchObject({ id: 'm11', name: 'Justice' })
    expect(TAROT_DECK[21]).toMatchObject({ id: 'm21', name: 'The World' })
    expect(TAROT_DECK[22]).toMatchObject({ id: 'w01', name: 'Ace of Wands', suit: 'Wands' })
    expect(TAROT_DECK[35]).toMatchObject({ id: 'w14', name: 'King of Wands' })
    expect(TAROT_DECK[36]).toMatchObject({ id: 'c01', name: 'Ace of Cups', suit: 'Cups' })
    expect(TAROT_DECK[50]).toMatchObject({ id: 's01', name: 'Ace of Swords', suit: 'Swords' })
    expect(TAROT_DECK[64]).toMatchObject({ id: 'p01', name: 'Ace of Pentacles', suit: 'Pentacles' })
    expect(TAROT_DECK[77]).toMatchObject({ id: 'p14', name: 'King of Pentacles' })
  })

  test('spreads have the documented position counts and are frozen', () => {
    expect(SPREADS.single.positions.length).toBe(1)
    expect(SPREADS.threeCard.positions.length).toBe(3)
    expect(SPREADS.celticCross.positions.length).toBe(10)
    expect(SPREADS.celticCross.positions[0]?.name).toBe('Present')
    expect(SPREADS.celticCross.positions[9]?.name).toBe('Outcome')
    expect(Object.isFrozen(SPREADS)).toBe(true)
    expect(Object.isFrozen(SPREADS.celticCross)).toBe(true)
    expect(Object.isFrozen(SPREADS.celticCross.positions)).toBe(true)
    expect(Object.isFrozen(TAROT_DECK)).toBe(true)
    expect(Object.isFrozen(TAROT_DECK[0])).toBe(true)
  })
})
