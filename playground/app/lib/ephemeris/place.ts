// The observer both time sections share: one longitude, one latitude, and an
// optional reading from the browser's geolocation API. No SDK import, so this
// module is safe anywhere — it is kept next to the other ephemeris helpers
// only because nothing else uses it.

import { reactive } from 'vue'

export interface Place {
  /** East-positive longitude in degrees — the convention the package uses. */
  longitudeEastDeg: number
  latitudeDeg: number
  /** Where the numbers came from, for the caption. */
  label: string
}

const place = reactive<Place>({
  longitudeEastDeg: -3.19,
  latitudeDeg: 55.95,
  label: 'Edinburgh (KPU)',
})

/** The shared observer. */
export function useObserverPlace(): Place {
  return place
}

export function setPlace(longitudeEastDeg: number, latitudeDeg: number, label: string): void {
  place.longitudeEastDeg = longitudeEastDeg
  place.latitudeDeg = latitudeDeg
  place.label = label
}

const GEO_MESSAGES: Record<number, string> = {
  1: 'permission denied — the browser blocked the request or you declined it',
  2: 'position unavailable — no location provider answered',
  3: 'timed out — the browser did not produce a fix within 10 s',
}

/**
 * Read the browser's geolocation once, and hand the coordinates back — the
 * caller decides whether to store them. Rejects with an error shaped like the
 * SDK's (a `name` and a `code`) so `ErrorAlert` can render it unchanged.
 * Nothing is stored or sent anywhere: the coordinates only feed the formulas
 * on this page.
 */
export function locateObserver(timeoutMs = 10_000): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(fail('unsupported', 'this browser exposes no geolocation API'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          longitudeEastDeg: position.coords.longitude,
          latitudeDeg: position.coords.latitude,
          label: `your location (±${Math.round(position.coords.accuracy)} m)`,
        })
      },
      (error) => {
        const code = error.code === 1 ? 'permission_denied' : error.code === 2 ? 'unavailable' : 'timeout'
        reject(fail(code, GEO_MESSAGES[error.code] ?? error.message))
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

function fail(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.name = 'GeolocationError'
  error.code = code
  return error
}
