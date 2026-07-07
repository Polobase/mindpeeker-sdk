const HEX_RE = /^[0-9a-fA-F]*$/

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    throw new TypeError(`invalid hex string of length ${hex.length}`)
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  let binary: string
  try {
    binary = atob(b64)
  } catch (error) {
    throw new TypeError(`invalid base64 string: ${(error as Error).message}`)
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < out.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
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

export function xorBytes(inputs: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const first = inputs[0]
  if (!first) throw new TypeError('xorBytes needs at least one input')
  for (const input of inputs) {
    if (input.length !== first.length) {
      throw new TypeError(`xorBytes length mismatch: ${input.length} !== ${first.length}`)
    }
  }
  const out = new Uint8Array(first)
  for (let i = 1; i < inputs.length; i++) {
    const input = inputs[i] as Uint8Array
    for (let j = 0; j < out.length; j++) {
      out[j] = (out[j] as number) ^ (input[j] as number)
    }
  }
  return out
}
