import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Shape of test/fixtures/sequential.json (scripts/fixtures/sequential.py). */
export interface SequentialFixtures {
  generator: string
  netvarLogM: Array<{
    t: number
    deviation: number
    a: number
    b: number
    sided: 'two' | 'upper'
    logM: number
  }>
  netvarBoundary: Array<{
    t: number
    alpha: number
    a: number
    b: number
    sided: 'two' | 'upper'
    upper: number
    lower: number | null
  }>
  drift: {
    logM: Array<{ t: number; sum: number; lambda: number; sided: 'two' | 'upper'; logM: number }>
    boundary: Array<{ t: number; lambda: number; alpha: number; two: number; upper: number }>
  }
  series: { iid: number[]; ar: number[] }
  varianceRatio: Array<{
    series: 'iid' | 'ar'
    q: number
    ratio: number
    statistic: number
    pValue: number
    robustStatistic: number
    robustPValue: number
  }>
  blocking: {
    steps: number
    z0: number
    points: Array<{
      T: number
      blocks: number
      statistic: number
      pValue: number
      z: number
      expected: number
      autocorrelationTerm: number
    }>
  }
  autocorrelation: {
    maxLag: number
    p: number
    acf: number[]
    z: number[]
    integrated: number[]
    envelope: number[]
  }
}

export const sequentialFixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'sequential.json'), 'utf8'),
) as SequentialFixtures
