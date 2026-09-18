// The simulated multi-lab data set the LST sections analyse, and the bytes it
// is drawn from.
//
// CLIENT ONLY: it imports @mindpeeker/ephemeris, @mindpeeker/negentropy,
// @mindpeeker/oracle and ~/lib/entropy, so only `*.client.vue` components may
// import it.
//
// The design follows cookbook recipe 9: three laboratories running daytime
// sessions over two years, effects exactly N(0, 1) under H0 (`probitBytes`),
// plus an optional planted shift inside one LST window. Two independent data
// sets are drawn in one pass — one to explore, one to confirm — because a
// window read off a scan is only pre-registered for data that did not exist
// yet.

import { julianDay, localMeanSolarTime, lst, normalizeHours } from '@mindpeeker/ephemeris'
import { probitBytes } from '@mindpeeker/negentropy'
import { uniformInt } from '@mindpeeker/oracle'
import { reactive, type ShallowRef, shallowRef } from 'vue'
import { createYielder } from '~/lib/async'
import { localProvider, provider, restartSource, sourceSummary, withReader } from '~/lib/entropy'
import { sourceMeta } from '~/utils/sources'
import type { TrialColumns } from './jobs'

export interface Lab {
  readonly id: string
  readonly name: string
  /** East-positive longitude in degrees. */
  readonly lon: number
}

/** Longitudes wide enough that a fixed clock hour maps to different LSTs. */
export const LABS: readonly Lab[] = [
  { id: 'edinburgh', name: 'Edinburgh', lon: -3.19 },
  { id: 'zurich', name: 'Zurich', lon: 8.54 },
  { id: 'palo-alto', name: 'Palo Alto', lon: -122.14 },
  { id: 'princeton', name: 'Princeton', lon: -74.66 },
  { id: 'tokyo', name: 'Tokyo', lon: 139.69 },
]

export interface LabParams {
  /** Trials per data set (two sets are drawn). */
  trials: number
  /** Planted shift in SD units, added inside the planted window. 0 = pure null. */
  shift: number
  /** Centre of the planted LST window, hours. */
  centerHours: number
  /** Half width of the planted LST window, hours. */
  halfWidthHours: number
  /** Ids of the labs that ran sessions. */
  labIds: string[]
  /** Length of the recruitment period in days, starting 2024-01-01. */
  spanDays: number
  /** Sessions start between these local mean solar hours. */
  dayStartHour: number
  dayEndHour: number
  /** Where the bytes come from: the header selection, or the browser CSPRNG. */
  byteSource: 'selected' | 'local'
}

export const DEFAULT_PARAMS: LabParams = {
  trials: 1200,
  shift: 0.6,
  centerHours: 20,
  halfWidthHours: 1,
  labIds: ['edinburgh', 'zurich', 'palo-alto'],
  spanDays: 730,
  dayStartHour: 9,
  dayEndHour: 17,
  byteSource: 'selected',
}

export interface DrawAccounting {
  readonly bytesConsumed: number
  readonly bytesFetched: number
}

export interface Dataset {
  readonly role: 'exploration' | 'confirmation'
  readonly label: string
  readonly columns: TrialColumns
  readonly labs: readonly Lab[]
  readonly plantedCount: number
  readonly accounting: DrawAccounting
}

export interface DatasetPair {
  readonly serial: number
  readonly params: LabParams
  readonly exploration: Dataset
  readonly confirmation: Dataset
  readonly accounting: DrawAccounting
  readonly elapsedMs: number
  readonly source: {
    readonly id: string
    readonly label: string
    readonly providerName: string
    readonly deterministic: boolean
    readonly seedLabel?: string
  }
}

const params = reactive<LabParams>({ ...DEFAULT_PARAMS, labIds: [...DEFAULT_PARAMS.labIds] })
const data: ShallowRef<DatasetPair | undefined> = shallowRef(undefined)
let serial = 0
let sourceChosen = false

/**
 * Pick the byte source once, on the client. A CSPRNG or a seeded DRBG serves
 * tens of kilobytes instantly, so the simulation can come from the very source
 * the header selects. A beacon delivers 32 bytes per round and the jitter
 * source is slow, so those fall back to the browser CSPRNG — stated, and
 * overridable.
 */
export function applyDefaultByteSource(): void {
  if (sourceChosen) return
  sourceChosen = true
  const meta = sourceMeta()
  params.byteSource = meta.network || meta.kind === 'trng' ? 'local' : 'selected'
}

/**
 * Bytes one data set needs: one per effect plus three rejection-sampled
 * two-byte uniform draws — measured at 6.03 bytes a trial on this design.
 */
export function bytesNeeded(p: LabParams): number {
  return Math.round(p.trials * 6.05)
}

export function selectedLabs(p: LabParams): readonly Lab[] {
  const picked = LABS.filter((lab) => p.labIds.includes(lab.id))
  return picked.length > 0 ? picked : [LABS[0] as Lab]
}

/** Circular distance between two LST hours, in hours (0 … 12). */
export function lstDistance(a: number, b: number): number {
  return Math.abs(((a - b + 36) % 24) - 12)
}

const DAY_ZERO = Date.UTC(2024, 0, 1)

async function makeDataset(
  role: Dataset['role'],
  p: LabParams,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<Dataset> {
  const labs = selectedLabs(p)
  const n = p.trials
  const source = p.byteSource === 'local' ? localProvider : provider
  const tick = createYielder(8, signal)
  return await withReader(
    async (reader) => {
      // One byte per trial → exactly N(0, 1) after the probit map (H0 by
      // construction, so a rejection here is a false positive, not an effect).
      const raw = new Uint8Array(n)
      for (let i = 0; i < n; i++) {
        raw[i] = await reader.next()
        if ((i & 255) === 0) await tick()
      }
      const noise = probitBytes(raw, { source: `${role}/${p.trials}` })

      const lstHours = new Float64Array(n)
      const effect = new Float64Array(n)
      const labIndex = new Int32Array(n)
      const clockHours = new Float64Array(n)
      const dayOfYear = new Int32Array(n)
      const planted = new Uint8Array(n)
      const windowMinutes = Math.max(1, Math.round((p.dayEndHour - p.dayStartHour) * 60))
      let plantedCount = 0

      for (let i = 0; i < n; i++) {
        const lab = labs[await uniformInt(reader, labs.length)] as Lab
        const day = await uniformInt(reader, p.spanDays)
        const minute = p.dayStartHour * 60 + (await uniformInt(reader, windowMinutes))
        // The session is scheduled by the local clock; UT follows from the longitude.
        const utcMinutes = day * 1440 + minute - (lab.lon / 15) * 60
        const time = new Date(DAY_ZERO + Math.round(utcMinutes * 60_000))
        const jd = julianDay(time)
        const hours = lst(jd, lab.lon)
        const inside = lstDistance(hours, p.centerHours) < p.halfWidthHours
        lstHours[i] = hours
        clockHours[i] = normalizeHours(localMeanSolarTime(jd, lab.lon))
        dayOfYear[i] = day % 365
        labIndex[i] = LABS.indexOf(lab)
        planted[i] = inside && p.shift !== 0 ? 1 : 0
        if (planted[i]) plantedCount++
        effect[i] = (noise[i] as number) + (inside ? p.shift : 0)
        if ((i & 127) === 0) {
          onProgress(i / n)
          await tick()
        }
      }
      return {
        role,
        label: role === 'exploration' ? 'exploration set' : 'confirmation set',
        columns: { lstHours, effect, labIndex, clockHours, dayOfYear, planted },
        labs,
        plantedCount,
        accounting: {
          bytesConsumed: reader.bytesConsumed,
          bytesFetched: reader.bytesFetched ?? reader.bytesConsumed,
        },
      }
    },
    { signal, source, chunkBytes: 4096 },
  )
}

/**
 * Draw both data sets. A deterministic source is rewound first, so the same
 * seed label and the same parameters always give the same two sets.
 */
export async function drawDatasets(
  signal: AbortSignal,
  setProgress: (value: number | null) => void,
): Promise<DatasetPair> {
  const snapshot: LabParams = { ...params, labIds: [...params.labIds] }
  restartSource()
  const started = performance.now()
  setProgress(0)
  const exploration = await makeDataset('exploration', snapshot, signal, (f) =>
    setProgress(f * 0.5),
  )
  const confirmation = await makeDataset('confirmation', snapshot, signal, (f) =>
    setProgress(0.5 + f * 0.5),
  )
  setProgress(1)
  const summary = sourceSummary()
  serial += 1
  const usedLocal = snapshot.byteSource === 'local'
  return {
    serial,
    params: snapshot,
    exploration,
    confirmation,
    accounting: {
      bytesConsumed:
        exploration.accounting.bytesConsumed + confirmation.accounting.bytesConsumed,
      bytesFetched: exploration.accounting.bytesFetched + confirmation.accounting.bytesFetched,
    },
    elapsedMs: performance.now() - started,
    source: usedLocal
      ? {
          id: 'crypto',
          label: 'Browser CSPRNG',
          providerName: localProvider.name,
          deterministic: false,
        }
      : {
          id: summary.id,
          label: summary.label,
          providerName: summary.providerName,
          deterministic: summary.deterministic,
          ...(summary.seedLabel ? { seedLabel: summary.seedLabel } : {}),
        },
  }
}

/** The shared lab: parameters every LST section reads, and the drawn pair. */
export function useEphemerisLab() {
  return { params, data }
}

/** The boxcar shape every LST section shares (Spottiswoode's defaults). */
export interface ScanSettings {
  windowHours: number
  stepHours: number
  minTrials: number
  permutations: number
  seed: number
}

/** The window the confirmatory test uses, and where it came from. */
export interface RegisteredWindow {
  centerHours: number
  halfWidthHours: number
  /** Human-readable provenance, shown next to the result. */
  origin: string
}

const settings = reactive<ScanSettings>({
  windowHours: 2,
  stepHours: 0.1,
  minTrials: 1,
  permutations: 999,
  seed: 20260917,
})

const registered = reactive<RegisteredWindow>({
  centerHours: 13.47,
  halfWidthHours: 1,
  origin: "Spottiswoode's 1997 peak, 13.47 h ± 1 h — typed in, not read off this data",
})

export function useLstSettings(): { settings: ScanSettings; registered: RegisteredWindow } {
  return { settings, registered }
}
