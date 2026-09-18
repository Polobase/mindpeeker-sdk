// Number/byte/time formatting shared by every demo. SSR-safe (no SDK imports):
// import it from pages, SSR components and client components alike.

const DASH = '—'

export interface NumOptions {
  /** Significant decimals for non-integers (default 3). */
  digits?: number
  /** Shown for non-finite input (default '—'). */
  fallback?: string
  /** Force scientific notation. */
  exponential?: boolean
}

/**
 * Drop a mantissa's trailing zeros, but never below two decimals — so
 * `1.4600e+14` reads `1.46e+14` while `3.450190e-7` keeps every digit it has.
 */
function trimMantissa(text: string): string {
  const eIndex = text.indexOf('e')
  if (eIndex < 0) return text
  const mantissa = text.slice(0, eIndex)
  const exponent = text.slice(eIndex)
  const dot = mantissa.indexOf('.')
  if (dot < 0) return text
  let end = mantissa.length
  while (end - dot > 3 && mantissa[end - 1] === '0') end--
  return `${mantissa.slice(0, end)}${exponent}`
}

/**
 * A number for display: integers get thousands separators, very small and very
 * large magnitudes go scientific, everything else gets `digits` decimals.
 *
 * `digits` is a precision budget, not a hard cap on significant figures: a
 * scientific rendering keeps at least five of them, so a reference value such as
 * `chi2Sf` = 3.4502e-7 can still be checked against the package's fixtures
 * instead of collapsing to 3.45e-7.
 *
 * ```ts
 * fmtNum(1234567)                    // '1,234,567'
 * fmtNum(0.0000123)                  // '1.23e-5'
 * fmtNum(3.14159, { digits: 2 })     // '3.14'
 * fmtNum(35686494.887099, { digits: 6 }) // '35,686,494.887099'
 * ```
 */
export function fmtNum(value: number | bigint | null | undefined, opts: NumOptions = {}): string {
  const { digits = 3, fallback = DASH, exponential = false } = opts
  if (typeof value === 'bigint') return value.toLocaleString('en-US')
  if (value === null || value === undefined || !Number.isFinite(value)) {
    if (value === Number.POSITIVE_INFINITY) return '∞'
    if (value === Number.NEGATIVE_INFINITY) return '−∞'
    return fallback
  }
  if (exponential) return value.toExponential(digits)
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return value.toLocaleString('en-US')
  const magnitude = Math.abs(value)
  // Below a billion, grouped fixed notation carries more information than an
  // exponent and matches the way the integers beside it are already rendered.
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e9)) {
    return trimMantissa(value.toExponential(Math.min(20, Math.max(4, digits))))
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(20, Math.max(0, digits)),
  })
}

/**
 * A p-value: scientific below 1e-4, otherwise fixed decimals.
 *
 * ```ts
 * fmtP(0.0000032) // '3.20e-6'
 * fmtP(0.0312)    // '0.0312'
 * fmtP(0.5)       // '0.500'
 * ```
 */
export function fmtP(p: number | null | undefined, fallback = DASH): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return fallback
  if (p <= 0) return '< 1e-300'
  if (p < 1e-4) return p.toExponential(2)
  if (p < 0.01) return p.toFixed(4)
  return p.toFixed(3)
}

/** Bytes with binary units: `fmtBytes(4096)` → '4.0 KiB'. */
export function fmtBytes(n: number | null | undefined, fallback = DASH): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return fallback
  const abs = Math.abs(n)
  if (abs < 1024) return `${Math.round(n)} B`
  if (abs < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`
  if (abs < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  return `${(n / 1024 ** 3).toFixed(2)} GiB`
}

/** Milliseconds as µs / ms / s / m s: `fmtDuration(1234)` → '1.23 s'. */
export function fmtDuration(ms: number | null | undefined, fallback = DASH): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return fallback
  const abs = Math.abs(ms)
  if (abs < 1) return `${(ms * 1000).toFixed(0)} µs`
  if (abs < 1000) return `${ms.toFixed(abs < 10 ? 1 : 0)} ms`
  if (abs < 60_000) return `${(ms / 1000).toFixed(2)} s`
  // Round once, to whole seconds, then split — flooring the minutes and rounding
  // the seconds independently prints the impossible '59 min 60 s' at 3,599,700 ms.
  const totalSeconds = Math.round(abs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${ms < 0 ? '−' : ''}${minutes} min ${seconds} s`
}

export interface HexOptions {
  /** Show at most this many bytes, then '…' (default: all). */
  max?: number
  /** Separator between bytes (default ''). */
  sep?: string
  /** Uppercase hex (default false). */
  upper?: boolean
}

/** Bytes as hex: `toHex(bytes, { max: 8, sep: ' ' })`. */
export function toHex(bytes: ArrayLike<number> | null | undefined, opts: HexOptions = {}): string {
  if (!bytes) return ''
  const { max, sep = '', upper = false } = opts
  const take = max === undefined ? bytes.length : Math.min(max, bytes.length)
  const parts: string[] = []
  for (let i = 0; i < take; i++) {
    const byte = (bytes[i] as number) & 0xff
    parts.push(byte.toString(16).padStart(2, '0'))
  }
  const text = parts.join(sep)
  const out = upper ? text.toUpperCase() : text
  return take < bytes.length ? `${out}…` : out
}

/**
 * Parse hex text (whitespace, `:` and `-` separators allowed) into bytes.
 *
 * @throws Error `'invalid_hex'` (as `err.code`) for odd length or non-hex input.
 */
export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/[\s:-]/g, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    const error = new Error('not valid hex: expected an even number of hex digits') as Error & {
      code: string
    }
    error.name = 'FormatError'
    error.code = 'invalid_hex'
    throw error
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}
