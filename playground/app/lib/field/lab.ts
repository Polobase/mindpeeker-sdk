// The shared field every section on the page measures, plus the bytes the
// Monte-Carlo nulls are drawn from.
//
// CLIENT ONLY: it imports @mindpeeker/field and ~/lib/entropy, so only
// `*.client.vue` components may import it.

import { sampleField } from '@mindpeeker/field'
import type { Point } from '@mindpeeker/field'
import { reactive, type ShallowRef, shallowRef } from 'vue'
import { drbgSource, getBytes, localBytes, restartSource, sourceSummary, withReader } from '~/lib/entropy'
import { currentSeedLabel, sourceMeta } from '~/utils/sources'
import {
  type DrawAccounting,
  type FieldOverlay,
  type LabField,
  type LabParams,
  nullBytesNeeded,
  regionCentre,
  regionOf,
} from './types'

/** The seed label of the DRBG that feeds the null fields — never the field's own. */
export const NULL_SEED_SUFFIX = ' / null fields'

export const DEFAULT_PARAMS: LabParams = {
  count: 150,
  regionKind: 'rect',
  planted: false,
  plantedPercent: 10,
  plantedRadius: 4,
  nullSource: 'local',
}

const params = reactive<LabParams>({ ...DEFAULT_PARAMS })
let nullSourceChosen = false

/**
 * Pick the null-field source once, on the client, from the header selection:
 * a local CSPRNG or a seeded DRBG can serve a hundred kilobytes instantly, so
 * the simulated fields come from the very source under test. A beacon or the
 * timing-jitter source cannot, and the browser CSPRNG stands in for them — a
 * choice the lab states and the user can override.
 */
export function applyDefaultNullSource(): void {
  if (nullSourceChosen) return
  nullSourceChosen = true
  const meta = sourceMeta()
  params.nullSource = meta.network || meta.kind === 'trng' ? 'local' : 'selected'
}
const field: ShallowRef<LabField | undefined> = shallowRef(undefined)
const overlays = reactive<Record<string, readonly FieldOverlay[]>>({})
let serial = 0

function add(a: DrawAccounting, b: DrawAccounting): DrawAccounting {
  return {
    bytesConsumed: a.bytesConsumed + b.bytesConsumed,
    bitsUsed: a.bitsUsed + b.bitsUsed,
    bytesFetched: (a.bytesFetched ?? a.bytesConsumed) + (b.bytesFetched ?? b.bytesConsumed),
  }
}

/** Points the planted blob may take without leaving < 3 CSR points behind. */
export function plantedCount(p: LabParams): number {
  if (!p.planted) return 0
  return Math.max(1, Math.min(p.count - 3, Math.round((p.count * p.plantedPercent) / 100)))
}

/**
 * Draw the field: `count` area-uniform points from the header-selected source
 * through one reader (so a deterministic source gives the same field on every
 * run), optionally replacing a share of them by a tight blob at the centre —
 * the positive control that shows the tests have power.
 */
export async function drawField(signal: AbortSignal): Promise<LabField> {
  const snapshot: LabParams = { ...params }
  const region = regionOf(snapshot.regionKind)
  const n = snapshot.count
  const k = plantedCount(snapshot)
  const centre = regionCentre(region)
  // A deterministic source rewinds first, so "same seed ⇒ same field" holds.
  restartSource()
  const started = performance.now()
  const drawn = await withReader(
    async (reader) => {
      const base = await sampleField(reader, n, region, { signal })
      if (k === 0) {
        return { points: base.points, accounting: base.accounting as DrawAccounting }
      }
      const blob = await sampleField(
        reader,
        k,
        { kind: 'disk', radius: snapshot.plantedRadius },
        { signal },
      )
      const points: Point[] = [
        ...base.points.slice(k),
        ...blob.points.map((p) => ({ x: centre.x + p.x, y: centre.y + p.y })),
      ]
      return {
        points: points as readonly Point[],
        accounting: add(base.accounting as DrawAccounting, blob.accounting as DrawAccounting),
      }
    },
    { signal },
  )
  const summary = sourceSummary()
  serial += 1
  return {
    points: drawn.points,
    region,
    params: snapshot,
    accounting: drawn.accounting,
    plantedCount: k,
    ...(k > 0 ? { plantedCentre: centre, plantedRadius: snapshot.plantedRadius } : {}),
    source: {
      id: summary.id,
      label: summary.label,
      providerName: summary.providerName,
      deterministic: summary.deterministic,
      ...(summary.seedLabel ? { seedLabel: summary.seedLabel } : {}),
    },
    elapsedMs: performance.now() - started,
    serial,
  }
}

export interface NullBytes {
  bytes: Uint8Array
  /** Where they came from, for the accounting line under a result. */
  label: string
}

/** How the three null-byte sources describe themselves in the UI. */
export const NULL_SOURCE_LABELS: Record<LabParams['nullSource'], string> = {
  local: 'browser CSPRNG',
  selected: 'the selected source',
  drbg: 'a seeded DRBG control',
}

/**
 * Bytes for `runs` simulated CSR fields of `count` points — exactly
 * `runs × count × 8`, the same 8 bytes per point `sampleField` spends.
 *
 * The simulated fields never come from the bytes that made the observed field:
 * a Monte-Carlo test against a replay of itself has no power, and the package
 * throws `invalid_config` when it detects one.
 */
export async function drawNullBytes(
  runs: number,
  count: number,
  signal: AbortSignal,
): Promise<NullBytes> {
  const need = nullBytesNeeded(runs, count)
  const source = params.nullSource
  if (source === 'selected') {
    return { bytes: await getBytes(need, { signal }), label: sourceSummary().providerName }
  }
  if (source === 'drbg') {
    const label = `${currentSeedLabel()}${NULL_SEED_SUFFIX}`
    const drbg = drbgSource(label)
    const drawn = await drbg.getBytes(need, { signal })
    return { bytes: drawn.bytes, label: `${drbg.name} · seed “${label}”` }
  }
  return { bytes: await localBytes(need, { signal }), label: 'crypto.getRandomValues' }
}

/** The shared lab: parameters, the drawn field, and the canvas overlays. */
export function useFieldLab() {
  return {
    params,
    field,
    overlays,
    drawField,
    drawNullBytes,
    /** Publish (or clear) a section's marks on the shared canvas. */
    setOverlay(key: string, marks: readonly FieldOverlay[] | undefined): void {
      if (marks === undefined || marks.length === 0) delete overlays[key]
      else overlays[key] = marks
    },
    reset(): void {
      Object.assign(params, DEFAULT_PARAMS)
      field.value = undefined
      for (const key of Object.keys(overlays)) delete overlays[key]
    },
  }
}
