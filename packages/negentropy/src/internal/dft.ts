/**
 * Discrete Fourier transform for the spectral estimators. Pure, browser-safe,
 * arbitrary length: radix-2 Cooley–Tukey when n is a power of two, Bluestein's
 * chirp-z algorithm otherwise (so O(n log n) for any n, not O(n²)).
 */

/** In-place iterative radix-2 Cooley–Tukey FFT; `re`/`im` length must be a power of two. */
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i] as number
      re[i] = re[j] as number
      re[j] = tr
      const ti = im[i] as number
      im[i] = im[j] as number
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k] as number
        const aIm = im[i + k] as number
        const xRe = re[i + k + half] as number
        const xIm = im[i + k + half] as number
        const bRe = xRe * curRe - xIm * curIm
        const bIm = xRe * curIm + xIm * curRe
        re[i + k] = aRe + bRe
        im[i + k] = aIm + bIm
        re[i + k + half] = aRe - bRe
        im[i + k + half] = aIm - bIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

/** Bluestein's algorithm — FFT for arbitrary n via a power-of-two convolution. */
function fftBluestein(re: Float64Array, im: Float64Array): void {
  const n = re.length
  // smallest power of two ≥ 2n − 1
  let m = 1
  while (m < 2 * n - 1) m <<= 1
  // chirp w_j = exp(-i π j² / n); use j² mod 2n to keep the angle accurate
  const cosT = new Float64Array(n)
  const sinT = new Float64Array(n)
  for (let j = 0; j < n; j++) {
    const k = (j * j) % (2 * n)
    const ang = (Math.PI * k) / n
    cosT[j] = Math.cos(ang)
    sinT[j] = Math.sin(ang)
  }
  // a_j = x_j · conj(chirp) = x_j · (cos + i·(-(-sin)))… build a and b sequences
  const aRe = new Float64Array(m)
  const aIm = new Float64Array(m)
  for (let j = 0; j < n; j++) {
    const xr = re[j] as number
    const xi = im[j] as number
    const cr = cosT[j] as number
    const ci = -(sinT[j] as number) // exp(-iπj²/n)
    aRe[j] = xr * cr - xi * ci
    aIm[j] = xr * ci + xi * cr
  }
  const bRe = new Float64Array(m)
  const bIm = new Float64Array(m)
  bRe[0] = cosT[0] as number
  bIm[0] = sinT[0] as number // exp(+iπj²/n)
  for (let j = 1; j < n; j++) {
    const v = cosT[j] as number
    const w = sinT[j] as number
    bRe[j] = v
    bIm[j] = w
    bRe[m - j] = v
    bIm[m - j] = w
  }
  fftRadix2(aRe, aIm)
  fftRadix2(bRe, bIm)
  for (let i = 0; i < m; i++) {
    const pr = (aRe[i] as number) * (bRe[i] as number) - (aIm[i] as number) * (bIm[i] as number)
    const pi = (aRe[i] as number) * (bIm[i] as number) + (aIm[i] as number) * (bRe[i] as number)
    aRe[i] = pr
    aIm[i] = pi
  }
  // inverse FFT of the product (conjugate trick)
  for (let i = 0; i < m; i++) aIm[i] = -(aIm[i] as number)
  fftRadix2(aRe, aIm)
  for (let i = 0; i < m; i++) {
    aRe[i] = (aRe[i] as number) / m
    aIm[i] = -(aIm[i] as number) / m
  }
  // X_k = conj(chirp_k) · conv_k
  for (let k = 0; k < n; k++) {
    const cr = cosT[k] as number
    const ci = -(sinT[k] as number)
    const gr = aRe[k] as number
    const gi = aIm[k] as number
    re[k] = gr * cr - gi * ci
    im[k] = gr * ci + gi * cr
  }
}

/** In-place FFT of a complex signal of any length. */
export function fft(re: Float64Array, im: Float64Array): void {
  if (re.length !== im.length) {
    throw new RangeError(`fft: re/im length mismatch (${re.length} vs ${im.length})`)
  }
  if (re.length <= 1) return
  if (isPowerOfTwo(re.length)) fftRadix2(re, im)
  else fftBluestein(re, im)
}

/**
 * One-sided power spectrum |X_k|² of a real signal, for k = 0 … ⌊n/2⌋.
 * (Not scaled — callers normalize as needed.)
 */
export function realPowerSpectrum(x: ArrayLike<number>): Float64Array {
  const n = x.length
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = x[i] as number
  fft(re, im)
  const half = Math.floor(n / 2)
  const out = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) {
    const r = re[k] as number
    const i = im[k] as number
    out[k] = r * r + i * i
  }
  return out
}

/** Magnitudes |X_k| for k = 0 … ⌊n/2⌋ − 1 (the range the NIST spectral test scans). */
export function realDftMagnitudes(x: ArrayLike<number>): Float64Array {
  const n = x.length
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = x[i] as number
  fft(re, im)
  const half = Math.floor(n / 2)
  const out = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    const r = re[k] as number
    const i = im[k] as number
    out[k] = Math.sqrt(r * r + i * i)
  }
  return out
}
