import { describe, expect, test } from 'bun:test'
import { checkpointOffset, FOLD_WEIGHT, planPietrzak } from '../../src/internal/plan.js'

describe('checkpointOffset', () => {
  test('distance to the nearest stored power at or below e, capped at the last index', () => {
    expect(checkpointOffset(0, 10, 5)).toBe(0)
    expect(checkpointOffset(37, 10, 5)).toBe(7)
    expect(checkpointOffset(50, 10, 5)).toBe(0)
    expect(checkpointOffset(63, 10, 5)).toBe(13) // beyond the last checkpoint (index 5)
  })
})

describe('planPietrzak', () => {
  test('without checkpoints every round recomputes ceil(T_i / 2) squarings', () => {
    const plan = planPietrzak(1000)
    expect(plan.map((r) => r.half)).toEqual([500, 250, 125, 63, 32, 16, 8, 4, 2, 1])
    expect(plan.every((r) => !r.fromCheckpoints && r.squarings === r.half)).toBe(true)
    expect(planPietrzak(1)).toEqual([])
  })

  test('leaf sums enumerate e_S = t_i + Σ_{j∈S} t_j, chosen only when cheaper', () => {
    const T = 1000
    const interval = 32
    const last = Math.floor(T / interval)
    const plan = planPietrzak(T, interval)
    const halves = plan.map((r) => r.half)
    let usingCheckpoints = true
    plan.forEach((round, i) => {
      // Brute-force subset sums for round i.
      let leaves = 0
      for (let mask = 0; mask < 1 << i; mask++) {
        let e = round.half
        for (let j = 0; j < i; j++) if (mask & (1 << j)) e += halves[j] as number
        leaves += checkpointOffset(e, interval, last)
      }
      const cheaper = usingCheckpoints && leaves + ((1 << i) - 1) * FOLD_WEIGHT < round.half
      expect(round.fromCheckpoints).toBe(cheaper)
      expect(round.squarings).toBe(cheaper ? leaves : round.half)
      if (!cheaper) usingCheckpoints = false
    })
    expect(plan[0]?.fromCheckpoints).toBe(true)
  })

  test('a single checkpoint segment (interval = T) never helps', () => {
    for (const T of [2, 3, 1000, 4096]) {
      expect(planPietrzak(T, T).every((r) => !r.fromCheckpoints)).toBe(true)
    }
  })
})
