import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mutualInformation, shannonEntropy } from '../src/entropy.js'
import { transferEntropy } from '../src/transfer.js'

interface TeFixtures {
  cases: Array<{
    label: string
    x: number[]
    y: number[]
    entropyX: number
    entropyY: number
    mutualInformation: number
    te: Array<{ k: number; xy: number; yx: number }>
  }>
}

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'te.json'), 'utf8'),
) as TeFixtures

describe('pyinform cross-check fixtures', () => {
  test('shannonEntropy matches pyinform block_entropy(·, 1)', () => {
    for (const c of fixtures.cases) {
      expect(Math.abs(shannonEntropy(c.x) - c.entropyX)).toBeLessThan(1e-9)
      expect(Math.abs(shannonEntropy(c.y) - c.entropyY)).toBeLessThan(1e-9)
    }
  })

  test('mutualInformation matches pyinform mutual_info', () => {
    for (const c of fixtures.cases) {
      expect(Math.abs(mutualInformation(c.x, c.y) - c.mutualInformation)).toBeLessThan(1e-9)
    }
  })

  test('transferEntropy matches pyinform transfer_entropy for k = 1..3, both directions', () => {
    for (const c of fixtures.cases) {
      for (const { k, xy, yx } of c.te) {
        expect(Math.abs(transferEntropy(c.x, c.y, { k }) - xy)).toBeLessThan(1e-9)
        expect(Math.abs(transferEntropy(c.y, c.x, { k }) - yx)).toBeLessThan(1e-9)
      }
    }
  })
})
