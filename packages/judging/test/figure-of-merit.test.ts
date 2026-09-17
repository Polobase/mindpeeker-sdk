import { describe, expect, test } from 'bun:test'
import { figureOfMerit, figureOfMeritRank } from '../src/index.js'
import { expectClose, expectJudgingError } from './helpers/fixtures.js'

describe('figureOfMerit', () => {
  test('crisp descriptors: accuracy, reliability and their product', () => {
    // target has descriptors 0, 2, 3; the response names 0, 1, 2
    const r = figureOfMerit([1, 1, 1, 0, 0], [1, 0, 1, 1, 0])
    expect(r.overlap).toBe(2)
    expect(r.targetMass).toBe(3)
    expect(r.responseMass).toBe(3)
    expectClose(r.accuracy, 2 / 3, 1e-15)
    expectClose(r.reliability, 2 / 3, 1e-15)
    expectClose(r.figureOfMerit, 4 / 9, 1e-15)
  })

  test('fuzzy memberships use min for the intersection', () => {
    const r = figureOfMerit([0.5, 1, 0.2], [1, 0.3, 0.6])
    expectClose(r.overlap, 0.5 + 0.3 + 0.2, 1e-15)
    expectClose(r.accuracy, 1 / 1.9, 1e-15)
    expectClose(r.reliability, 1 / 1.7, 1e-15)
  })

  test('a response naming everything is accurate but unreliable; an empty one scores 0', () => {
    const everything = figureOfMerit([1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 0, 0, 0, 0, 0, 0])
    expect(everything.accuracy).toBe(1)
    expect(everything.reliability).toBe(0.25)
    const empty = figureOfMerit([0, 0, 0], [1, 0, 1])
    expect(empty.reliability).toBe(0)
    expect(empty.figureOfMerit).toBe(0)
  })

  test('validates', () => {
    expectJudgingError(() => figureOfMerit([1, 0], [1, 0, 1]), 'invalid_input')
    expectJudgingError(() => figureOfMerit([1, 2], [1, 0]), 'invalid_input')
    expectJudgingError(() => figureOfMerit([1, 0], [0, 0]), 'invalid_input')
    expectJudgingError(() => figureOfMerit([], []), 'invalid_input')
  })
})

describe('figureOfMeritRank', () => {
  test('ranks the target among decoys; ties count against it', () => {
    const response = [1, 0, 1, 0.5]
    const r = figureOfMeritRank(
      response,
      [1, 0, 1, 0],
      [
        [0, 1, 0, 1],
        [1, 1, 0, 0],
        [1, 0, 1, 0],
      ],
    )
    expect(r.packetSize).toBe(4)
    expectClose(r.figureOfMerit, 0.8, 1e-15)
    expect(r.rank).toBe(2)
    expect(r.midRank).toBe(1.5)
    expect(r.pValue).toBe(0.5)
    expect(r.decoys.length).toBe(3)
  })

  test('under random target selection the rank is uniform (exact p = rank / packet size)', () => {
    // with no ties, each packet member being the target gives each rank once
    const response = [1, 0.4, 0, 0.7, 0.2]
    const packet = [
      [1, 0, 0, 0, 0],
      [0, 1, 0, 1, 0],
      [1, 1, 1, 0, 0],
      [0, 0, 0, 0, 1],
    ]
    const ranks = packet.map(
      (target, i) =>
        figureOfMeritRank(
          response,
          target,
          packet.filter((_, j) => j !== i),
        ).rank,
    )
    expect([...ranks].sort()).toEqual([1, 2, 3, 4])
  })

  test('validates', () => {
    expectJudgingError(() => figureOfMeritRank([1], [1], []), 'invalid_input')
    expectJudgingError(() => figureOfMeritRank([1, 0], [1, 0], [[1]]), 'invalid_input')
    expectJudgingError(() => figureOfMeritRank([1, 0], [1, 0], [[0, 0]]), 'invalid_input')
  })
})
