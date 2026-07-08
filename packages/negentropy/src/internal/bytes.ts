/** Number of one-bits in each byte value. */
export const POPCOUNT: Uint8Array = (() => {
  const table = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let v = i
    let count = 0
    while (v) {
      count += v & 1
      v >>= 1
    }
    table[i] = count
  }
  return table
})()

/** Unpack bytes into bits, MSB first (the SDK-wide bit order). */
export function toBits(data: Uint8Array): Uint8Array {
  const bits = new Uint8Array(data.length * 8)
  for (let i = 0; i < data.length; i++) {
    for (let b = 0; b < 8; b++) bits[i * 8 + b] = ((data[i] as number) >> (7 - b)) & 1
  }
  return bits
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
