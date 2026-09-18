<script setup lang="ts">
/**
 * Section 7b — geohash cells and their neighbours, the equal-area lat/lon box
 * sampler (including the antimeridian wrap), and longitude normalisation.
 */
import {
  type GeohashCell,
  geohashDecode,
  geohashEncode,
  geohashNeighbours,
  haversine,
  type LatLon,
  MAX_GEOHASH_LENGTH,
  normalizeLon,
  sampleLatLonBox,
} from '@mindpeeker/field/geo'
import { withReader } from '~/lib/entropy'
import { errorLine } from '~/lib/errors'
import { formatCoord, osmLink } from '~/lib/field/geo'
import { fmtBytes, fmtNum } from '~/lib/format'

const hash = ref('dr5regw')
const rawLon = ref(190)
const boxCount = ref(12)

const BOXES = [
  { label: 'Across the antimeridian: 10…20° N, 170°E…170°W', value: 'antimeridian' as const },
  { label: 'North Atlantic: 30…60° N, 60…10° W', value: 'atlantic' as const },
  { label: 'Whole globe', value: 'globe' as const },
  { label: 'Polar cap: 80…90° N', value: 'polar' as const },
]
const BOX_VALUES = {
  antimeridian: { south: 10, north: 20, west: 170, east: -170 },
  atlantic: { south: 30, north: 60, west: -60, east: -10 },
  globe: { south: -90, north: 90, west: -180, east: 180 - 1e-9 },
  polar: { south: 80, north: 90, west: -180, east: 180 - 1e-9 },
} as const

const boxKey = ref<keyof typeof BOX_VALUES>('antimeridian')
const box = computed(() => BOX_VALUES[boxKey.value])

const decoded = computed<{ cell?: GeohashCell; error?: unknown }>(() => {
  try {
    return { cell: geohashDecode(hash.value.trim()) }
  } catch (error) {
    return { error }
  }
})

const neighbours = computed<{ value?: ReturnType<typeof geohashNeighbours>; error?: unknown }>(() => {
  try {
    return { value: geohashNeighbours(hash.value.trim()) }
  } catch (error) {
    return { error }
  }
})

/** The cell's footprint in metres, from its own bounds. */
const cellSize = computed(() => {
  const c = decoded.value.cell
  if (!c) return undefined
  const width = haversine({ lat: c.lat, lon: c.west }, { lat: c.lat, lon: c.east })
  const height = haversine({ lat: c.south, lon: c.lon }, { lat: c.north, lon: c.lon })
  return { width, height }
})

/** Re-encoding the decoded centre at the same length must give the hash back. */
const roundTrip = computed(() => {
  const c = decoded.value.cell
  if (!c) return undefined
  return geohashEncode({ lat: c.lat, lon: c.lon }, hash.value.trim().length)
})

const grid = computed(() => {
  const n = neighbours.value.value
  const centre = hash.value.trim()
  if (!n) return []
  return [
    { key: 'nw', value: n.nw },
    { key: 'n', value: n.n },
    { key: 'ne', value: n.ne },
    { key: 'w', value: n.w },
    { key: '·', value: centre },
    { key: 'e', value: n.e },
    { key: 'sw', value: n.sw },
    { key: 's', value: n.s },
    { key: 'se', value: n.se },
  ]
})

const task = useTask<{ points: LatLon[]; hashes: string[] }>()

async function drawBox(): Promise<void> {
  await task.run(async (signal, setProgress) => {
    setProgress(null)
    const b = box.value
    const n = boxCount.value
    return await withReader(
      async (reader) => {
        const points: LatLon[] = []
        const hashes: string[] = []
        for (let i = 0; i < n; i++) {
          const p = await sampleLatLonBox(reader, b, { signal })
          points.push(p)
          hashes.push(geohashEncode(p, 5))
        }
        return { points, hashes }
      },
      { signal },
    )
  })
}

const crossesAntimeridian = computed(() => box.value.west > box.value.east)

const snippet = computed(
  () => `import { geohashDecode, geohashEncode, geohashNeighbours, sampleLatLonBox } from '@mindpeeker/field/geo'

geohashEncode({ lat: 40.7128, lon: -74.006 }, ${hash.value.trim().length})   // '${roundTrip.value ?? ''}'
geohashDecode('${hash.value.trim()}')        // { lat, lon, latError, lonError, south, north, west, east }
geohashNeighbours('${hash.value.trim()}')    // { n, ne, e, se, s, sw, w, nw } — null beyond a pole

// Equal area per latitude band: φ = arcsin(sinφ₁ + u(sinφ₂ − sinφ₁))
const p = await sampleLatLonBox(reader, { south: ${box.value.south}, north: ${box.value.north}, west: ${box.value.west}, east: ${fmtNum(box.value.east, { digits: 6 })} })
// west > east crosses the antimeridian${crossesAntimeridian.value ? ' — this box does' : ''}`,
)
</script>

<template>
  <DemoSection
    id="geohash"
    title="7b · Geohash cells and the lat/lon box"
    description="A geohash is a bit-interleaved quadtree address: each character adds five bits, alternating longitude and latitude. Encodings, cells and neighbours are checked against pygeohash."
    :api="['geohashEncode', 'geohashDecode', 'geohashNeighbours', 'normalizeLon', 'sampleLatLonBox']"
  >
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="flex flex-col gap-3">
        <UFormField
          label="Geohash"
          size="sm"
          :description="`case-insensitive, 1 … ${MAX_GEOHASH_LENGTH} characters of 0-9 b-h j k m n p-z`"
        >
          <UInput v-model="hash" class="w-full font-mono" placeholder="dr5regw" />
        </UFormField>

        <UAlert
          v-if="decoded.error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="geohashDecode rejected that string"
          :description="errorLine(decoded.error)"
        />

        <div v-if="decoded.cell" class="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Cell centre"
            size="sm"
            :value="formatCoord({ lat: decoded.cell.lat, lon: decoded.cell.lon })"
            :note="`± ${fmtNum(decoded.cell.latError, { digits: 6 })}° lat, ± ${fmtNum(decoded.cell.lonError, { digits: 6 })}° lon`"
          />
          <StatTile
            label="Cell footprint"
            size="sm"
            :value="cellSize ? `${fmtNum(cellSize.width, { digits: 1 })} × ${fmtNum(cellSize.height, { digits: 1 })} m` : '—'"
            note="from its own bounds, by haversine"
          />
          <StatTile
            label="Bounds"
            size="sm"
            :value="`${fmtNum(decoded.cell.south, { digits: 5 })} … ${fmtNum(decoded.cell.north, { digits: 5 })}`"
            :note="`lon ${fmtNum(decoded.cell.west, { digits: 5 })} … ${fmtNum(decoded.cell.east, { digits: 5 })}`"
          />
          <StatTile
            label="Re-encoded centre"
            size="sm"
            :value="roundTrip ?? '—'"
            :tone="roundTrip === hash.trim().toLowerCase() ? 'success' : 'warning'"
            note="encode(decode(h)) === h — the round trip is exact"
          />
        </div>

        <div>
          <h3 class="text-sm font-semibold text-highlighted">Neighbours</h3>
          <p class="mt-1 text-xs text-muted">
            The eight cells of equal length around it. They wrap across the antimeridian and are
            <code class="font-mono">null</code> beyond the north or south pole.
          </p>
          <UAlert
            v-if="neighbours.error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="geohashNeighbours rejected that string"
            :description="errorLine(neighbours.error)"
            class="mt-2"
          />
          <div v-else class="mt-2 grid grid-cols-3 gap-1.5">
            <div
              v-for="cell in grid"
              :key="cell.key"
              class="rounded border px-2 py-1.5 text-center"
              :class="cell.key === '·' ? 'border-primary bg-elevated' : 'border-default'"
            >
              <div class="text-[10px] uppercase tracking-wide text-dimmed">{{ cell.key }}</div>
              <div class="font-mono text-xs" :class="cell.value ? 'text-highlighted' : 'text-dimmed'">
                {{ cell.value ?? 'null' }}
              </div>
            </div>
          </div>
        </div>

        <UFormField
          label="normalizeLon"
          size="sm"
          description="wraps into [−180, 180]; an exact 180 is kept, and a positive input landing on −180 comes back as 180"
        >
          <div class="flex items-center gap-2">
            <UInput v-model.number="rawLon" type="number" step="1" class="w-32" />
            <UIcon name="i-lucide-move-right" class="size-4 text-dimmed" />
            <span class="font-mono tabular-nums text-highlighted">
              {{ Number.isFinite(rawLon) ? fmtNum(normalizeLon(rawLon), { digits: 6 }) : '—' }}
            </span>
          </div>
        </UFormField>
      </div>

      <div class="flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-highlighted">sampleLatLonBox</h3>
        <p class="text-sm text-muted">
          Uniform by area on the sphere inside a latitude/longitude box: latitudes come from
          φ = arcsin(sin φ₁ + u(sin φ₂ − sin φ₁)), so bands near a pole get the fewer points their
          smaller area deserves; longitudes are uniform.
        </p>

        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Box" size="sm">
            <USelect v-model="boxKey" :items="BOXES" class="w-full" />
          </UFormField>
          <UFormField label="Points" :hint="`${boxCount}`" size="sm">
            <USlider v-model="boxCount" :min="4" :max="40" :step="4" class="mt-2" />
          </UFormField>
        </div>

        <RunControls
          :busy="task.busy.value"
          :progress="task.progress.value"
          :label="`Draw ${boxCount} points`"
          busy-label="Drawing…"
          icon="i-lucide-box-select"
          :hint="`${fmtBytes(boxCount * 8)} from the selected source${crossesAntimeridian ? ' · west > east: this box crosses the antimeridian' : ''}`"
          @run="drawBox"
          @cancel="task.cancel()"
        />

        <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />

        <div v-if="task.result.value" class="overflow-x-auto">
          <table class="w-full text-sm">
            <caption class="py-1 text-left text-xs text-muted">
              south {{ box.south }}°, north {{ box.north }}°, west {{ box.west }}°, east
              {{ fmtNum(box.east, { digits: 3 }) }}°
            </caption>
            <thead>
              <tr class="text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" class="py-1 pr-3 font-medium">#</th>
                <th scope="col" class="py-1 pr-3 font-medium">latitude, longitude</th>
                <th scope="col" class="py-1 pr-3 font-medium">geohash-5</th>
                <th scope="col" class="py-1 font-medium">open</th>
              </tr>
            </thead>
            <tbody class="font-mono tabular-nums">
              <tr v-for="(p, i) in task.result.value.points" :key="i" class="border-t border-default">
                <td class="py-1 pr-3 text-muted">{{ i + 1 }}</td>
                <td class="py-1 pr-3 text-highlighted">{{ formatCoord(p, 4) }}</td>
                <td class="py-1 pr-3 text-primary">{{ task.result.value.hashes[i] }}</td>
                <td class="py-1">
                  <a
                    :href="osmLink(p, 6)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    map<UIcon name="i-lucide-external-link" class="size-3" />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <HonestNote variant="exact" title="Bisection ties and pole wraps are defined, not guessed">
      A value exactly at a bisection midpoint takes the upper half; neighbours wrap the antimeridian;
      a neighbour beyond a pole is <code class="font-mono">null</code> rather than a clamped lie.
      Encodings, cell bounds and neighbours are checked against pygeohash, and the whole-globe box
      above is drawn with the equal-area latitude rule — pick it and count how few points land above
      60°, which is exactly what the sphere's geometry says should happen.
    </HonestNote>

    <CodeSnippet class="mt-4" :code="snippet" title="what this section ran" />

    <template #footer>
      Precision 9 is about 4.8 m × 4.8 m at the equator and narrows with the cosine of the latitude,
      which is why the footprint above shrinks as you move the hash north.
    </template>
  </DemoSection>
</template>
