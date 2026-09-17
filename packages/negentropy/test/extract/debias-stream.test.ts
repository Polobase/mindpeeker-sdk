import { describe, expect, test } from 'bun:test'
import { toBits } from '../../src/estimators/entropy.js'
import { monobit, runsTest } from '../../src/estimators/frequency.js'
import { peresRate, vonNeumann } from '../../src/extract/debias.js'
import type { DebiasMethod } from '../../src/extract/debias-stream.js'
import { createDebiaser, debiasStream } from '../../src/extract/debias-stream.js'
import { prngBytes, prngUniforms } from '../helpers/byte-sources.js'

function run(method: DebiasMethod, bits: readonly number[], maxDepth?: number): number[] {
  const debiaser = createDebiaser(method, maxDepth)
  for (const bit of bits) debiaser.push(bit)
  return debiaser.take()
}

async function* chunked(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size)
}

async function collect(stream: AsyncGenerator<Uint8Array>): Promise<number[]> {
  const out: number[] = []
  for await (const chunk of stream) out.push(...chunk)
  return out
}

/** Pack bits MSB-first, dropping a trailing partial byte. */
function pack(bits: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] as number)
    out.push(byte)
  }
  return out
}

/**
 * The Elias/Peres exactness conditions over EVERY n-bit input, per input weight
 * (inputs of equal weight are equiprobable for every bias p): conditional on
 * the output length, and for every output prefix length k, all output strings
 * occur equally often. Returns the number of violating classes.
 */
function exactnessViolations(n: number, f: (bits: number[]) => number[]): number {
  const outputs: { weight: number; out: string }[] = []
  for (let mask = 0; mask < 1 << n; mask++) {
    const bits: number[] = []
    let weight = 0
    for (let b = 0; b < n; b++) {
      const bit = (mask >> b) & 1
      bits.push(bit)
      weight += bit
    }
    outputs.push({ weight, out: f(bits).join('') })
  }
  let violations = 0
  const check = (classes: Map<string, Map<string, number>>, width: (key: string) => number) => {
    for (const [key, counts] of classes) {
      const k = width(key)
      if (k === 0) continue
      const values = [...counts.values()]
      if (counts.size !== 2 ** k || values.some((v) => v !== values[0])) violations++
    }
  }
  const byLength = new Map<string, Map<string, number>>()
  for (const { weight, out } of outputs) {
    const key = `${weight}:${out.length}`
    const counts = byLength.get(key) ?? new Map<string, number>()
    counts.set(out, (counts.get(out) ?? 0) + 1)
    byLength.set(key, counts)
  }
  check(byLength, (key) => Number(key.split(':')[1]))
  for (let k = 1; k <= n; k++) {
    const byPrefix = new Map<string, Map<string, number>>()
    for (const { weight, out } of outputs) {
      if (out.length < k) continue
      const counts = byPrefix.get(String(weight)) ?? new Map<string, number>()
      counts.set(out.slice(0, k), (counts.get(out.slice(0, k)) ?? 0) + 1)
      byPrefix.set(String(weight), counts)
    }
    check(byPrefix, () => k)
  }
  return violations
}

describe('createDebiaser', () => {
  test('Zhou & Bruck 2012, Example 1: coin tosses HTTTHT yield the stream 11', () => {
    expect(run('peres', [1, 0, 0, 0, 1, 0])).toEqual([1, 1])
  })

  test('von Neumann carries the odd bit and equals the batch vonNeumann', () => {
    const bits = [...toBits(prngBytes(501, 0x71))].slice(0, 4001)
    expect(run('von-neumann', bits)).toEqual(vonNeumann(bits))
  })

  test('EXHAUSTIVE exactness of the random-stream algorithm (every 14-bit input, depths 1, 2, 3, 32)', () => {
    for (const depth of [1, 2, 3, 32]) {
      expect(exactnessViolations(14, (bits) => run('peres', bits, depth))).toBe(0)
    }
    expect(exactnessViolations(12, (bits) => run('von-neumann', bits))).toBe(0)
  })

  test('negative control: emitting Peres outputs immediately in U-before-V order is biased', () => {
    const naive = (bits: number[]): number[] => {
      type Node = { pending: number; u: Node | null; v: Node | null }
      const out: number[] = []
      const push = (node: Node, bit: number): void => {
        if (node.pending < 0) {
          node.pending = bit
          return
        }
        const a = node.pending
        node.pending = -1
        if (a !== bit) out.push(a)
        node.u ??= { pending: -1, u: null, v: null }
        push(node.u, a ^ bit)
        if (a === bit) {
          node.v ??= { pending: -1, u: null, v: null }
          push(node.v, a)
        }
      }
      const root: Node = { pending: -1, u: null, v: null }
      for (const bit of bits) push(root, bit)
      return out
    }
    expect(exactnessViolations(12, naive)).toBeGreaterThan(0)
  })

  test('rate approaches H(p) and output passes monobit/runs on a heavily biased source', () => {
    const n = 1_000_000
    for (const p of [0.5, 0.7]) {
      const uniforms = prngUniforms(n, 0x7a + Math.round(p * 10))
      const debiaser = createDebiaser('peres')
      let produced = 0
      for (let i = 0; i < n; i++) {
        debiaser.push((uniforms[i] as number) < p ? 1 : 0)
        if (i % 4096 === 4095) produced += debiaser.take().length
      }
      produced += debiaser.take().length
      const entropy = -p * Math.log2(p) - (1 - p) * Math.log2(1 - p)
      expect(produced / n).toBeGreaterThan(peresRate(p, 10) - 0.01)
      expect(produced / n).toBeLessThanOrEqual(entropy)
    }
    const uniforms = prngUniforms(400_000, 0x7c)
    const debiaser = createDebiaser('peres')
    for (let i = 0; i < uniforms.length; i++) debiaser.push((uniforms[i] as number) < 0.75 ? 1 : 0)
    const out = Uint8Array.from(debiaser.take())
    expect(Math.abs(monobit(out).z)).toBeLessThan(4)
    expect(Math.abs(runsTest(out))).toBeLessThan(4)
  })

  test('validates method and depth', () => {
    expect(() => createDebiaser('elias' as never)).toThrow(
      expect.objectContaining({ code: 'invalid_config' }),
    )
    for (const depth of [0, 33, 2.5]) {
      expect(() => createDebiaser('peres', depth)).toThrow(
        expect.objectContaining({ code: 'invalid_config' }),
      )
    }
  })
})

describe('debiasStream', () => {
  test('is independent of chunking and packs MSB-first', async () => {
    const raw = prngBytes(3000, 0x81)
    for (const method of ['peres', 'von-neumann'] as const) {
      const reference = pack(run(method, [...toBits(raw)]))
      for (const size of [1, 3, 64, 3000]) {
        expect(await collect(debiasStream(chunked(raw, size), method))).toEqual(reference)
      }
    }
    // von Neumann streaming ≡ batch vonNeumann over the concatenated input
    expect(await collect(debiasStream(chunked(raw, 5), 'von-neumann'))).toEqual(
      pack(vonNeumann(toBits(raw))),
    )
  })

  test('abort pre-empts a blocked upstream; upstream errors become source_failed', async () => {
    const controller = new AbortController()
    let finalized = false
    async function* blocked(): AsyncGenerator<Uint8Array> {
      try {
        yield prngBytes(64, 2)
        await new Promise<void>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      } finally {
        finalized = true
      }
    }
    const stream = debiasStream(blocked(), 'peres', { signal: controller.signal })
    await stream.next()
    const pending = stream.next()
    await Bun.sleep(5)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(finalized).toBe(true)

    const boom = new Error('usb unplugged')
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield prngBytes(16, 3)
      throw boom
    }
    await expect(collect(debiasStream(failing()))).rejects.toMatchObject({
      code: 'source_failed',
      cause: boom,
    })
    async function* notBytes(): AsyncGenerator<Uint8Array> {
      yield [1, 2, 3] as never
    }
    await expect(collect(debiasStream(notBytes()))).rejects.toMatchObject({
      code: 'invalid_config',
    })
    await expect(
      debiasStream(chunked(raw16(), 4), 'peres', { maxDepth: 0 }).next(),
    ).rejects.toMatchObject({
      code: 'invalid_config',
    })
  })
})

function raw16(): Uint8Array {
  return prngBytes(16, 4)
}
