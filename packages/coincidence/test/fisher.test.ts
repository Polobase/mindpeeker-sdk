import { describe, expect, test } from 'bun:test'
import {
  type CardSuit,
  fisherClosenessScore,
  fisherMatchScore,
  fisherScheme,
  fisherSeries,
  PLAYING_CARD_SCHEME,
  type PlayingCard,
  playingCardGrades,
} from '../src/index.js'
import fixture from './fixtures/fisher.json' with { type: 'json' }
import { expectInvalid } from './helpers/errors.js'
import { expectClose } from './helpers/exact.js'

const CELLS = ['OO', 'OR', 'ON', 'CO', 'CR', 'CN', 'SO', 'SR', 'SN'] as const

/** Fisher (1924), p. 184: standardized scores printed to two decimals. */
const FISHER_PRINTED: Record<(typeof CELLS)[number], number> = {
  OO: -11.18,
  OR: -6.11,
  ON: 18.5,
  CO: -3.16,
  CR: 1.91,
  CN: 26.53,
  SO: 4.86,
  SR: 9.94,
  SN: 34.55,
}

/** Diaconis & Mosteller (1989), Table 2: −log10 p to three decimals. */
const DM_TABLE_2: Record<(typeof CELLS)[number], number> = {
  OO: 0,
  OR: 0.19,
  ON: 1.114,
  CO: 0.301,
  CR: 0.491,
  CN: 1.415,
  SO: 0.602,
  SR: 0.793,
  SN: 1.716,
}

const SUITS: CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs']
const DECK: PlayingCard[] = SUITS.flatMap((suit) =>
  Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })),
)

describe('PLAYING_CARD_SCHEME', () => {
  test('null mean and SD agree with mpmath (fixture)', () => {
    expectClose(PLAYING_CARD_SCHEME.mean, fixture.mean, 1e-14)
    expectClose(PLAYING_CARD_SCHEME.sd, fixture.sd, 1e-14)
  })

  test("reproduces Fisher's nine standardized scores and D–M Table 2", () => {
    for (const cell of CELLS) {
      const score = fisherMatchScore(PLAYING_CARD_SCHEME, [cell[0] as string, cell[1] as string])
      expectClose(score.score, fixture.standardized[cell], 1e-13, 1e-12)
      expectClose(score.raw, fixture.raw[cell], 1e-14, 1e-15)
      expect(Math.round(score.score * 100) / 100).toBe(FISHER_PRINTED[cell])
      expect(Math.round(score.raw * 1000) / 1000).toBe(DM_TABLE_2[cell])
    }
    const best = fisherMatchScore(PLAYING_CARD_SCHEME, ['S', 'N'])
    expectClose(best.tailProbability, 1 / 52, 1e-14)
    expect(best.grades).toEqual([2, 2])
    expect(fisherMatchScore(PLAYING_CARD_SCHEME, [2, 2]).score).toBe(best.score)
  })

  test('matches exhaustive enumeration of all 52 × 52 card pairs', () => {
    const counts = new Map<string, number>()
    let sum = 0
    let squares = 0
    for (const a of DECK) {
      for (const b of DECK) {
        const grades = playingCardGrades(a, b)
        const key = grades.join('')
        counts.set(key, (counts.get(key) ?? 0) + 1)
        const score = fisherMatchScore(PLAYING_CARD_SCHEME, grades).score
        sum += score
        squares += score * score
      }
    }
    const total = 52 * 52
    // suit: O ½, C ¼, S ¼; value: O 60/169, R 96/169, N 13/169 — independently
    const suit = { O: 1 / 2, C: 1 / 4, S: 1 / 4 }
    const value = { O: 60 / 169, R: 96 / 169, N: 13 / 169 }
    for (const cell of CELLS) {
      const expected = suit[cell[0] as 'O'] * value[cell[1] as 'O'] * total
      expect(counts.get(cell)).toBe(Math.round(expected))
    }
    expect(Math.abs(sum / total)).toBeLessThan(1e-12)
    expectClose(Math.sqrt(squares / total), 10, 1e-12)
  })
})

describe('playingCardGrades', () => {
  test('grades suit and value agreement', () => {
    const jackOfHearts = { suit: 'hearts', rank: 11 } as const
    const queenOfDiamonds = { suit: 'diamonds', rank: 12 } as const
    expect(playingCardGrades(jackOfHearts, queenOfDiamonds)).toEqual(['C', 'R'])
    expect(playingCardGrades(jackOfHearts, jackOfHearts)).toEqual(['S', 'N'])
    expect(playingCardGrades({ suit: 'spades', rank: 1 }, { suit: 'hearts', rank: 13 })).toEqual([
      'O',
      'O',
    ])
    expect(playingCardGrades({ suit: 'clubs', rank: 2 }, { suit: 'spades', rank: 10 })).toEqual([
      'C',
      'R',
    ])
    expect(playingCardGrades({ suit: 'clubs', rank: 10 }, { suit: 'clubs', rank: 11 })).toEqual([
      'S',
      'O',
    ])
  })

  test('validates', () => {
    expectInvalid(
      () => playingCardGrades({ suit: 'stars' as CardSuit, rank: 1 }, DECK[0] as PlayingCard),
      'a',
    )
    expectInvalid(
      () => playingCardGrades(DECK[0] as PlayingCard, { suit: 'hearts', rank: 14 }),
      'b.rank',
    )
    expectInvalid(
      () => playingCardGrades(DECK[0] as PlayingCard, { suit: 'hearts', rank: 0 }),
      'b.rank',
    )
  })
})

describe('fisherSeries', () => {
  test("Woolley's 49 draws (Fisher 1924): not significant", () => {
    // counts per cell as OCR'd from Fisher's p. 184; the "C)" cell must be 6 for 49 draws
    const counts: Record<(typeof CELLS)[number], number> = {
      OO: 10,
      OR: 18,
      ON: 1,
      CO: 1,
      CR: 6,
      CN: 2,
      SO: 3,
      SR: 7,
      SN: 1,
    }
    const observations = CELLS.flatMap((cell) =>
      new Array(counts[cell]).fill([cell[0] as string, cell[1] as string]),
    )
    const result = fisherSeries(PLAYING_CARD_SCHEME, observations)
    expect(result.n).toBe(49)
    expectClose(result.standardError, 10 / 7, 1e-15)
    // With the printed two-decimal scores the total is −23.21; the page prints −31.21 (an
    // inconsistency in the source). Either way the mean is below one standard error.
    const printedTotal = CELLS.reduce((acc, cell) => acc + counts[cell] * FISHER_PRINTED[cell], 0)
    expect(printedTotal).toBeCloseTo(-23.21, 10)
    expect(result.total).toBeCloseTo(-23.21, 1)
    expect(Math.abs(result.meanScore)).toBeLessThan(result.standardError)
    expect(result.exceedsTwoStandardErrors).toBe(false)
    expectClose(result.z, result.meanScore / result.standardError, 1e-15)
  })

  test('flags a run of exact hits', () => {
    const hits = fisherSeries(PLAYING_CARD_SCHEME, new Array(4).fill(['S', 'N']))
    expect(hits.exceedsTwoStandardErrors).toBe(true)
  })

  test('validates', () => {
    expectInvalid(() => fisherSeries(PLAYING_CARD_SCHEME, []), 'observations')
    expectInvalid(() => fisherSeries(PLAYING_CARD_SCHEME, [['S']]), 'observed')
  })
})

describe('fisherScheme (generic attributes)', () => {
  const scheme = fisherScheme([
    {
      name: 'colour',
      grades: [
        { label: 'miss', probability: 0.75 },
        { label: 'hit', probability: 0.25 },
      ],
    },
    {
      name: 'shape',
      grades: [
        { label: 'miss', probability: 0.5 },
        { label: 'near', probability: 0.3 },
        { label: 'hit', probability: 0.2 },
      ],
    },
  ])

  test('scores are −log10 of the tail and the moments are exact', () => {
    expect(scheme.scores[0]).toEqual([0, -Math.log10(0.25)])
    expect(scheme.scores[1]?.[1]).toBeCloseTo(-Math.log10(0.5), 15)
    const a = [0, -Math.log10(0.25)]
    const b = [0, -Math.log10(0.5), -Math.log10(0.2)]
    const meanA = 0.25 * (a[1] as number)
    const meanB = 0.3 * (b[1] as number) + 0.2 * (b[2] as number)
    const varA = 0.25 * (a[1] as number) ** 2 - meanA ** 2
    const varB = 0.3 * (b[1] as number) ** 2 + 0.2 * (b[2] as number) ** 2 - meanB ** 2
    expectClose(scheme.mean, meanA + meanB, 1e-14)
    expectClose(scheme.sd, Math.sqrt(varA + varB), 1e-14)
    const score = fisherMatchScore(scheme, ['hit', 1])
    expectClose(score.tailProbability, 0.25 * 0.5, 1e-14)
    expect(Object.isFrozen(scheme)).toBe(true)
  })

  test('an attribute array is accepted in place of a scheme', () => {
    expect(fisherMatchScore(scheme.attributes, ['miss', 'hit']).score).toBe(
      fisherMatchScore(scheme, ['miss', 'hit']).score,
    )
  })

  test('validates', () => {
    const grade = (label: string, probability: number) => ({ label, probability })
    expectInvalid(() => fisherScheme([]), 'attributes')
    expectInvalid(
      () => fisherScheme([{ name: 'x', grades: [grade('a', 0.5), grade('b', 0.4)] }]),
      'attributes[0].grades',
    )
    expectInvalid(
      () => fisherScheme([{ name: 'x', grades: [grade('a', 0.5), grade('a', 0.5)] }]),
      'attributes[0].grades[1]',
    )
    expectInvalid(
      () => fisherScheme([{ name: 'x', grades: [grade('a', 1), grade('b', 0)] }]),
      'attributes[0].grades[1].probability',
    )
    expectInvalid(() => fisherScheme([{ name: 'x', grades: [] }]), 'attributes[0].grades')
    const constant = fisherScheme([{ name: 'x', grades: [grade('only', 1)] }])
    expectInvalid(() => fisherMatchScore(constant, ['only']), 'scheme')
    expectInvalid(() => fisherMatchScore(scheme, ['hit', 'bullseye']), 'observed[1]')
    expectInvalid(() => fisherMatchScore(scheme, [2, 0]), 'observed[0]')
    expectInvalid(() => fisherMatchScore(null as unknown as typeof scheme, [0, 0]), 'scheme')
  })
})

describe('fisherClosenessScore', () => {
  test('is −log10((1 + 2d)/c) on a circle', () => {
    expectClose(fisherClosenessScore(0, 365), Math.log10(365), 1e-15)
    expectClose(fisherClosenessScore(1, 365), -Math.log10(3 / 365), 1e-15)
    expect(fisherClosenessScore(182, 365)).toBe(0)
    expect(fisherClosenessScore(5, 10)).toBe(0)
  })

  test('validates', () => {
    expectInvalid(() => fisherClosenessScore(183, 365), 'distance')
    expectInvalid(() => fisherClosenessScore(-1, 365), 'distance')
    expectInvalid(() => fisherClosenessScore(1, 0), 'c')
  })
})
