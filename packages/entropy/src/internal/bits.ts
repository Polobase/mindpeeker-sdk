/** Pack 0/1 samples into bytes, MSB first. Returns the packed bytes and any trailing bits (<8). */
export function packBits(bits: readonly number[]): [Uint8Array, number[]] {
  const byteCount = Math.floor(bits.length / 8)
  const out = new Uint8Array(byteCount)
  for (let i = 0; i < byteCount; i++) {
    let value = 0
    for (let j = 0; j < 8; j++) {
      value = (value << 1) | ((bits[i * 8 + j] as number) & 1)
    }
    out[i] = value
  }
  return [out, bits.slice(byteCount * 8) as number[]]
}

/**
 * Von Neumann debiasing: consume bit pairs, 01→0, 10→1, 00/11 discarded.
 * Removes bias exactly when bits are independent; yield is at most 25%.
 * A trailing unpaired bit is dropped.
 */
export function vonNeumann(bits: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < bits.length; i += 2) {
    const a = bits[i]
    const b = bits[i + 1]
    if (a !== b) out.push(a === 1 ? 1 : 0)
  }
  return out
}
