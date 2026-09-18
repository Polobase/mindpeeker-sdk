// Every GCP network statistic the network panel shows, computed from one
// z-matrix. Split out of the component so both stay readable.
//
// CLIENT-ONLY: imports @mindpeeker/negentropy.

import {
  type BlockedResult,
  blockedDevvar,
  blockedNetvar,
  type BlockingPoint,
  blockingDecomposition,
  clusteredNetvar,
  covar,
  devvar,
  interSourceCorrelation,
  netvar,
  type NetworkAutocorrelation,
  networkAutocorrelation,
  networkCoherence,
  onsiteVsGlobal,
  type PairCorrelation,
  type StatResult,
  varianceRatio,
  type VarianceRatioResult,
} from '@mindpeeker/negentropy'
import { type NetworkData, netvarIncrements, stoufferExcluding } from './network'

export interface GcpStats {
  netvar: StatResult
  devvar: StatResult
  covar: StatResult & { perStep: Float64Array; meanProduct: number; zSquaredVariance: number }
  coherence: StatResult & {
    coherence: number
    perStep: Float64Array
    pairs: readonly PairCorrelation[]
  }
  inter: StatResult & { pairs: readonly PairCorrelation[] }
  clustered: StatResult & { within: number; between: number; clusterCount: number }
  onsite: StatResult & { r: number }
  blocked: { T: number; net: BlockedResult; dev: BlockedResult }[]
  /** blockedNetvar(T = 1) must equal netvar bit for bit. */
  blockedMatchesNetvar: boolean
  decomposition: { steps: number; z0: number; points: BlockingPoint[] }
  autocorr: NetworkAutocorrelation
  varianceRatios: { q: number; result: VarianceRatioResult }[]
}

/** The first pass: the statistics that combine every source at every step. */
export function primaryStats(net: NetworkData) {
  const { zBySource, names, spec } = net
  return {
    netvar: netvar(zBySource, names),
    devvar: devvar(zBySource, names),
    covar: covar(zBySource, names, { bitsPerTrial: spec.bitsPerTrial }),
    coherence: networkCoherence(zBySource, names),
    inter: interSourceCorrelation(zBySource, names),
  }
}

/** The second pass: clustering, onsite/global, blocking and the lag profile. */
export function secondaryStats(net: NetworkData, blockTs: readonly number[], netvarResult: StatResult) {
  const { zBySource, names, stouffer, spec } = net
  // Alternating cluster ids — the GCP 2.0 clustered-hardware layout.
  const clusters = names.map((_, i) => i % 2)
  const usable = blockTs.filter((T) => Math.floor(spec.steps / T) >= 2)
  const blocked = usable.map((T) => ({
    T,
    net: blockedNetvar(zBySource, names, { T }),
    dev: blockedDevvar(zBySource, names, { T }),
  }))
  const first = blocked.find((entry) => entry.T === 1)
  const maxLag = Math.max(2, Math.min(30, Math.floor(spec.steps / 10)))
  return {
    clustered: clusteredNetvar(zBySource, names, clusters),
    onsite: onsiteVsGlobal(zBySource[0] as Float64Array, stoufferExcluding(zBySource, 0)),
    blocked,
    blockedMatchesNetvar: first ? first.net.statistic === netvarResult.statistic : false,
    decomposition: blockingDecomposition(stouffer, usable),
    autocorr: networkAutocorrelation(netvarIncrements(stouffer), maxLag),
    varianceRatios: [2, 5]
      .filter((q) => spec.steps > q * 4)
      .map((q) => ({ q, result: varianceRatio(stouffer, q) })),
  }
}
