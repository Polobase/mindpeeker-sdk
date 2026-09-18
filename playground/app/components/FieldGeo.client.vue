<script setup lang="ts">
/**
 * Section 7a — from bytes to coordinates: the exact spherical-cap sampler and
 * the planar disk map, with distance, bearing and a geohash per point.
 */
import { sampleField } from '@mindpeeker/field'
import {
  destination,
  EARTH_RADIUS_M,
  geohashEncode,
  haversine,
  type LatLon,
  pointToLatLon,
  sampleCap,
  validateLatLon,
} from '@mindpeeker/field/geo'
import { withReader } from '~/lib/entropy'
import {
  bearingDegrees,
  compassPoint,
  formatCoord,
  initialBearing,
  isLat,
  isLon,
  osmLink,
  PLACES,
  planarDistortion,
} from '~/lib/field/geo'
import { fmtBytes, fmtNum } from '~/lib/format'

interface Spot {
  point: LatLon
  distance: number
  bearing: number
  hash: string
  roundTrip: number
}

interface GeoRun {
  centre: LatLon
  radiusM: number
  sampler: 'cap' | 'planar'
  spots: Spot[]
  bytesConsumed: number
}

const task = useTask<GeoRun>()

const RADII = [500, 2_000, 10_000, 100_000, 1_000_000, 5_000_000].map((m) => ({
  label: m >= 1000 ? `${m / 1000} km` : `${m} m`,
  value: m,
}))
const COUNTS = [8, 16, 32, 64].map((n) => ({ label: `${n} points`, value: n }))
const SAMPLERS = [
  { label: 'sampleCap — exact on the sphere at any radius', value: 'cap' as const },
  { label: 'sampleField + pointToLatLon — planar disk, azimuthal equidistant', value: 'planar' as const },
]

const lat = ref(40.7128)
const lon = ref(-74.006)
const radiusM = ref(2000)
const count = ref(16)
const sampler = ref<'cap' | 'planar'>('cap')
const precision = ref(7)
const locating = ref(false)
const locateError = ref('')

const valid = computed(() => isLat(lat.value) && isLon(lon.value))
const bytes = computed(() => count.value * 8)
const distortion = computed(() => planarDistortion(radiusM.value))

function applyPlace(label: string): void {
  const place = PLACES.find((p) => p.label === label)
  if (!place) return
  lat.value = place.lat
  lon.value = place.lon
}

const placeItems = PLACES.map((p) => ({ label: p.label, value: p.label }))
const place = ref<string>(PLACES[0]?.label ?? '')
watch(place, applyPlace)

function locate(): void {
  locateError.value = ''
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    locateError.value = 'This browser exposes no geolocation API.'
    return
  }
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (position) => {
      lat.value = Number(position.coords.latitude.toFixed(6))
      lon.value = Number(position.coords.longitude.toFixed(6))
      locating.value = false
    },
    (error) => {
      locateError.value = error.message || 'Location permission was refused.'
      locating.value = false
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
  )
}

async function run(): Promise<void> {
  await task.run(async (signal, setProgress) => {
    setProgress(null)
    const origin = { lat: lat.value, lon: lon.value }
    // The SDK validates coordinates itself — let it, so the error is a real one.
    validateLatLon(origin, 'center')
    const n = count.value
    const r = radiusM.value
    const mode = sampler.value
    const spots = await withReader(
      async (reader) => {
        const out: Spot[] = []
        if (mode === 'cap') {
          for (let i = 0; i < n; i++) {
            const point = await sampleCap(reader, origin, r, { signal })
            out.push(describe(origin, point))
          }
          return out
        }
        const planar = await sampleField(reader, n, { kind: 'disk', radius: r }, { signal })
        for (const p of planar.points) out.push(describe(origin, pointToLatLon(origin, p)))
        return out
      },
      { signal },
    )
    return { centre: origin, radiusM: r, sampler: mode, spots, bytesConsumed: n * 8 }
  })
}

function describe(origin: LatLon, point: LatLon): Spot {
  const distance = haversine(origin, point)
  const bearing = initialBearing(origin, point)
  // destination() is the inverse of (distance, bearing): the round trip should
  // land back on the point, and does, to well under a millimetre.
  const back = destination(origin, bearing, distance)
  return {
    point,
    distance,
    bearing,
    hash: geohashEncode(point, precision.value),
    roundTrip: haversine(point, back),
  }
}

/**
 * Rings of equal area **on the sphere**: the fraction of a cap of great-circle
 * radius δ inside radius θ is (1 − cos θ)/(1 − cos δ), so the i-th boundary is
 * θ_i = arccos(1 − (i/k)(1 − cos δ)). At city scale that is the familiar
 * (d/r)²; at continental scale it is not, which is the whole point of the
 * exact sampler.
 */
const rings = computed(() => {
  const spots = task.result.value?.spots
  const r = task.result.value?.radiusM
  if (!spots || !r) return undefined
  const k = 4
  const delta = r / EARTH_RADIUS_M
  const span = 1 - Math.cos(delta)
  const boundary = (i: number) =>
    EARTH_RADIUS_M * Math.acos(Math.max(-1, Math.min(1, 1 - (i / k) * span)))
  const counts = new Array<number>(k).fill(0)
  for (const s of spots) {
    const t = span > 0 ? (1 - Math.cos(s.distance / EARTH_RADIUS_M)) / span : 0
    const slot = Math.min(k - 1, Math.max(0, Math.floor(t * k)))
    counts[slot] = (counts[slot] as number) + 1
  }
  return {
    categories: Array.from(
      { length: k },
      (_, i) =>
        `${fmtNum(boundary(i) / 1000, { digits: 2 })}–${fmtNum(boundary(i + 1) / 1000, { digits: 2 })} km`,
    ),
    values: counts,
    expected: spots.length / k,
  }
})

const meanDistance = computed(() => {
  const spots = task.result.value?.spots
  if (!spots || spots.length === 0) return undefined
  let sum = 0
  for (const s of spots) sum += s.distance
  return sum / spots.length
})

/**
 * The exact expected distance, which is not the same for the two samplers:
 * a planar disk gives 2r/3, and a spherical cap gives
 * R(sin δ − δ cos δ)/(1 − cos δ) with δ = r/R — the same 2r/3 to O(δ²).
 */
const meanReference = computed(() => {
  const r = task.result.value?.radiusM ?? radiusM.value
  const mode = task.result.value?.sampler ?? sampler.value
  if (mode === 'planar') return { mean: (2 * r) / 3, formula: 'planar disk: 2r/3' }
  const d = r / EARTH_RADIUS_M
  const span = 1 - Math.cos(d)
  if (span <= 0) return { mean: (2 * r) / 3, formula: 'planar disk: 2r/3' }
  return {
    mean: (EARTH_RADIUS_M * (Math.sin(d) - d * Math.cos(d))) / span,
    formula: 'spherical cap: R(sin δ − δ cos δ)/(1 − cos δ)',
  }
})

const worstRoundTrip = computed(() => {
  const spots = task.result.value?.spots
  if (!spots || spots.length === 0) return undefined
  let worst = 0
  for (const s of spots) worst = Math.max(worst, s.roundTrip)
  return worst
})

const snippet = computed(
  () => `import { byteReader } from '@mindpeeker/oracle'
import { geohashEncode, haversine, ${sampler.value === 'cap' ? 'sampleCap' : 'pointToLatLon'} } from '@mindpeeker/field/geo'
${sampler.value === 'planar' ? "import { sampleField } from '@mindpeeker/field'\n" : ''}
const here = { lat: ${lat.value}, lon: ${lon.value} }
const reader = byteReader(provider)
${
  sampler.value === 'cap'
    ? `const spot = await sampleCap(reader, here, ${radiusM.value})   // exact: 1 − cos θ = u(1 − cos δ)`
    : `const { points } = await sampleField(reader, ${count.value}, { kind: 'disk', radius: ${radiusM.value} })
const spot = pointToLatLon(here, points[0])            // +x east, +y north`
}
haversine(here, spot)          // metres, great circle
geohashEncode(spot, ${precision.value})        // Niemeyer 2008, base-32
await reader.close()`,
)
</script>

<template>
  <DemoSection
    id="geo"
    title="7 · Geo — coordinates from the same bytes"
    description="The Randonautica use case: a random point inside a radius of a start location. Two samplers, one exact on the sphere at any scale, one a planar disk mapped along its bearing. Nothing is sent anywhere and no map tiles are loaded — the coordinates are plain text."
    :api="['sampleCap', 'pointToLatLon', 'haversine', 'destination', 'geohashEncode', 'validateLatLon']"
  >
    <template #controls>
      <RunControls
        :busy="task.busy.value"
        :progress="task.progress.value"
        :disabled="!valid"
        :label="`Draw ${count} coordinates`"
        busy-label="Drawing…"
        icon="i-lucide-globe"
        :hint="`${fmtBytes(bytes)} from the selected source — two 32-bit uniforms per point`"
        @run="run"
        @cancel="task.cancel()"
      >
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-locate-fixed"
          :loading="locating"
          @click="locate"
        >
          Use my location
        </UButton>
      </RunControls>
    </template>

    <ErrorAlert :err="task.error.value" @dismiss="task.reset()" />
    <UAlert
      v-if="locateError"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="No location"
      :description="locateError"
      class="mb-4"
    />

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UFormField label="Start latitude" size="sm" :error="isLat(lat) ? undefined : 'must be in [−90, 90]'">
        <UInput v-model.number="lat" type="number" step="0.000001" class="w-full" />
      </UFormField>
      <UFormField label="Start longitude" size="sm" :error="isLon(lon) ? undefined : 'must be in [−180, 180]'">
        <UInput v-model.number="lon" type="number" step="0.000001" class="w-full" />
      </UFormField>
      <UFormField label="Preset" size="sm">
        <USelect v-model="place" :items="placeItems" class="w-full" />
      </UFormField>
      <UFormField label="Radius" size="sm">
        <USelect v-model="radiusM" :items="RADII" class="w-full" />
      </UFormField>
      <UFormField label="Points" size="sm">
        <USelect v-model="count" :items="COUNTS" class="w-full" />
      </UFormField>
      <UFormField label="Sampler" size="sm">
        <USelect v-model="sampler" :items="SAMPLERS" class="w-full" />
      </UFormField>
      <UFormField label="Geohash precision" :hint="`${precision} characters`" size="sm">
        <USlider v-model="precision" :min="1" :max="12" :step="1" class="mt-2" />
      </UFormField>
      <StatTile
        label="Planar map distortion"
        :value="distortion"
        :digits="6"
        size="sm"
        :note="`(r/R)² at r = ${fmtNum(radiusM / 1000, { digits: 1 })} km — sampleCap has none at any radius`"
      />
      <StatTile
        label="Mean distance"
        size="sm"
        :value="meanDistance === undefined ? '—' : `${fmtNum(meanDistance, { digits: 0 })} m`"
        :note="`exact expectation ${fmtNum(meanReference.mean, { digits: 0 })} m — ${meanReference.formula}`"
      />
    </div>

    <div v-if="task.result.value" class="mt-4 flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Sampler used"
          size="sm"
          :mono="false"
          :value="task.result.value.sampler === 'cap' ? 'sampleCap' : 'pointToLatLon'"
          :note="task.result.value.sampler === 'cap'
            ? 'θ = 2·arcsin(√u · sin(δ/2)), bearing 2πv — area-uniform on the sphere'
            : 'r = R√u, θ = 2πv in the plane, then mapped along its bearing'"
        />
        <StatTile
          label="destination() round trip"
          size="sm"
          :value="worstRoundTrip === undefined ? '—' : `${fmtNum(worstRoundTrip * 1000, { digits: 3 })} mm`"
          note="worst |point − destination(start, bearing, distance)| — the two are exact inverses"
        />
        <StatTile
          label="Earth radius R"
          :value="EARTH_RADIUS_M"
          :digits="1"
          size="sm"
          note="mean spherical Earth, metres"
        />
      </div>

      <BarChart
        v-if="rings"
        :categories="rings.categories"
        :values="rings.values"
        :expected="rings.expected"
        expected-label="equal-area expectation"
        x-label="great-circle distance ring (equal area on the sphere)"
        y-label="points"
        :height="200"
        aria-label="Points per equal-area distance ring against the uniform expectation"
      />

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <caption class="py-1 text-left text-xs text-muted">
            {{ task.result.value.spots.length }} coordinates around
            {{ formatCoord(task.result.value.centre) }}, radius
            {{ fmtNum(task.result.value.radiusM, { digits: 0 }) }} m.
          </caption>
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" class="py-1 pr-3 font-medium">#</th>
              <th scope="col" class="py-1 pr-3 font-medium">latitude, longitude</th>
              <th scope="col" class="py-1 pr-3 font-medium">distance</th>
              <th scope="col" class="py-1 pr-3 font-medium">bearing</th>
              <th scope="col" class="py-1 pr-3 font-medium">geohash</th>
              <th scope="col" class="py-1 font-medium">open</th>
            </tr>
          </thead>
          <tbody class="font-mono tabular-nums">
            <tr v-for="(s, i) in task.result.value.spots" :key="i" class="border-t border-default">
              <td class="py-1 pr-3 text-muted">{{ i + 1 }}</td>
              <td class="py-1 pr-3 text-highlighted">{{ formatCoord(s.point) }}</td>
              <td class="py-1 pr-3">{{ fmtNum(s.distance, { digits: 0 }) }} m</td>
              <td class="py-1 pr-3">
                {{ fmtNum(bearingDegrees(s.bearing), { digits: 1 }) }}° {{ compassPoint(s.bearing) }}
              </td>
              <td class="py-1 pr-3 text-primary">{{ s.hash }}</td>
              <td class="py-1">
                <a
                  :href="osmLink(s.point)"
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

    <HonestNote variant="exact" title="Which sampler is exact where">
      <code class="font-mono">sampleCap</code> is exact at <em>any</em> radius, poles and
      antimeridian included: it inverts Archimedes' hat-box theorem,
      1 − cos θ = u(1 − cos δ). <code class="font-mono">pointToLatLon</code> maps a planar disk point
      along its bearing, which is area-uniform to a relative error of order (r/R)² — about
      {{ fmtNum(planarDistortion(2000), { digits: 8 }) }} at 2 km and
      {{ fmtNum(planarDistortion(1_000_000), { digits: 4 }) }} at 1 000 km. Use the planar map at
      city scale, the cap for anything continental.
    </HonestNote>

    <HonestNote variant="contested" title="What a coordinate is not">
      A point drawn this way is a uniform sample of the area you chose. It carries no information
      about that place, and the Fatum/Randonautica claim — that an intention shifts where the
      quantum numbers land — is a hypothesis, not a result of this draw. What is asserted here is the
      geometry: unbiased sampling, exact distances, and a geohash that round-trips.
    </HonestNote>

    <CodeSnippet class="mt-4" :code="snippet" title="what this section ran" />

    <template #footer>
      “Use my location” asks the browser for permission and keeps the coordinate in this tab; the
      link-out is a plain <code class="font-mono">?mlat=&amp;mlon=</code> URL you choose to click.
      Longitudes come back in [−180, 180] with an exact 180 kept, and every coordinate is validated
      (finite, latitude in [−90, 90]) before a byte is read.
    </template>
  </DemoSection>
</template>
